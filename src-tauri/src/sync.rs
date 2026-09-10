use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine as _};
use chacha20poly1305::{aead::{Aead, Payload}, ChaCha20Poly1305, KeyInit, Nonce};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::storage;

const IDENTITY_FILE: &str = "sync-identity.dpapi";
const AGENT_TASK_NAME: &str = "Torgy Sync Agent";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPublic { pub public_key: String }

#[derive(Debug, Serialize, Deserialize)]
struct IdentityFile { private_key: String, public_key: String }

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecurePacket {
    version: u8,
    mailbox_id: String,
    sender_public_key: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairInvite {
    pub version: u8,
    pub code_hash: String,
    pub student_id: String,
    pub mailbox_id: String,
    pub coordinator_public_key: String,
    pub expires_at: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub request_id: String,
    pub code_hash: String,
    pub student_id: String,
    pub mailbox_id: String,
    pub device_id: String,
    pub student_public_key: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPairRequest {
    request_id: String,
    code_hash: String,
    device_id: String,
    student_public_key: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairResponse {
    pub request_id: String,
    pub student_id: String,
    pub mailbox_id: String,
    pub coordinator_public_key: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCodeResult { pub code: String, pub expires_at: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequestResult { pub request_id: String, pub code_hash: String }

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpoolPacket { mailbox_id: String, envelope_id: String, packet: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketFile { pub file_name: String, pub packet: String }

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentConfig {
    version: u8,
    share_root: String,
    paired_mailbox_id: Option<String>,
    paired_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatusFile {
    running: bool,
    configured: bool,
    paired_mailbox_id: Option<String>,
    last_cycle_at: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub installed: bool,
    pub configured: bool,
    pub running: bool,
    pub paired_mailbox_id: Option<String>,
    pub message: String,
}

fn now_iso() -> String { chrono::Utc::now().to_rfc3339() }

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid synchronization identifier.".into());
    }
    Ok(())
}

fn identity(app: &AppHandle) -> Result<IdentityFile, String> {
    if let Some(bytes) = storage::load_private_file(app, IDENTITY_FILE)? {
        return serde_json::from_slice(&bytes).map_err(|e| format!("Could not read local sync identity: {e}"));
    }
    let mut private = [0u8; 32];
    OsRng.fill_bytes(&mut private);
    let secret = StaticSecret::from(private);
    let public = PublicKey::from(&secret);
    let file = IdentityFile { private_key: STANDARD.encode(secret.to_bytes()), public_key: STANDARD.encode(public.as_bytes()) };
    storage::save_private_file(app, IDENTITY_FILE, &serde_json::to_vec(&file).map_err(|e| e.to_string())?)?;
    Ok(file)
}

pub fn identity_public(app: &AppHandle) -> Result<IdentityPublic, String> {
    Ok(IdentityPublic { public_key: identity(app)?.public_key })
}

fn shared_key(app: &AppHandle, peer_public_key: &str, mailbox_id: &str) -> Result<[u8; 32], String> {
    validate_id(mailbox_id)?;
    let local = identity(app)?;
    let private_bytes: [u8; 32] = STANDARD.decode(local.private_key).map_err(|_| "Local sync private key is unreadable.".to_string())?.try_into().map_err(|_| "Local sync private key has the wrong length.".to_string())?;
    let peer_bytes: [u8; 32] = STANDARD.decode(peer_public_key).map_err(|_| "Peer synchronization public key is unreadable.".to_string())?.try_into().map_err(|_| "Peer synchronization public key has the wrong length.".to_string())?;
    let secret = StaticSecret::from(private_bytes);
    let peer = PublicKey::from(peer_bytes);
    let shared = secret.diffie_hellman(&peer);
    let mut hasher = Sha256::new();
    hasher.update(b"torgy-sync-v1\0");
    hasher.update(shared.as_bytes());
    hasher.update(mailbox_id.as_bytes());
    Ok(hasher.finalize().into())
}

pub fn seal_envelope(app: &AppHandle, envelope: &Value, peer_public_key: &str, mailbox_id: &str) -> Result<String, String> {
    let key = shared_key(app, peer_public_key, mailbox_id)?;
    let cipher = ChaCha20Poly1305::new_from_slice(&key).map_err(|_| "Could not initialize sync encryption.".to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let plaintext = serde_json::to_vec(envelope).map_err(|e| format!("Could not serialize sync envelope: {e}"))?;
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: &plaintext, aad: mailbox_id.as_bytes() }).map_err(|_| "Could not encrypt synchronization envelope.".to_string())?;
    let packet = SecurePacket {
        version: 1,
        mailbox_id: mailbox_id.to_string(),
        sender_public_key: identity(app)?.public_key,
        nonce: STANDARD.encode(nonce_bytes),
        ciphertext: STANDARD.encode(ciphertext),
    };
    serde_json::to_string(&packet).map_err(|e| format!("Could not encode encrypted synchronization packet: {e}"))
}

pub fn open_packet(app: &AppHandle, packet: &str, peer_public_key: &str, mailbox_id: &str) -> Result<Value, String> {
    let decoded: SecurePacket = serde_json::from_str(packet).map_err(|_| "Synchronization packet was not valid Torgy JSON.".to_string())?;
    if decoded.version != 1 || decoded.mailbox_id != mailbox_id { return Err("Synchronization packet mailbox/version mismatch.".into()); }
    if decoded.sender_public_key != peer_public_key { return Err("Synchronization packet sender did not match the paired device.".into()); }
    let key = shared_key(app, peer_public_key, mailbox_id)?;
    let nonce: [u8; 12] = STANDARD.decode(decoded.nonce).map_err(|_| "Synchronization nonce was unreadable.".to_string())?.try_into().map_err(|_| "Synchronization nonce was the wrong length.".to_string())?;
    let ciphertext = STANDARD.decode(decoded.ciphertext).map_err(|_| "Synchronization ciphertext was unreadable.".to_string())?;
    let cipher = ChaCha20Poly1305::new_from_slice(&key).map_err(|_| "Could not initialize sync decryption.".to_string())?;
    let plaintext = cipher.decrypt(Nonce::from_slice(&nonce), Payload { msg: &ciphertext, aad: mailbox_id.as_bytes() }).map_err(|_| "Synchronization packet failed authentication/decryption.".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|_| "Decrypted synchronization packet was not valid JSON.".to_string())
}

fn pair_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut random = [0u8; 12];
    OsRng.fill_bytes(&mut random);
    random.iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect()
}

fn normalize_pair_code(code: &str) -> String {
    code.trim()
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase()
}

fn code_hash(code: &str) -> String {
    let clean = normalize_pair_code(code);
    let mut hasher = Sha256::new();
    hasher.update(b"torgy-pair-v1\0");
    hasher.update(clean.as_bytes());
    hex::encode(hasher.finalize())
}

fn ensure_share_dirs(root: &Path, mailbox_id: Option<&str>) -> Result<(), String> {
    for part in ["pairing/invites", "pairing/requests", "pairing/processed", "pairing/used"] {
        fs::create_dir_all(root.join(part)).map_err(|e| format!("Could not access university sync directory {part}: {e}"))?;
    }
    if let Some(mailbox) = mailbox_id {
        validate_id(mailbox)?;
        for part in ["student-to-coordinator", "coordinator-to-student"] {
            fs::create_dir_all(root.join("mailboxes").join(mailbox).join(part)).map_err(|e| format!("Could not access mailbox transport: {e}"))?;
        }
    }
    Ok(())
}

pub fn create_pair_invite(app: &AppHandle, share_root: &str, student_id: &str, mailbox_id: &str, expires_minutes: i64) -> Result<PairCodeResult, String> {
    validate_id(student_id)?;
    validate_id(mailbox_id)?;
    let root = PathBuf::from(share_root);
    ensure_share_dirs(&root, Some(mailbox_id))?;
    let code = pair_code();
    let hash = code_hash(&code);
    let expires = chrono::Utc::now() + chrono::Duration::minutes(expires_minutes.clamp(5, 1440));
    let invite = PairInvite {
        version: 1, code_hash: hash.clone(), student_id: student_id.to_string(), mailbox_id: mailbox_id.to_string(),
        coordinator_public_key: identity(app)?.public_key, expires_at: expires.to_rfc3339(), created_at: now_iso(),
    };
    storage::atomic_write(&root.join("pairing/invites").join(format!("{hash}.json")), &serde_json::to_vec_pretty(&invite).map_err(|e| e.to_string())?)?;
    Ok(PairCodeResult { code, expires_at: invite.expires_at })
}

fn program_data() -> PathBuf {
    std::env::var_os("PROGRAMDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData")).join("Torgy")
}
fn spool_root() -> PathBuf { program_data().join("spool") }
fn agent_root() -> PathBuf { program_data().join("agent") }
fn ensure_spool() -> Result<PathBuf, String> {
    let root = spool_root();
    for part in ["outgoing", "incoming", "acks", "pairing-requests", "pairing-responses", "processed"] {
        fs::create_dir_all(root.join(part)).map_err(|e| format!("Could not create local Torgy sync spool: {e}"))?;
    }
    Ok(root)
}

pub fn request_pairing(app: &AppHandle, code: &str, device_id: &str) -> Result<PairRequestResult, String> {
    validate_id(device_id)?;
    let clean = normalize_pair_code(code);
    if clean.len() < 10 || clean.len() > 32 || !clean.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Pairing code is incomplete or invalid.".into());
    }
    let root = ensure_spool()?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let request = LocalPairRequest { request_id: request_id.clone(), code_hash: code_hash(code), device_id: device_id.to_string(), student_public_key: identity(app)?.public_key, created_at: now_iso() };
    storage::atomic_write(&root.join("pairing-requests").join(format!("{request_id}.json")), &serde_json::to_vec_pretty(&request).map_err(|e| e.to_string())?)?;
    Ok(PairRequestResult { request_id, code_hash: request.code_hash })
}

pub fn pairing_response() -> Result<Option<PairResponse>, String> {
    let dir = ensure_spool()?.join("pairing-responses");
    let mut files: Vec<_> = fs::read_dir(&dir).map_err(|e| format!("Could not read local pairing responses: {e}"))?.flatten().collect();
    files.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let Some(entry) = files.last() else { return Ok(None); };
    let response = serde_json::from_slice(&fs::read(entry.path()).map_err(|e| e.to_string())?).map_err(|e| format!("Pairing response was invalid: {e}"))?;
    Ok(Some(response))
}

pub fn clear_pairing_response() -> Result<(), String> {
    let dir = ensure_spool()?.join("pairing-responses");
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() { let _ = fs::remove_file(entry.path()); }
    Ok(())
}

pub fn read_pair_requests(share_root: &str) -> Result<Vec<PairRequest>, String> {
    let root = PathBuf::from(share_root);
    ensure_share_dirs(&root, None)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(root.join("pairing/requests")).map_err(|e| format!("Could not read pairing requests: {e}"))?.flatten() {
        if entry.path().extension().and_then(|x| x.to_str()) != Some("json") { continue; }
        if let Ok(request) = serde_json::from_slice::<PairRequest>(&fs::read(entry.path()).unwrap_or_default()) { result.push(request); }
    }
    Ok(result)
}

pub fn ack_pair_request(share_root: &str, request_id: &str) -> Result<(), String> {
    validate_id(request_id)?;
    let root = PathBuf::from(share_root);
    ensure_share_dirs(&root, None)?;
    let src = root.join("pairing/requests").join(format!("{request_id}.json"));
    if src.exists() {
        let dest = root.join("pairing/processed").join(format!("{request_id}.json"));
        if dest.exists() { let _ = fs::remove_file(&dest); }
        fs::rename(src, dest).map_err(|e| format!("Could not acknowledge pairing request: {e}"))?;
    }
    Ok(())
}

fn valid_direction(direction: &str) -> Result<&str, String> {
    match direction { "student-to-coordinator" | "coordinator-to-student" => Ok(direction), _ => Err("Invalid synchronization direction.".into()) }
}

pub fn drive_send(share_root: &str, mailbox_id: &str, direction: &str, envelope_id: &str, packet: &str) -> Result<(), String> {
    validate_id(mailbox_id)?; validate_id(envelope_id)?; let direction = valid_direction(direction)?;
    let root = PathBuf::from(share_root); ensure_share_dirs(&root, Some(mailbox_id))?;
    storage::atomic_write(&root.join("mailboxes").join(mailbox_id).join(direction).join(format!("{envelope_id}.torgy")), packet.as_bytes())
}

pub fn drive_receive(share_root: &str, mailbox_id: &str, direction: &str) -> Result<Vec<PacketFile>, String> {
    validate_id(mailbox_id)?; let direction = valid_direction(direction)?;
    let root = PathBuf::from(share_root); ensure_share_dirs(&root, Some(mailbox_id))?;
    let dir = root.join("mailboxes").join(mailbox_id).join(direction);
    let mut result = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("Could not read sync mailbox: {e}"))?.flatten() {
        if entry.path().extension().and_then(|x| x.to_str()) != Some("torgy") { continue; }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue; };
        if let Ok(packet) = fs::read_to_string(entry.path()) { result.push(PacketFile { file_name: name, packet }); }
    }
    Ok(result)
}

