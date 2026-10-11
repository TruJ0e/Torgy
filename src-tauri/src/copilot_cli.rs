//! Direct Copilot web-API client for the `trucalenzer-copilot` sidecar CLI.
//!
//! No browser, no DOM scraping. This speaks the same HTTP/WebSocket endpoints
//! as copilot.microsoft.com itself:
//!
//!   1. `POST https://copilot.microsoft.com/c/api/conversations` -> conversation id
//!   2. `wss://copilot.microsoft.com/c/api/chat?api-version=2&clientSessionId=<uuid>`
//!      with an MSAL access token (scope `ChatAI.ReadWrite`) as `accessToken`.
//!   3. Event-JSON frames: `send` -> `appendText`* (incremental deltas) -> `done`.
//!
//! Auth is per-device via MSAL device-code flow (`login`), tokens stored in a
//! 0600 session file under the platform app-data dir. No paid API involved.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const SERVICE_DIR: &str = "com.trujoe.trucalenzer";
/// Azure CLI first-party client id — the standard trick for device-code CLIs.
const CLIENT_ID: &str = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";
const DEFAULT_SCOPE: &str = "ChatAI.ReadWrite offline_access openid profile";
const DEVICE_CODE_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const CONVERSATIONS_URL: &str = "https://copilot.microsoft.com/c/api/conversations";
const CHAT_WS_BASE: &str = "wss://copilot.microsoft.com/c/api/chat";
const API_VERSION: &str = "2";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HTTP_TIMEOUT: Duration = Duration::from_secs(25);
const CHAT_TIMEOUT: Duration = Duration::from_secs(120);

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Session {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    /// Unix seconds when the access token expires.
    pub access_expires_at: Option<i64>,
    /// Raw `Cookie` header value, optional escape hatch (env COPILOT_COOKIES).
    pub cookies: Option<String>,
}

fn session_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let base =
            std::env::var("APPDATA").map_err(|_| "APPDATA is not set".to_string())?;
        Ok(PathBuf::from(base).join(SERVICE_DIR).join("copilot-cli"))
    }
    #[cfg(target_vendor = "apple")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        Ok(PathBuf::from(home)
            .join("Library/Application Support")
            .join(SERVICE_DIR)
            .join("copilot-cli"))
    }
    #[cfg(not(any(target_os = "windows", target_vendor = "apple")))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        Ok(PathBuf::from(home)
            .join(".config")
            .join(SERVICE_DIR)
            .join("copilot-cli"))
    }
}

fn session_path() -> Result<PathBuf, String> {
    Ok(session_dir()?.join("session.json"))
}

pub fn load_session() -> Result<Session, String> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(Session::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Could not read session: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Session file is corrupt: {e}"))
}

