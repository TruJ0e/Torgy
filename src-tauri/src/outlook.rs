use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use url::Url;

use crate::storage;

const TOKEN_FILE: &str = "outlook-token.dpapi";
const GRAPH_ROOT: &str = "https://graph.microsoft.com/v1.0";
const SCOPES: &str = "openid profile offline_access User.Read Calendars.ReadWrite";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenCache {
    tenant_id: String,
    client_id: String,
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    account_label: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountResult {
    pub account_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResult {
    pub connected: bool,
    pub account_label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaResult {
    pub events: Vec<Value>,
    pub delta_link: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertResult {
    pub id: String,
    pub change_key: Option<String>,
}

fn http() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(35))
        .user_agent("Torgy/0.4")
        .build()
        .map_err(|e| format!("Could not initialize Outlook HTTP client: {e}"))
}

fn load(app: &AppHandle) -> Result<Option<TokenCache>, String> {
    let Some(bytes) = storage::load_private_file(app, TOKEN_FILE)? else {
        return Ok(None);
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("Outlook token cache was invalid: {e}"))
}
fn save(app: &AppHandle, cache: &TokenCache) -> Result<(), String> {
    storage::save_private_file(
        app,
        TOKEN_FILE,
        &serde_json::to_vec(cache).map_err(|e| e.to_string())?,
    )
}

fn token_endpoint(tenant: &str) -> String {
    format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token")
}
fn authorize_endpoint(tenant: &str) -> String {
    format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize")
}

fn refresh(app: &AppHandle, mut cache: TokenCache) -> Result<TokenCache, String> {
    let response = http()?
        .post(token_endpoint(&cache.tenant_id))
        .form(&[
            ("client_id", cache.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", cache.refresh_token.as_str()),
            ("scope", SCOPES),
        ])
        .send()
        .map_err(|e| format!("Outlook token refresh failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Outlook sign-in needs attention (token refresh HTTP {}).",
            response.status()
        ));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|e| format!("Outlook token refresh response was invalid: {e}"))?;
    cache.access_token = token.access_token;
    if let Some(refresh) = token.refresh_token {
        cache.refresh_token = refresh;
    }
    cache.expires_at = chrono::Utc::now().timestamp() + token.expires_in;
    save(app, &cache)?;
    Ok(cache)
}

fn valid_token(app: &AppHandle) -> Result<TokenCache, String> {
    let cache = load(app)?.ok_or_else(|| "Outlook is not connected.".to_string())?;
    if cache.expires_at <= chrono::Utc::now().timestamp() + 300 {
        refresh(app, cache)
    } else {
        Ok(cache)
    }
}

fn graph_response(response: Response) -> Result<Value, String> {
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(Value::Null);
    }
    let text = response
        .text()
        .map_err(|e| format!("Could not read Outlook response: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "Outlook/Graph request failed (HTTP {status}): {}",
            text.chars().take(400).collect::<String>()
        ));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("Outlook/Graph returned invalid JSON: {e}"))
}

fn graph_get(app: &AppHandle, url: &str) -> Result<Value, String> {
    let cache = valid_token(app)?;
    let response = http()?
        .get(url)
        .bearer_auth(&cache.access_token)
        .header("Prefer", "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
        .send()
        .map_err(|e| format!("Outlook request failed: {e}"))?;
    graph_response(response)
}

pub fn connect(app: &AppHandle, tenant_id: &str, client_id: &str) -> Result<AccountResult, String> {
    if tenant_id.trim().is_empty() || client_id.trim().is_empty() {
        return Err("Outlook tenant ID and public client ID are required.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Could not create temporary Outlook sign-in callback: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{port}");

    let mut verifier_bytes = [0u8; 48];
    OsRng.fill_bytes(&mut verifier_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut state_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut state_bytes);
    let state = URL_SAFE_NO_PAD.encode(state_bytes);

    let mut auth = Url::parse(&authorize_endpoint(tenant_id)).map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    webbrowser::open(auth.as_str())
        .map_err(|e| format!("Could not open Microsoft sign-in in the system browser: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(150);
    let mut code: Option<String> = None;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buffer = [0u8; 8192];
                let size = stream.read(&mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..size]);
                let first = request.lines().next().unwrap_or_default();
                let target = first.split_whitespace().nth(1).unwrap_or("/");
                let parsed =
                    Url::parse(&format!("http://localhost{target}")).map_err(|e| e.to_string())?;
                let params: HashMap<_, _> = parsed.query_pairs().into_owned().collect();
                let body = if params.get("state") == Some(&state) && params.get("code").is_some() {
                    code = params.get("code").cloned();
                    "Torgy is connected to Outlook. You can close this browser tab and return to Torgy."
                } else if let Some(error) = params.get("error_description") {
                    error
                } else {
                    "Torgy could not validate the Outlook sign-in response. Return to Torgy and try again."
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = stream.write_all(response.as_bytes());
                if code.is_some() {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100))
            }
            Err(error) => return Err(format!("Outlook sign-in callback failed: {error}")),
        }
    }
    let code = code.ok_or_else(|| {
        "Outlook sign-in timed out before Microsoft returned authorization.".to_string()
    })?;
    let response = http()?
        .post(token_endpoint(tenant_id))
        .form(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
            ("scope", SCOPES),
        ])
        .send()
        .map_err(|e| format!("Could not exchange Outlook authorization code: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Microsoft rejected the Outlook authorization code (HTTP {}).",
            response.status()
        ));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|e| format!("Microsoft token response was invalid: {e}"))?;
    let refresh_token = token.refresh_token.ok_or_else(|| "Microsoft did not return an offline refresh token. Ensure offline_access is allowed for this public client.".to_string())?;
    let temp = TokenCache {
        tenant_id: tenant_id.to_string(),
        client_id: client_id.to_string(),
        access_token: token.access_token,
        refresh_token,
        expires_at: chrono::Utc::now().timestamp() + token.expires_in,
        account_label: String::new(),
    };
    save(app, &temp)?;
    let me = graph_get(
        app,
        &format!("{GRAPH_ROOT}/me?$select=displayName,userPrincipalName,mail"),
    )?;
    let label = me
        .get("displayName")
        .and_then(Value::as_str)
        .or_else(|| me.get("mail").and_then(Value::as_str))
        .or_else(|| me.get("userPrincipalName").and_then(Value::as_str))
        .unwrap_or("Microsoft 365")
        .to_string();
    let mut cache = valid_token(app)?;
    cache.account_label = label.clone();
    save(app, &cache)?;
    Ok(AccountResult {
        account_label: label,
    })
}