pub fn test_share(share_root: &str) -> Result<String, String> {
    if share_root.trim().is_empty() { return Err("University synchronization drive path is empty.".into()); }
    let root = PathBuf::from(share_root);
    ensure_share_dirs(&root, None)?;
    let probe_dir = root.join("health");
    fs::create_dir_all(&probe_dir).map_err(|e| format!("Could not create synchronization health directory: {e}"))?;
    let file_name = format!("probe-{}.tmp", uuid::Uuid::new_v4());
    let path = probe_dir.join(file_name);
    storage::atomic_write(&path, b"torgy-read-write-probe")
        .map_err(|e| format!("University synchronization drive is not writable: {e}"))?;
    let bytes = fs::read(&path).map_err(|e| format!("University synchronization drive is not readable after write: {e}"))?;
    let _ = fs::remove_file(&path);
    if bytes != b"torgy-read-write-probe" { return Err("University synchronization drive read/write verification returned unexpected data.".into()); }
    Ok("University staff/faculty synchronization drive read/write check passed.".into())
}

pub fn drive_ack(share_root: &str, mailbox_id: &str, direction: &str, file_name: &str) -> Result<(), String> {
    validate_id(mailbox_id)?; let direction = valid_direction(direction)?;
    if Path::new(file_name).file_name().and_then(|x| x.to_str()) != Some(file_name) { return Err("Invalid sync file name.".into()); }
    let path = PathBuf::from(share_root).join("mailboxes").join(mailbox_id).join(direction).join(file_name);
    if path.exists() { fs::remove_file(path).map_err(|e| format!("Could not acknowledge sync packet: {e}"))?; }
    Ok(())
}

