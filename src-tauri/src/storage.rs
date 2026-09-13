use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chacha20poly1305::{aead::{Aead, Payload}, ChaCha20Poly1305, KeyInit, Nonce};
use rand::{rngs::OsRng, RngCore};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const WINDOWS_SNAPSHOT_FILE: &str = "torgy-state.dpapi";
const APPLE_SNAPSHOT_FILE: &str = "torgy-state.secure";
const DEV_SNAPSHOT_FILE: &str = "torgy-state.dev.json";
const SECURE_FRAME_MAGIC: &[u8; 8] = b"TORGYK01";
const SECURE_FRAME_AAD: &[u8] = b"torgy-local-storage-v1";

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve Torgy app-data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create Torgy app-data directory: {e}"))?;
    Ok(dir)
}

pub fn storage_description() -> &'static str {
    #[cfg(target_os = "windows")]
    { "Windows DPAPI current-user encrypted files" }
    #[cfg(target_vendor = "apple")]
    { "Apple Keychain protected key + ChaCha20-Poly1305 encrypted files" }
    #[cfg(all(not(target_os = "windows"), not(target_vendor = "apple"), debug_assertions))]
    { "development plaintext files (unsupported debug platform only)" }
    #[cfg(all(not(target_os = "windows"), not(target_vendor = "apple"), not(debug_assertions)))]
    { "unsupported secure-storage platform" }
}

fn snapshot_file_name() -> &'static str {
    #[cfg(target_os = "windows")]
    { WINDOWS_SNAPSHOT_FILE }
    #[cfg(target_vendor = "apple")]
    { APPLE_SNAPSHOT_FILE }
    #[cfg(all(not(target_os = "windows"), not(target_vendor = "apple")))]
    { DEV_SNAPSHOT_FILE }
}

fn private_file_name(name: &str) -> String {
    #[cfg(target_vendor = "apple")]
    {
        return name.strip_suffix(".dpapi").map(|stem| format!("{stem}.secure")).unwrap_or_else(|| name.to_string());
    }
    #[cfg(not(target_vendor = "apple"))]
    { name.to_string() }
}

fn encrypt_with_key(bytes: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new_from_slice(key).map_err(|_| "Could not initialize Torgy local encryption.".to_string())?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: bytes, aad: SECURE_FRAME_AAD })
        .map_err(|_| "Could not encrypt Torgy local data.".to_string())?;
    let mut framed = Vec::with_capacity(SECURE_FRAME_MAGIC.len() + nonce.len() + ciphertext.len());
    framed.extend_from_slice(SECURE_FRAME_MAGIC);
    framed.extend_from_slice(&nonce);
    framed.extend_from_slice(&ciphertext);
    Ok(framed)
}

fn decrypt_with_key(bytes: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let header = SECURE_FRAME_MAGIC.len() + 12;
    if bytes.len() <= header || &bytes[..SECURE_FRAME_MAGIC.len()] != SECURE_FRAME_MAGIC {
        return Err("Torgy local data has an unknown or damaged encryption format.".into());
    }
    let nonce = &bytes[SECURE_FRAME_MAGIC.len()..header];
    let ciphertext = &bytes[header..];
    let cipher = ChaCha20Poly1305::new_from_slice(key).map_err(|_| "Could not initialize Torgy local decryption.".to_string())?;
    cipher.decrypt(Nonce::from_slice(nonce), Payload { msg: ciphertext, aad: SECURE_FRAME_AAD })
        .map_err(|_| "Torgy local data failed authenticated decryption.".to_string())
}

pub fn data_dir_string(app: &AppHandle) -> Result<String, String> {
    Ok(app_data_dir(app)?.to_string_lossy().to_string())
}

