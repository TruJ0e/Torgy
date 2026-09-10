mod canvas;
mod copilot;
mod outlook;
mod speech;
mod storage;
mod sync;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: &'static str,
    storage: &'static str,
    app_data_dir: String,
    managed_agent_installed: bool,
    managed_agent_configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentDefaults {
    copilot_url: String,
    outlook_tenant_id: String,
    outlook_client_id: String,
    sync_share_path: String,
    canvas_base_url: String,
}

#[tauri::command]
fn runtime_info(app: AppHandle) -> Result<RuntimeInfo, String> {
    let agent = sync::agent_status();
    Ok(RuntimeInfo {
        platform: std::env::consts::OS,
        storage: storage::storage_description(),
        app_data_dir: storage::data_dir_string(&app)?,
        managed_agent_installed: agent.installed,
        managed_agent_configured: agent.configured,
    })
}

#[tauri::command]
fn deployment_defaults() -> Result<DeploymentDefaults, String> {
    let raw: Value = serde_json::from_str(include_str!("../deployment.defaults.json")).map_err(|e| format!("Bundled deployment defaults are invalid: {e}"))?;
    let s = |name: &str| raw.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
    Ok(DeploymentDefaults {
        copilot_url: s("copilotUrl"), outlook_tenant_id: s("outlookTenantId"), outlook_client_id: s("outlookClientId"),
        sync_share_path: s("syncSharePath"), canvas_base_url: s("canvasBaseUrl"),
    })
}

#[tauri::command] fn load_snapshot(app: AppHandle) -> Result<Option<Value>, String> { storage::load_snapshot(&app) }
#[tauri::command] fn save_snapshot(app: AppHandle, snapshot: Value) -> Result<(), String> { storage::save_snapshot(&app, &snapshot) }
#[tauri::command] fn export_backup_json(snapshot: Value) -> Result<String, String> { storage::backup_json(&snapshot) }

#[tauri::command]
async fn speech_dictate_once() -> Result<speech::SpeechResult, String> {
    tauri::async_runtime::spawn_blocking(speech::dictate_once).await.map_err(|e| format!("Local speech worker failed: {e}"))?
}

#[tauri::command] async fn open_copilot_window(app: AppHandle, url: String) -> Result<(), String> { copilot::open_window(&app, &url) }
#[tauri::command] async fn copilot_probe(app: AppHandle) -> Result<Value, String> { tauri::async_runtime::spawn_blocking(move || copilot::probe(&app)).await.map_err(|e| format!("Copilot probe worker failed: {e}"))? }
#[tauri::command] async fn copilot_submit_prompt(app: AppHandle, prompt: String) -> Result<Value, String> { tauri::async_runtime::spawn_blocking(move || copilot::submit_prompt(&app, &prompt)).await.map_err(|e| format!("Copilot submit worker failed: {e}"))? }
#[tauri::command] async fn copilot_read_latest_response(app: AppHandle) -> Result<Value, String> { tauri::async_runtime::spawn_blocking(move || copilot::read_latest_response(&app)).await.map_err(|e| format!("Copilot read worker failed: {e}"))? }
#[tauri::command] fn copilot_status(app: AppHandle) -> Value { copilot::status(&app) }

#[tauri::command] fn sync_identity(app: AppHandle) -> Result<sync::IdentityPublic, String> { sync::identity_public(&app) }
#[tauri::command] fn sync_seal_envelope(app: AppHandle, envelope: Value, peer_public_key: String, mailbox_id: String) -> Result<String, String> { sync::seal_envelope(&app, &envelope, &peer_public_key, &mailbox_id) }
#[tauri::command] fn sync_open_packet(app: AppHandle, packet: String, peer_public_key: String, mailbox_id: String) -> Result<Value, String> { sync::open_packet(&app, &packet, &peer_public_key, &mailbox_id) }
#[tauri::command] fn sync_create_pair_invite(app: AppHandle, share_root: String, student_id: String, mailbox_id: String, expires_minutes: i64) -> Result<sync::PairCodeResult, String> { sync::create_pair_invite(&app, &share_root, &student_id, &mailbox_id, expires_minutes) }
#[tauri::command] fn sync_request_pairing(app: AppHandle, code: String, device_id: String) -> Result<sync::PairRequestResult, String> { sync::request_pairing(&app, &code, &device_id) }
#[tauri::command] fn sync_pairing_response() -> Result<Option<sync::PairResponse>, String> { sync::pairing_response() }
#[tauri::command] fn sync_clear_pairing_response() -> Result<(), String> { sync::clear_pairing_response() }
#[tauri::command] fn sync_read_pair_requests(share_root: String) -> Result<Vec<sync::PairRequest>, String> { sync::read_pair_requests(&share_root) }
#[tauri::command] fn sync_ack_pair_request(share_root: String, request_id: String) -> Result<(), String> { sync::ack_pair_request(&share_root, &request_id) }
#[tauri::command] fn sync_drive_send(share_root: String, mailbox_id: String, direction: String, envelope_id: String, packet: String) -> Result<(), String> { sync::drive_send(&share_root, &mailbox_id, &direction, &envelope_id, &packet) }
#[tauri::command] fn sync_drive_receive(share_root: String, mailbox_id: String, direction: String) -> Result<Vec<sync::PacketFile>, String> { sync::drive_receive(&share_root, &mailbox_id, &direction) }
#[tauri::command] fn sync_drive_ack(share_root: String, mailbox_id: String, direction: String, file_name: String) -> Result<(), String> { sync::drive_ack(&share_root, &mailbox_id, &direction, &file_name) }
#[tauri::command] fn sync_spool_send(mailbox_id: String, envelope_id: String, packet: String) -> Result<(), String> { sync::spool_send(&mailbox_id, &envelope_id, &packet) }
#[tauri::command] fn sync_spool_receive() -> Result<Vec<sync::PacketFile>, String> { sync::spool_receive() }
#[tauri::command] fn sync_spool_ack(file_name: String) -> Result<(), String> { sync::spool_ack(&file_name) }
#[tauri::command] fn sync_configure_agent_elevated(share_root: String) -> Result<Value, String> { Ok(serde_json::json!({ "launched": sync::configure_agent_elevated(&share_root)? })) }
#[tauri::command] fn sync_agent_status() -> sync::AgentStatus { sync::agent_status() }
#[tauri::command] fn sync_test_share(share_root: String) -> Result<String, String> { sync::test_share(&share_root) }