pub fn spool_send(mailbox_id: &str, envelope_id: &str, packet: &str) -> Result<(), String> {
    validate_id(mailbox_id)?; validate_id(envelope_id)?;
    let file = SpoolPacket { mailbox_id: mailbox_id.to_string(), envelope_id: envelope_id.to_string(), packet: packet.to_string() };
    storage::atomic_write(&ensure_spool()?.join("outgoing").join(format!("{envelope_id}.json")), &serde_json::to_vec(&file).map_err(|e| e.to_string())?)
}

pub fn spool_receive() -> Result<Vec<PacketFile>, String> {
    let dir = ensure_spool()?.join("incoming");
    let mut result = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue; };
        if let Ok(packet) = fs::read_to_string(entry.path()) { result.push(PacketFile { file_name: name, packet }); }
    }
    Ok(result)
}

pub fn spool_ack(file_name: &str) -> Result<(), String> {
    if Path::new(file_name).file_name().and_then(|x| x.to_str()) != Some(file_name) { return Err("Invalid local sync file name.".into()); }
    let root = ensure_spool()?;
    let incoming = root.join("incoming").join(file_name);
    if incoming.exists() { fs::remove_file(&incoming).map_err(|e| e.to_string())?; }
    let envelope_id = file_name.strip_suffix(".torgy").unwrap_or(file_name);
    validate_id(envelope_id)?;
    storage::atomic_write(&root.join("acks").join(format!("{envelope_id}.ack")), b"ack")
}