pub fn save_session(session: &Session) -> Result<(), String> {
    let dir = session_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create session dir: {e}"))?;
    let path = dir.join("session.json");
    let raw = serde_json::to_string_pretty(session)
        .map_err(|e| format!("Could not encode session: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("Could not write session: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn scope() -> String {
    std::env::var("TRUCALENZER_COPILOT_SCOPE").unwrap_or_else(|_| DEFAULT_SCOPE.to_string())
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(UA)
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))
}

// ---------------------------------------------------------------------------
// MSAL device-code login
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: u64,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// Runs the MSAL device-code flow. Prints the user code/URL to stdout and
/// blocks until the user completes sign-in (or it expires).
/// If `json_output` is true, the device-code payload is printed as a single
/// JSON line first (for app-driven sign-in dialogs), human text goes to stderr.
pub fn device_code_login(json_output: bool) -> Result<Session, String> {
    let client = http_client()?;
    let form = [("client_id", CLIENT_ID), ("scope", &scope())];
    let dc: DeviceCodeResponse = client
        .post(DEVICE_CODE_URL)
        .form(&form)
        .send()
        .map_err(|e| format!("Device-code request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Device-code request rejected: {e}"))?
        .json()
        .map_err(|e| format!("Could not parse device-code response: {e}"))?;

    let url = dc
        .verification_uri_complete
        .clone()
        .unwrap_or(dc.verification_uri.clone());
    if json_output {
        // Machine-readable first line for app-driven dialogs.
        let payload = json!({
            "verification_uri": url,
            "user_code": dc.user_code,
            "expires_in_seconds": dc.expires_in,
        });
        println!("{payload}");
        std::io::stdout().flush().ok();
    } else {
        println!("To sign in this device to Microsoft Copilot:");
        println!("  1. Open {url}");
        println!("  2. Enter code: {}", dc.user_code);
        if let Some(msg) = dc.message.as_deref() {
            eprintln!("{msg}");
        }
        std::io::stdout().flush().ok();
    }

    let deadline = Instant::now() + Duration::from_secs(dc.expires_in.saturating_sub(30));
    let mut interval = Duration::from_secs(dc.interval.max(5));
    loop {
        if Instant::now() >= deadline {
            return Err("Sign-in expired. Run `trucalenzer-copilot login` again.".to_string());
        }
        std::thread::sleep(interval);
        let form = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", dc.device_code.as_str()),
            ("client_id", CLIENT_ID),
        ];
        let resp: TokenResponse = client
            .post(TOKEN_URL)
            .form(&form)
            .send()
            .map_err(|e| format!("Token poll failed: {e}"))?
            .json()
            .map_err(|e| format!("Could not parse token response: {e}"))?;
        match resp.error.as_deref() {
            None => {
                let access = resp
                    .access_token
                    .ok_or_else(|| "Token response had no access token.".to_string())?;
                let expires_in = resp.expires_in.unwrap_or(3600);
                return Ok(Session {
                    access_token: Some(access),
                    refresh_token: resp.refresh_token,
                    access_expires_at: Some(now_unix() + expires_in - 60),
                    cookies: None,
                });
            }
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval += Duration::from_secs(5);
                continue;
            }
            Some(other) => {
                let desc = resp.error_description.unwrap_or_default();
                return Err(format!("Sign-in failed ({other}): {desc}"));
            }
        }
    }
}

fn refresh_access_token(session: &mut Session) -> Result<(), String> {
    let refresh = session
        .refresh_token
        .clone()
        .ok_or_else(|| "AUTH_REQUIRED: no refresh token; run `trucalenzer-copilot login`.".to_string())?;
    let client = http_client()?;
    // `scope()` returns an owned String; bind it so the borrow lives long enough.
    let scope_owned = scope();
    let resp: TokenResponse = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", CLIENT_ID),
            ("scope", scope_owned.as_str()),
        ])
        .send()
        .map_err(|e| format!("Token refresh failed: {e}"))?
        .json()
        .map_err(|e| format!("Could not parse refresh response: {e}"))?;
    if let Some(err) = resp.error.as_deref() {
        let desc = resp.error_description.unwrap_or_default();
        return Err(format!("AUTH_REQUIRED: refresh failed ({err}): {desc}"));
    }
    let access = resp
        .access_token
        .ok_or_else(|| "AUTH_REQUIRED: refresh returned no access token.".to_string())?;
    let expires_in = resp.expires_in.unwrap_or(3600);
    session.access_token = Some(access);
    if resp.refresh_token.is_some() {
        session.refresh_token = resp.refresh_token;
    }
    session.access_expires_at = Some(now_unix() + expires_in - 60);
    save_session(session)?;
    Ok(())
}

/// Returns a valid access token, refreshing if needed.
pub fn valid_access_token(session: &mut Session) -> Result<String, String> {
    // Env override wins (debugging / escape hatch).
    if let Ok(tok) = std::env::var("TRUCALENZER_COPILOT_TOKEN") {
        if !tok.trim().is_empty() {
            return Ok(tok.trim().to_string());
        }
    }
    let fresh = session
        .access_token
        .as_ref()
        .and_then(|_| session.access_expires_at)
        .is_some_and(|exp| exp > now_unix() + 30);
    if fresh {
        return Ok(session.access_token.clone().unwrap_or_default());
    }
    refresh_access_token(session)?;
    session
        .access_token
        .clone()
        .ok_or_else(|| "AUTH_REQUIRED: still no access token after refresh.".to_string())
}