#[tauri::command]
async fn outlook_connect(app: AppHandle, tenant_id: String, client_id: String) -> Result<outlook::AccountResult, String> {
    tauri::async_runtime::spawn_blocking(move || outlook::connect(&app, &tenant_id, &client_id)).await.map_err(|e| format!("Outlook sign-in worker failed: {e}"))?
}
#[tauri::command] fn outlook_disconnect(app: AppHandle) -> Result<(), String> { outlook::disconnect(&app) }
#[tauri::command] fn outlook_status(app: AppHandle) -> Result<outlook::StatusResult, String> { outlook::status(&app) }
#[tauri::command]
async fn outlook_delta(app: AppHandle, delta_link: Option<String>, start: String, end: String) -> Result<outlook::DeltaResult, String> {
    tauri::async_runtime::spawn_blocking(move || outlook::delta(&app, delta_link.as_deref(), &start, &end)).await.map_err(|e| format!("Outlook delta worker failed: {e}"))?
}
#[tauri::command]
async fn outlook_upsert_event(app: AppHandle, event_id: Option<String>, transaction_id: String, task_id: String, student_id: Option<String>, task_version: i64, subject: String, start_utc: String, end_utc: String) -> Result<outlook::UpsertResult, String> {
    tauri::async_runtime::spawn_blocking(move || outlook::upsert_event(&app, event_id.as_deref(), &transaction_id, &task_id, student_id.as_deref(), task_version, &subject, &start_utc, &end_utc)).await.map_err(|e| format!("Outlook write worker failed: {e}"))?
}
#[tauri::command]
async fn outlook_delete_event(app: AppHandle, event_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || outlook::delete_event(&app, &event_id)).await.map_err(|e| format!("Outlook delete worker failed: {e}"))?
}

#[tauri::command]
async fn canvas_connect(app: AppHandle, base_url: String, token: String) -> Result<canvas::CanvasAccount, String> {
    tauri::async_runtime::spawn_blocking(move || canvas::connect(&app, &base_url, &token)).await.map_err(|e| format!("Canvas connection worker failed: {e}"))?
}
#[tauri::command] fn canvas_disconnect(app: AppHandle) -> Result<(), String> { canvas::disconnect(&app) }
#[tauri::command] fn canvas_status(app: AppHandle) -> Result<canvas::CanvasStatus, String> { canvas::status(&app) }
#[tauri::command]
async fn canvas_fetch_assignments(app: AppHandle, students: Vec<canvas::StudentRequest>) -> Result<Vec<canvas::CanvasAssignmentRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || canvas::fetch_assignments(&app, &students)).await.map_err(|e| format!("Canvas sync worker failed: {e}"))?
}

pub fn handle_cli_mode() -> bool {
    for arg in std::env::args().skip(1) {
        if arg == "--sync-agent" {
            if let Err(error) = sync::run_agent() { eprintln!("Torgy managed sync agent stopped: {error}"); }
            return true;
        }
        if let Some(encoded) = arg.strip_prefix("--configure-agent=") {
            if let Err(error) = sync::configure_agent_cli(encoded) { eprintln!("Torgy managed sync configuration failed: {error}"); std::process::exit(2); }
            return true;
        }
    }
    false
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| { storage::data_dir_string(app.handle()).map_err(std::io::Error::other)?; Ok(()) })
        .invoke_handler(tauri::generate_handler![
            runtime_info, deployment_defaults, load_snapshot, save_snapshot, export_backup_json,
            speech_dictate_once, open_copilot_window, copilot_probe, copilot_submit_prompt, copilot_read_latest_response, copilot_status,
            sync_identity, sync_seal_envelope, sync_open_packet, sync_create_pair_invite, sync_request_pairing, sync_pairing_response, sync_clear_pairing_response,
            sync_read_pair_requests, sync_ack_pair_request, sync_drive_send, sync_drive_receive, sync_drive_ack, sync_spool_send, sync_spool_receive, sync_spool_ack,
            sync_configure_agent_elevated, sync_agent_status, sync_test_share,
            outlook_connect, outlook_disconnect, outlook_status, outlook_delta, outlook_upsert_event, outlook_delete_event,
            canvas_connect, canvas_disconnect, canvas_status, canvas_fetch_assignments,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Torgy");
}