fn agent_config_path() -> PathBuf { agent_root().join("config.dpapi") }
fn read_agent_config() -> Result<Option<AgentConfig>, String> {
    let path = agent_config_path();
    if !path.exists() { return Ok(None); }
    let encrypted = fs::read(path).map_err(|e| format!("Could not read managed sync configuration: {e}"))?;
    let bytes = storage::protect::unprotect_machine(&encrypted)?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("Managed sync configuration was invalid: {e}"))
}
fn write_agent_config(config: &AgentConfig) -> Result<(), String> {
    fs::create_dir_all(agent_root()).map_err(|e| format!("Could not create managed sync configuration directory: {e}"))?;
    let bytes = serde_json::to_vec(config).map_err(|e| e.to_string())?;
    storage::atomic_write(&agent_config_path(), &storage::protect::protect_machine(&bytes)?)
}

pub fn configure_agent_cli(encoded_root: &str) -> Result<(), String> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded_root).map_err(|_| "Managed sync path argument was invalid.".to_string())?;
    let root = String::from_utf8(bytes).map_err(|_| "Managed sync path was not UTF-8.".to_string())?;
    if root.trim().is_empty() { return Err("Managed sync path cannot be empty.".into()); }
    fs::create_dir_all(agent_root()).map_err(|e| format!("Could not create managed sync directory: {e}"))?;
    let existing = read_agent_config()?.unwrap_or_default();
    write_agent_config(&AgentConfig { version: 1, share_root: root, ..existing })
}