fn cookie_header(session: &Session) -> Option<String> {
    if let Ok(c) = std::env::var("COPILOT_COOKIES") {
        if !c.trim().is_empty() {
            return Some(c.trim().to_string());
        }
    }
    session.cookies.clone().filter(|c| !c.trim().is_empty())
}

// ---------------------------------------------------------------------------
// Conversation + chat
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ConversationCreated {
    #[serde(default)]
    id: Option<String>,
}

fn create_conversation(session: &Session) -> Result<String, String> {
    let client = http_client()?;
    let mut req = client
        .post(CONVERSATIONS_URL)
        .header("Origin", "https://copilot.microsoft.com")
        .header("Referer", "https://copilot.microsoft.com/")
        .header("Content-Type", "application/json")
        .body("{}");
    if let Some(cookies) = cookie_header(session) {
        req = req.header("Cookie", cookies);
    }
    let resp = req
        .send()
        .map_err(|e| format!("Conversation create failed: {e}"))?;
    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("AUTH_REQUIRED: conversation endpoint rejected the session (401/403). Re-run login or supply cookies.".to_string());
    }
    let created: ConversationCreated = resp
        .error_for_status()
        .map_err(|e| format!("Conversation endpoint error: {e}"))?
        .json()
        .map_err(|e| format!("Could not parse conversation response: {e}"))?;
    created
        .id
        .ok_or_else(|| "Conversation response had no id.".to_string())
}

// --- Challenge solvers -----------------------------------------------------

fn leading_zero_bits(digest: &[u8]) -> u32 {
    let mut bits = 0;
    for b in digest {
        if *b == 0 {
            bits += 8;
        } else {
            bits += b.leading_zeros();
            break;
        }
    }
    bits
}

fn solve_hashcash(parameter: &str, difficulty: u32) -> String {
    let mut nonce: u64 = 0;
    loop {
        let token = format!("{nonce:x}");
        let digest = Sha256::digest(format!("{parameter}{token}").as_bytes());
        if leading_zero_bits(&digest) >= difficulty {
            return token;
        }
        nonce += 1;
        // Safety valve: observed difficulties are small; never spin forever.
        if nonce > 50_000_000 {
            return format!("{nonce:x}");
        }
    }
}

fn solve_copilot_arithmetic(parameter: &str) -> Option<String> {
    let a: f64 = parameter.trim().parse().ok()?;
    let token = ((a.powi(3) / 100.0 + a * 25.0) % 22.0).round();
    Some(format!("{token:.0}"))
}

// --- WebSocket chat ---------------------------------------------------------