pub fn disconnect(app: &AppHandle) -> Result<(), String> {
    storage::delete_private_file(app, TOKEN_FILE)
}

pub fn status(app: &AppHandle) -> Result<StatusResult, String> {
    Ok(match load(app)? {
        Some(cache) => StatusResult {
            connected: true,
            account_label: Some(cache.account_label),
        },
        None => StatusResult {
            connected: false,
            account_label: None,
        },
    })
}

pub fn delta(
    app: &AppHandle,
    delta_link: Option<&str>,
    start: &str,
    end: &str,
) -> Result<DeltaResult, String> {
    let mut next = if let Some(link) = delta_link.filter(|x| !x.trim().is_empty()) {
        if !link.starts_with("https://graph.microsoft.com/") {
            return Err("Stored Outlook delta link was not a Microsoft Graph URL.".into());
        }
        link.to_string()
    } else {
        let mut url = Url::parse(&format!("{GRAPH_ROOT}/me/calendarView/delta"))
            .map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("startDateTime", start)
            .append_pair("endDateTime", end);
        url.to_string()
    };
    let mut events = Vec::new();
    let mut final_delta = None;
    for _ in 0..100 {
        let page = graph_get(app, &next)?;
        if let Some(values) = page.get("value").and_then(Value::as_array) {
            events.extend(values.iter().cloned());
        }
        if let Some(link) = page.get("@odata.nextLink").and_then(Value::as_str) {
            next = link.to_string();
            continue;
        }
        final_delta = page
            .get("@odata.deltaLink")
            .and_then(Value::as_str)
            .map(str::to_string);
        break;
    }
    Ok(DeltaResult {
        events,
        delta_link: final_delta
            .ok_or_else(|| "Outlook delta sync did not return a delta link.".to_string())?,
    })
}

fn marker_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, '\r' | '\n' | '\0'))
        .take(180)
        .collect()
}

pub fn upsert_event(
    app: &AppHandle,
    event_id: Option<&str>,
    transaction_id: &str,
    task_id: &str,
    student_id: Option<&str>,
    task_version: i64,
    subject: &str,
    start_utc: &str,
    end_utc: &str,
) -> Result<UpsertResult, String> {
    let cache = valid_token(app)?;
    let student_marker = student_id
        .filter(|value| !value.trim().is_empty())
        .map(marker_value)
        .unwrap_or_default();
    let marker_body = format!(
        "Scheduled by Torgy. Moving this event changes scheduled work time only; it never changes an academic due date.\n\nTorgy-Task-ID: {}\nTorgy-Student-ID: {}\nTorgy-Task-Version: {}",
        marker_value(task_id), student_marker, task_version.max(0)
    );
    let mut body = json!({
        "subject": subject,
        "categories": ["Torgy"],
        "start": { "dateTime": start_utc.trim_end_matches('Z'), "timeZone": "UTC" },
        "end": { "dateTime": end_utc.trim_end_matches('Z'), "timeZone": "UTC" },
        "body": { "contentType": "text", "content": marker_body }
    });
    let client = http()?;
    let response = if let Some(id) = event_id.filter(|x| !x.trim().is_empty()) {
        client
            .patch(format!(
                "{GRAPH_ROOT}/me/events/{}",
                urlencoding::encode(id)
            ))
            .bearer_auth(&cache.access_token)
            .header("Prefer", "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
            .json(&body)
            .send()
    } else {
        body["transactionId"] = Value::String(transaction_id.to_string());
        client
            .post(format!("{GRAPH_ROOT}/me/events"))
            .bearer_auth(&cache.access_token)
            .header("Prefer", "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
            .json(&body)
            .send()
    }
    .map_err(|e| format!("Could not write Outlook event: {e}"))?;
    let value = graph_response(response)?;
    if value.is_null() {
        // PATCH commonly returns an event, but if a tenant returns 204, read it back.
        if let Some(id) = event_id {
            return Ok(UpsertResult {
                id: id.to_string(),
                change_key: None,
            });
        }
    }
    Ok(UpsertResult {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .or(event_id)
            .ok_or_else(|| "Outlook event response did not include an ID.".to_string())?
            .to_string(),
        change_key: value
            .get("changeKey")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

pub fn delete_event(app: &AppHandle, event_id: &str) -> Result<(), String> {
    let cache = valid_token(app)?;
    let response = http()?
        .delete(format!(
            "{GRAPH_ROOT}/me/events/{}",
            urlencoding::encode(event_id)
        ))
        .bearer_auth(&cache.access_token)
        .header("Prefer", "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
        .send()
        .map_err(|e| format!("Could not delete Outlook event: {e}"))?;
    if response.status().as_u16() == 404 || response.status().is_success() {
        return Ok(());
    }
    Err(format!(
        "Outlook event deletion failed (HTTP {}).",
        response.status()
    ))
}