#[cfg(target_os = "windows")]
pub fn configure_agent_elevated(share_root: &str) -> Result<bool, String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
    let exe = std::env::current_exe().map_err(|e| format!("Could not locate Torgy executable: {e}"))?;
    let encoded = URL_SAFE_NO_PAD.encode(share_root.as_bytes());
    let args = format!("--configure-agent={encoded}");
    let wide = |s: &OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let verb = wide(OsStr::new("runas")); let exe_w = wide(exe.as_os_str()); let args_w = wide(OsStr::new(&args));
    let result = unsafe { ShellExecuteW(0, verb.as_ptr(), exe_w.as_ptr(), args_w.as_ptr(), std::ptr::null(), SW_HIDE) } as isize;
    if result <= 32 { return Err(format!("Windows could not elevate managed sync configuration (ShellExecute code {result}).")); }
    Ok(true)
}
#[cfg(not(target_os = "windows"))]
pub fn configure_agent_elevated(_share_root: &str) -> Result<bool, String> { Err("Managed sync agent is Windows-only.".into()) }

fn installed_task() -> bool {
    #[cfg(target_os = "windows")]
    { std::process::Command::new("schtasks.exe").args(["/Query", "/TN", AGENT_TASK_NAME]).output().map(|o| o.status.success()).unwrap_or(false) }
    #[cfg(not(target_os = "windows"))]
    { false }
}