fn urlencoding_encode(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

pub fn chat_once(prompt: &str, session: &mut Session) -> Result<String, String> {
    let token = valid_access_token(session)?;
    let conversation_id = create_conversation(session)?;
    eprintln!("[copilot] conversation {conversation_id}");

    let url = format!(
        "{CHAT_WS_BASE}?api-version={API_VERSION}&clientSessionId={}&accessToken={}",
        Uuid::new_v4(),
        urlencoding_encode(&token),
    );
    let request = tungstenite::handshake::client::Request::builder()
        .uri(url.as_str())
        .header("Origin", "https://copilot.microsoft.com")
        .header("User-Agent", UA)
        .body(())
        .map_err(|e| format!("Could not build WS request: {e}"))?;
    let (mut socket, _resp) =
        tungstenite::connect(request).map_err(|e| format!("WS connect failed: {e}"))?;

    let send_frame = |socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>, value: Value| -> Result<(), String> {
        let text =
            serde_json::to_string(&value).map_err(|e| format!("Encode frame: {e}"))?;
        socket
            .send(tungstenite::Message::Text(text.into()))
            .map_err(|e| format!("WS send failed: {e}"))
    };

    // Mirror the browser: options + consents before the send.
    send_frame(
        &mut socket,
        json!({"event": "setOptions", "options": {"tone": "Balanced"}}),
    )?;
    send_frame(
        &mut socket,
        json!({"event": "reportLocalConsents", "consents": []}),
    )?;
    send_frame(
        &mut socket,
        json!({
            "event": "send",
            "conversationId": conversation_id,
            "content": [{"type": "text", "text": prompt}],
            "mode": "smart",
            "context": {},
        }),
    )?;

    let deadline = Instant::now() + CHAT_TIMEOUT;
    let mut answer = String::new();
    loop {
        if Instant::now() > deadline {
            return Err("Copilot did not finish before the chat timeout.".to_string());
        }
        let msg = socket
            .read()
            .map_err(|e| format!("WS read failed: {e}"))?;
        let text = match msg {
            tungstenite::Message::Text(t) => t.to_string(),
            tungstenite::Message::Close(_) => break,
            _ => continue,
        };
        let frame: Value =
            serde_json::from_str(&text).map_err(|e| format!("Bad WS frame: {e}"))?;
        let event = frame.get("event").and_then(Value::as_str).unwrap_or("");
        match event {
            "connected" | "received" | "startMessage" | "partCompleted" => continue,
            "appendText" => {
                if let Some(delta) = frame.get("text").and_then(Value::as_str) {
                    answer.push_str(delta);
                }
            }
            "challenge" => {
                // Unsolvable null challenge = bad auth.
                let method = frame.get("method").and_then(Value::as_str);
                let parameter = frame.get("parameter").and_then(Value::as_str).unwrap_or("");
                let solution = match method {
                    Some("hashcash") => {
                        let difficulty = frame
                            .get("difficulty")
                            .and_then(Value::as_u64)
                            .unwrap_or(4)
                            as u32;
                        Some(solve_hashcash(parameter, difficulty))
                    }
                    Some("copilot") => solve_copilot_arithmetic(parameter),
                    _ => None,
                };
                match solution {
                    Some(token) => {
                        eprintln!("[copilot] solved {method:?} challenge");
                        let mut resp = json!({"event": "challengeResponse", "token": token});
                        if let Some(id) = frame.get("challengeId") {
                            resp["challengeId"] = id.clone();
                        }
                        send_frame(&mut socket, resp)?;
                    }
                    None => {
                        return Err("AUTH_REQUIRED: Copilot issued an unsolvable challenge (bad auth). Re-run login.".to_string());
                    }
                }
            }
            "done" => break,
            "throttled" => {
                return Err("Copilot throttled this account. Wait a bit and retry.".to_string())
            }
            "error" | "badMessage" => {
                let detail = frame
                    .get("error")
                    .or_else(|| frame.get("message"))
                    .map(|v| v.to_string())
                    .unwrap_or_default();
                return Err(format!("Copilot error ({event}): {detail}"));
            }
            other => {
                eprintln!("[copilot] ignoring frame: {other}");
            }
        }
    }

    let _ = socket.close(None);
    let answer = answer.trim().to_string();
    if answer.is_empty() {
        return Err("Copilot returned an empty response.".to_string());
    }
    Ok(answer)
}

/// One-shot: load session, chat, return the raw response text.
pub fn organize_once(prompt: &str) -> Result<String, String> {
    let mut session = load_session()?;
    // Merge env cookie override without persisting it.
    let answer = chat_once(prompt, &mut session)?;
    Ok(answer)
}

/// Returns (ok, detail) for `status`.
pub fn status_json() -> Value {
    let mut session = match load_session() {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "authed": false, "error": e}),
    };
    let has_token = session.access_token.is_some();
    let fresh = session
        .access_expires_at
        .is_some_and(|exp| exp > now_unix() + 30);
    if has_token && !fresh {
        match refresh_access_token(&mut session) {
            Ok(()) => {}
            Err(e) => {
                return json!({"ok": false, "authed": false, "error": e});
            }
        }
    }
    let expires_in = session
        .access_expires_at
        .map(|exp| (exp - now_unix()).max(0));
    json!({
        "ok": has_token,
        "authed": has_token,
        "expires_in_seconds": expires_in,
        "has_cookies": cookie_header(&session).is_some(),
    })
}

/// Best-effort map of env overrides into the in-memory session.
pub fn apply_env_overrides(session: &mut Session) {
    if let Ok(c) = std::env::var("COPILOT_COOKIES") {
        if !c.trim().is_empty() {
            session.cookies = Some(c.trim().to_string());
        }
    }
}