pub fn load_snapshot(app: &AppHandle) -> Result<Option<Value>, String> {
    let path = app_data_dir(app)?.join(snapshot_file_name());
    if !path.exists() { return Ok(None); }
    let encrypted = fs::read(&path).map_err(|e| format!("Could not read encrypted Torgy state: {e}"))?;
    let plaintext = protect::unprotect_user(&encrypted)?;
    let value = serde_json::from_slice(&plaintext).map_err(|e| format!("Encrypted Torgy state was not valid JSON: {e}"))?;
    Ok(Some(value))
}

pub fn save_snapshot(app: &AppHandle, snapshot: &Value) -> Result<(), String> {
    let path = app_data_dir(app)?.join(snapshot_file_name());
    let serialized = serde_json::to_vec(snapshot).map_err(|e| format!("Could not serialize Torgy state: {e}"))?;
    atomic_write(&path, &protect::protect_user(&serialized)?)
}

pub fn backup_json(snapshot: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(snapshot).map_err(|e| format!("Could not prepare backup: {e}"))
}

pub fn save_private_file(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<(), String> {
    let path = app_data_dir(app)?.join(private_file_name(name));
    atomic_write(&path, &protect::protect_user(bytes)?)
}

pub fn load_private_file(app: &AppHandle, name: &str) -> Result<Option<Vec<u8>>, String> {
    let path = app_data_dir(app)?.join(private_file_name(name));
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(&path).map_err(|e| format!("Could not read private Torgy file {name}: {e}"))?;
    Ok(Some(protect::unprotect_user(&bytes)?))
}

pub fn delete_private_file(app: &AppHandle, name: &str) -> Result<(), String> {
    let path = app_data_dir(app)?.join(private_file_name(name));
    if path.exists() { fs::remove_file(path).map_err(|e| format!("Could not remove private Torgy file {name}: {e}"))?; }
    Ok(())
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create Torgy directory: {e}"))?;
    }
    let mut temp = path.to_path_buf();
    let extension = path.extension().and_then(|x| x.to_str()).unwrap_or("data");
    temp.set_extension(format!("{extension}.tmp"));
    {
        let mut file = fs::File::create(&temp).map_err(|e| format!("Could not create temporary Torgy file: {e}"))?;
        file.write_all(bytes).map_err(|e| format!("Could not write temporary Torgy file: {e}"))?;
        file.sync_all().map_err(|e| format!("Could not flush temporary Torgy file: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    if path.exists() { fs::remove_file(path).map_err(|e| format!("Could not replace previous Torgy file: {e}"))?; }
    fs::rename(&temp, path).map_err(|e| format!("Could not commit Torgy file: {e}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub mod protect {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN,
    };

    struct OutBlob(CRYPT_INTEGER_BLOB);
    impl Default for OutBlob { fn default() -> Self { Self(CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() }) } }
    impl Drop for OutBlob {
        fn drop(&mut self) {
            if !self.0.pbData.is_null() {
                unsafe {
                    std::ptr::write_bytes(self.0.pbData, 0, self.0.cbData as usize);
                    LocalFree(self.0.pbData.cast::<c_void>());
                }
            }
        }
    }
    unsafe fn blob_to_vec(blob: &CRYPT_INTEGER_BLOB) -> Vec<u8> { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec() }

    fn protect(plaintext: &[u8], flags: u32) -> Result<Vec<u8>, String> {
        let mut input = CRYPT_INTEGER_BLOB { cbData: u32::try_from(plaintext.len()).map_err(|_| "Torgy data is too large for DPAPI".to_string())?, pbData: plaintext.as_ptr().cast_mut() };
        let mut out = OutBlob::default();
        let ok = unsafe { CryptProtectData(&mut input, null_mut(), null_mut(), null_mut(), null_mut(), flags | CRYPTPROTECT_UI_FORBIDDEN, &mut out.0) };
        if ok == 0 { return Err(format!("Windows DPAPI protect failed (error {})", unsafe { GetLastError() })); }
        if out.0.pbData.is_null() { return Err("Windows DPAPI returned empty encrypted data".into()); }
        Ok(unsafe { blob_to_vec(&out.0) })
    }
    fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let mut input = CRYPT_INTEGER_BLOB { cbData: u32::try_from(ciphertext.len()).map_err(|_| "Encrypted Torgy data is too large for DPAPI".to_string())?, pbData: ciphertext.as_ptr().cast_mut() };
        let mut out = OutBlob::default();
        let ok = unsafe { CryptUnprotectData(&mut input, null_mut(), null_mut(), null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out.0) };
        if ok == 0 { return Err(format!("Windows DPAPI unlock failed (error {})", unsafe { GetLastError() })); }
        if out.0.pbData.is_null() { return Err("Windows DPAPI returned empty decrypted data".into()); }
        Ok(unsafe { blob_to_vec(&out.0) })
    }
    pub fn protect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { protect(bytes, 0) }
    pub fn protect_machine(bytes: &[u8]) -> Result<Vec<u8>, String> { protect(bytes, CRYPTPROTECT_LOCAL_MACHINE) }
    pub fn unprotect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { unprotect(bytes) }
    pub fn unprotect_machine(bytes: &[u8]) -> Result<Vec<u8>, String> { unprotect(bytes) }
}

#[cfg(target_vendor = "apple")]
pub mod protect {
    use rand::{rngs::OsRng, RngCore};
    use security_framework::passwords::{get_generic_password, set_generic_password};

    use super::{decrypt_with_key, encrypt_with_key};

    const SERVICE: &str = "com.trujoe.torgy";
    const ACCOUNT: &str = "local-storage-master-key-v1";
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    fn master_key() -> Result<[u8; 32], String> {
        match get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => bytes.try_into().map_err(|_| "Torgy Keychain master key has the wrong length.".to_string()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
                let mut key = [0u8; 32];
                OsRng.fill_bytes(&mut key);
                set_generic_password(SERVICE, ACCOUNT, &key)
                    .map_err(|e| format!("Could not store Torgy master key in Apple Keychain: {e}"))?;
                Ok(key)
            }
            Err(error) => Err(format!("Could not read Torgy master key from Apple Keychain: {error}")),
        }
    }

    pub fn protect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { encrypt_with_key(bytes, &master_key()?) }
    pub fn unprotect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { decrypt_with_key(bytes, &master_key()?) }
    pub fn protect_machine(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("Machine-wide secret storage is Windows-only in Torgy.".into()) }
    pub fn unprotect_machine(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("Machine-wide secret storage is Windows-only in Torgy.".into()) }
}

#[cfg(all(not(target_os = "windows"), not(target_vendor = "apple")))]
pub mod protect {
    #[cfg(debug_assertions)]
    pub fn protect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { Ok(bytes.to_vec()) }
    #[cfg(debug_assertions)]
    pub fn unprotect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { Ok(bytes.to_vec()) }
    #[cfg(not(debug_assertions))]
    pub fn protect_user(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("Secure local storage is not implemented for this release platform.".into()) }
    #[cfg(not(debug_assertions))]
    pub fn unprotect_user(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("Secure local storage is not implemented for this release platform.".into()) }
    pub fn protect_machine(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("Machine-wide secret storage is Windows-only in Torgy.".into()) }
    pub fn unprotect_machine(_bytes: &[u8]) -> Result<Vec<u8>, String> { Err("Machine-wide secret storage is Windows-only in Torgy.".into()) }
}

#[cfg(test)]
mod tests {
    use super::{decrypt_with_key, encrypt_with_key, SECURE_FRAME_MAGIC};

    #[test]
    fn secure_frame_round_trips_and_authenticates() {
        let key = [7u8; 32];
        let framed = encrypt_with_key(b"local student data", &key).expect("encrypt");
        assert_eq!(&framed[..SECURE_FRAME_MAGIC.len()], SECURE_FRAME_MAGIC);
        assert_eq!(decrypt_with_key(&framed, &key).expect("decrypt"), b"local student data");

        let mut tampered = framed;
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(decrypt_with_key(&tampered, &key).is_err());
    }
}