pub fn agent_status() -> AgentStatus {
    let configured = agent_config_path().exists();
    let status_path = spool_root().join("status.json");
    let status = fs::read(&status_path).ok().and_then(|b| serde_json::from_slice::<AgentStatusFile>(&b).ok());
    let running = status.as_ref().and_then(|s| chrono::DateTime::parse_from_rfc3339(&s.last_cycle_at).ok()).map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds() < 60).unwrap_or(false);
    AgentStatus {
        installed: installed_task(), configured, running,
        paired_mailbox_id: status.as_ref().and_then(|s| s.paired_mailbox_id.clone()),
        message: status.map(|s| s.message).unwrap_or_else(|| if configured { "Managed sync is configured but has not reported recently.".into() } else { "Managed sync requires university drive configuration.".into() }),
    }
}

fn write_agent_status(config: Option<&AgentConfig>, message: &str) {
    if let Ok(root) = ensure_spool() {
        let status = AgentStatusFile { running: true, configured: config.is_some(), paired_mailbox_id: config.and_then(|c| c.paired_mailbox_id.clone()), last_cycle_at: now_iso(), message: message.to_string() };
        let _ = storage::atomic_write(&root.join("status.json"), &serde_json::to_vec_pretty(&status).unwrap_or_default());
    }
}

fn process_pairing(config: &mut AgentConfig) -> Result<usize, String> {
    let spool = ensure_spool()?;
    let root = PathBuf::from(&config.share_root);
    ensure_share_dirs(&root, None)?;
    let mut count = 0;
    for entry in fs::read_dir(spool.join("pairing-requests")).map_err(|e| e.to_string())?.flatten() {
        let bytes = fs::read(entry.path()).unwrap_or_default();
        let Ok(local) = serde_json::from_slice::<LocalPairRequest>(&bytes) else { continue; };
        let invite_path = root.join("pairing/invites").join(format!("{}.json", local.code_hash));
        if !invite_path.exists() { continue; }
        let invite: PairInvite = serde_json::from_slice(&fs::read(&invite_path).map_err(|e| e.to_string())?).map_err(|e| format!("Pairing invite was invalid: {e}"))?;
        let expiry = chrono::DateTime::parse_from_rfc3339(&invite.expires_at).map_err(|_| "Pairing invite expiration was invalid.".to_string())?;
        if expiry.with_timezone(&chrono::Utc) < chrono::Utc::now() { continue; }
        let mailbox_changed = config.paired_mailbox_id.as_deref().is_some_and(|existing| existing != invite.mailbox_id.as_str());
        let used = root.join("pairing/used").join(format!("{}.{}.json", invite.code_hash, local.device_id));
        if let Some(parent) = used.parent() { let _ = fs::create_dir_all(parent); }
        if fs::rename(&invite_path, &used).is_err() { continue; }
        let request = PairRequest {
            request_id: local.request_id.clone(), code_hash: local.code_hash.clone(), student_id: invite.student_id.clone(), mailbox_id: invite.mailbox_id.clone(),
            device_id: local.device_id.clone(), student_public_key: local.student_public_key.clone(), created_at: local.created_at.clone(),
        };
        storage::atomic_write(&root.join("pairing/requests").join(format!("{}.json", local.request_id)), &serde_json::to_vec_pretty(&request).map_err(|e| e.to_string())?)?;
        let response = PairResponse { request_id: local.request_id.clone(), student_id: invite.student_id.clone(), mailbox_id: invite.mailbox_id.clone(), coordinator_public_key: invite.coordinator_public_key, expires_at: invite.expires_at };
        storage::atomic_write(&spool.join("pairing-responses").join(format!("{}.json", local.request_id)), &serde_json::to_vec_pretty(&response).map_err(|e| e.to_string())?)?;
        if mailbox_changed {
            // A valid one-time invite can deliberately move this managed installation to a
            // new coordinator mailbox. Old encrypted transport artifacts must not cross
            // that trust boundary.
            for part in ["outgoing", "incoming", "acks"] {
                if let Ok(entries) = fs::read_dir(spool.join(part)) {
                    for old in entries.flatten() { let _ = fs::remove_file(old.path()); }
                }
            }
        }
        config.paired_mailbox_id = Some(invite.mailbox_id);
        config.paired_at = Some(now_iso());
        write_agent_config(config)?;
        let _ = fs::rename(entry.path(), spool.join("processed").join(entry.file_name()));
        count += 1;
    }
    Ok(count)
}

