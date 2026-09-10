use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};

const SNAPSHOT_FILE: &str = "torgy-state.dpapi";
const DEV_SNAPSHOT_FILE: &str = "torgy-state.dev.json";

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
    #[cfg(not(target_os = "windows"))]
    { "development plaintext files (non-Windows build only)" }
}

pub fn data_dir_string(app: &AppHandle) -> Result<String, String> {
    Ok(app_data_dir(app)?.to_string_lossy().to_string())
}

pub fn load_snapshot(app: &AppHandle) -> Result<Option<Value>, String> {
    let dir = app_data_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        let path = dir.join(SNAPSHOT_FILE);
        if !path.exists() { return Ok(None); }
        let encrypted = fs::read(&path).map_err(|e| format!("Could not read encrypted Torgy state: {e}"))?;
        let plaintext = protect::unprotect_user(&encrypted)?;
        let value = serde_json::from_slice(&plaintext).map_err(|e| format!("Encrypted Torgy state was not valid JSON: {e}"))?;
        Ok(Some(value))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let path = dir.join(DEV_SNAPSHOT_FILE);
        if !path.exists() { return Ok(None); }
        let bytes = fs::read(&path).map_err(|e| format!("Could not read development Torgy state: {e}"))?;
        let value = serde_json::from_slice(&bytes).map_err(|e| format!("Development Torgy state was not valid JSON: {e}"))?;
        Ok(Some(value))
    }
}

pub fn save_snapshot(app: &AppHandle, snapshot: &Value) -> Result<(), String> {
    let dir = app_data_dir(app)?;
    let serialized = serde_json::to_vec(snapshot).map_err(|e| format!("Could not serialize Torgy state: {e}"))?;
    #[cfg(target_os = "windows")]
    { atomic_write(&dir.join(SNAPSHOT_FILE), &protect::protect_user(&serialized)?) }
    #[cfg(not(target_os = "windows"))]
    { atomic_write(&dir.join(DEV_SNAPSHOT_FILE), &serialized) }
}

pub fn backup_json(snapshot: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(snapshot).map_err(|e| format!("Could not prepare backup: {e}"))
}

pub fn save_private_file(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<(), String> {
    let path = app_data_dir(app)?.join(name);
    #[cfg(target_os = "windows")]
    { atomic_write(&path, &protect::protect_user(bytes)?) }
    #[cfg(not(target_os = "windows"))]
    { atomic_write(&path, bytes) }
}

pub fn load_private_file(app: &AppHandle, name: &str) -> Result<Option<Vec<u8>>, String> {
    let path = app_data_dir(app)?.join(name);
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(&path).map_err(|e| format!("Could not read private Torgy file {name}: {e}"))?;
    #[cfg(target_os = "windows")]
    { Ok(Some(protect::unprotect_user(&bytes)?)) }
    #[cfg(not(target_os = "windows"))]
    { Ok(Some(bytes)) }
}

pub fn delete_private_file(app: &AppHandle, name: &str) -> Result<(), String> {
    let path = app_data_dir(app)?.join(name);
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

#[cfg(not(target_os = "windows"))]
pub mod protect {
    pub fn protect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { Ok(bytes.to_vec()) }
    pub fn protect_machine(bytes: &[u8]) -> Result<Vec<u8>, String> { Ok(bytes.to_vec()) }
    pub fn unprotect_user(bytes: &[u8]) -> Result<Vec<u8>, String> { Ok(bytes.to_vec()) }
    pub fn unprotect_machine(bytes: &[u8]) -> Result<Vec<u8>, String> { Ok(bytes.to_vec()) }
}