fn process_agent_transport(config: &AgentConfig) -> Result<(usize, usize, usize), String> {
    let Some(mailbox) = config.paired_mailbox_id.as_deref() else { return Ok((0,0,0)); };
    validate_id(mailbox)?;
    let spool = ensure_spool()?;
    let root = PathBuf::from(&config.share_root);
    ensure_share_dirs(&root, Some(mailbox))?;
    let mut sent = 0; let mut received = 0; let mut acked = 0;

    for entry in fs::read_dir(spool.join("outgoing")).map_err(|e| e.to_string())?.flatten() {
        let Ok(file) = serde_json::from_slice::<SpoolPacket>(&fs::read(entry.path()).unwrap_or_default()) else { continue; };
        if file.mailbox_id != mailbox { continue; }
        drive_send(&config.share_root, mailbox, "student-to-coordinator", &file.envelope_id, &file.packet)?;
        fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        sent += 1;
    }

    let remote = root.join("mailboxes").join(mailbox).join("coordinator-to-student");
    for entry in fs::read_dir(remote).map_err(|e| e.to_string())?.flatten() {
        if entry.path().extension().and_then(|x| x.to_str()) != Some("torgy") { continue; }
        let local = spool.join("incoming").join(entry.file_name());
        if !local.exists() { fs::copy(entry.path(), &local).map_err(|e| format!("Could not copy incoming sync packet locally: {e}"))?; received += 1; }
    }

    for entry in fs::read_dir(spool.join("acks")).map_err(|e| e.to_string())?.flatten() {
        let Some(stem) = entry.path().file_stem().and_then(|x| x.to_str()).map(str::to_string) else { continue; };
        if validate_id(&stem).is_err() { continue; }
        let remote_file = root.join("mailboxes").join(mailbox).join("coordinator-to-student").join(format!("{stem}.torgy"));
        if remote_file.exists() { let _ = fs::remove_file(remote_file); }
        let _ = fs::remove_file(entry.path());
        acked += 1;
    }
    Ok((sent, received, acked))
}

fn embedded_default_share_root() -> Option<String> {
    let raw: serde_json::Value = serde_json::from_str(include_str!("../deployment.defaults.json")).ok()?;
    let value = raw.get("syncSharePath")?.as_str()?.trim();
    if value.is_empty() { None } else { Some(value.to_string()) }
}

pub fn run_agent() -> Result<(), String> {
    let _ = ensure_spool()?;
    if read_agent_config()?.is_none() {
        if let Some(root) = embedded_default_share_root() {
            write_agent_config(&AgentConfig { version: 1, share_root: root, paired_mailbox_id: None, paired_at: None })?;
        }
    }

    // The Windows installer schedules this worker once per minute under SYSTEM. A
    // short, one-cycle worker is easier to recover/update than a hidden perpetual
    // process and still keeps the student's interactive account away from the share.
    match read_agent_config() {
        Ok(Some(mut config)) if !config.share_root.trim().is_empty() => {
            let result = (|| -> Result<String, String> {
                let paired = process_pairing(&mut config)?;
                let (sent, received, acked) = process_agent_transport(&config)?;
                Ok(format!("Managed sync active. paired {paired}, sent {sent}, received {received}, acknowledged {acked}."))
            })();
            let message = result.as_deref().unwrap_or_else(|e| e);
            write_agent_status(Some(&config), message);
            result.map(|_| ())
        }
        Ok(_) => {
            write_agent_status(None, "Managed sync agent is installed and waiting for university drive configuration.");
            Ok(())
        }
        Err(error) => {
            write_agent_status(None, &error);
            Err(error)
        }
    }
}
