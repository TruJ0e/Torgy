use std::collections::HashMap;
use std::time::Duration;

use chrono::Datelike;

use regex::Regex;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use url::Url;

use crate::storage;

const TOKEN_FILE: &str = "canvas-token.dpapi";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasCache { base_url: String, token: String, account_label: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAccount { pub account_label: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasStatus { pub connected: bool, pub account_label: Option<String>, pub base_url: Option<String> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentRequest { pub student_id: String, pub canvas_user_id: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAssignmentRecord {
    pub student_id: String,
    pub student_canvas_id: String,
    pub course_name: String,
    pub course_id: String,
    pub assignment_name: String,
    pub assignment_id: String,
    pub official_due_date: Option<String>,
    pub possible_due_date: Option<String>,
    pub detected_date_source: Option<String>,
    pub canvas_url: Option<String>,
    pub published: bool,
}

fn client() -> Result<Client, String> {
    Client::builder().timeout(Duration::from_secs(35)).user_agent("Torgy/0.4").build().map_err(|e| format!("Could not initialize Canvas HTTP client: {e}"))
}

fn normalize_base(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value.trim()).map_err(|_| "Canvas URL is not valid.".to_string())?;
    if url.scheme() != "https" { return Err("Canvas URL must use HTTPS.".into()); }
    url.set_query(None); url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn save(app: &AppHandle, cache: &CanvasCache) -> Result<(), String> {
    storage::save_private_file(app, TOKEN_FILE, &serde_json::to_vec(cache).map_err(|e| e.to_string())?)
}
fn load(app: &AppHandle) -> Result<Option<CanvasCache>, String> {
    let Some(bytes) = storage::load_private_file(app, TOKEN_FILE)? else { return Ok(None); };
    serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("Canvas credential cache was invalid: {e}"))
}

fn send(cache: &CanvasCache, url: &str) -> Result<Response, String> {
    let response = client()?.get(url).bearer_auth(&cache.token).send().map_err(|e| format!("Canvas request failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("Canvas request failed (HTTP {}). Check the token, permissions, and Canvas URL.", response.status())); }
    Ok(response)
}

fn next_link(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let raw = headers.get(reqwest::header::LINK)?.to_str().ok()?;
    for segment in raw.split(',') {
        let parts: Vec<_> = segment.split(';').map(str::trim).collect();
        if parts.iter().any(|part| *part == "rel=\"next\"") {
            return Some(parts.first()?.trim_start_matches('<').trim_end_matches('>').to_string());
        }
    }
    None
}

fn get_all(cache: &CanvasCache, url: String) -> Result<Vec<Value>, String> {
    let mut next = Some(url);
    let mut result = Vec::new();
    for _ in 0..100 {
        let Some(url) = next.take() else { break; };
        let response = send(cache, &url)?;
        next = next_link(response.headers());
        let page: Value = response.json().map_err(|e| format!("Canvas returned invalid JSON: {e}"))?;
        if let Some(values) = page.as_array() { result.extend(values.iter().cloned()); }
        else { return Err("Canvas list endpoint did not return an array.".into()); }
    }
    Ok(result)
}

fn get_all_best_effort(cache: &CanvasCache, url: String) -> Vec<Value> {
    get_all(cache, url).unwrap_or_default()
}

pub fn connect(app: &AppHandle, base_url: &str, token: &str) -> Result<CanvasAccount, String> {
    if token.trim().len() < 8 { return Err("Canvas token appears incomplete.".into()); }
    let base = normalize_base(base_url)?;
    let temp = CanvasCache { base_url: base.clone(), token: token.trim().to_string(), account_label: String::new() };
    let profile: Value = send(&temp, &format!("{base}/api/v1/users/self/profile"))?.json().map_err(|e| format!("Canvas profile response was invalid: {e}"))?;
    let label = profile.get("name").and_then(Value::as_str).or_else(|| profile.get("short_name").and_then(Value::as_str)).unwrap_or("Canvas account").to_string();
    save(app, &CanvasCache { account_label: label.clone(), ..temp })?;
    Ok(CanvasAccount { account_label: label })
}

pub fn disconnect(app: &AppHandle) -> Result<(), String> { storage::delete_private_file(app, TOKEN_FILE) }

pub fn status(app: &AppHandle) -> Result<CanvasStatus, String> {
    Ok(match load(app)? {
        Some(cache) => CanvasStatus { connected: true, account_label: Some(cache.account_label), base_url: Some(cache.base_url) },
        None => CanvasStatus { connected: false, account_label: None, base_url: None },
    })
}

fn strip_html(value: &str) -> String {
    let tag = Regex::new(r"(?s)<[^>]*>").unwrap();
    tag.replace_all(value, " ").replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn month_number(value: &str) -> Option<u32> {
    let lower = value.to_ascii_lowercase();
    let key = &lower[..lower.len().min(3)];
    Some(match key { "jan" => 1, "feb" => 2, "mar" => 3, "apr" => 4, "may" => 5, "jun" => 6, "jul" => 7, "aug" => 8, "sep" => 9, "oct" => 10, "nov" => 11, "dec" => 12, _ => return None })
}

fn infer_year(month: u32, day: u32, explicit: Option<i32>) -> Option<chrono::NaiveDate> {
    if let Some(year) = explicit { return chrono::NaiveDate::from_ymd_opt(year, month, day); }
    let today = chrono::Local::now().date_naive();
    let mut date = chrono::NaiveDate::from_ymd_opt(today.year(), month, day)?;
    if date < today - chrono::Duration::days(120) { date = chrono::NaiveDate::from_ymd_opt(today.year() + 1, month, day)?; }
    Some(date)
}

fn detect_date(text: &str) -> Option<String> {
    let named = Regex::new(r"(?i)\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:\s*,\s*|\s+)?(20\d{2})?\b").unwrap();
    if let Some(c) = named.captures(text) {
        let month = month_number(c.get(1)?.as_str())?;
        let day = c.get(2)?.as_str().parse().ok()?;
        let year = c.get(3).and_then(|m| m.as_str().parse().ok());
        return infer_year(month, day, year).map(|d| d.format("%Y-%m-%d").to_string());
    }
    let numeric = Regex::new(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}|\d{2}))?\b").unwrap();
    if let Some(c) = numeric.captures(text) {
        let month: u32 = c.get(1)?.as_str().parse().ok()?; let day: u32 = c.get(2)?.as_str().parse().ok()?;
        let year = c.get(3).and_then(|m| m.as_str().parse::<i32>().ok()).map(|y| if y < 100 { 2000 + y } else { y });
        return infer_year(month, day, year).map(|d| d.format("%Y-%m-%d").to_string());
    }
    None
}

fn detect_date_near_assignment(syllabus: &str, assignment_name: &str) -> Option<String> {
    if assignment_name.trim().len() < 4 || syllabus.trim().is_empty() { return None; }
    let plain = strip_html(syllabus);
    let lower = plain.to_lowercase();
    let needle = assignment_name.trim().to_lowercase();
    let index = lower.find(&needle)?;
    let mut start = index.saturating_sub(220);
    let mut end = (index + needle.len() + 220).min(plain.len());
    while start < plain.len() && !plain.is_char_boundary(start) { start += 1; }
    while end > start && !plain.is_char_boundary(end) { end -= 1; }
    detect_date(plain.get(start..end).unwrap_or_default())
}

fn module_assignment_hints(cache: &CanvasCache, course_id: &str) -> HashMap<String, String> {
    let modules_url = format!(
        "{}/api/v1/courses/{}/modules?include[]=items&per_page=100",
        cache.base_url,
        urlencoding::encode(course_id)
    );
    let mut hints = HashMap::new();
    for module in get_all_best_effort(cache, modules_url) {
        let Some(items) = module.get("items").and_then(Value::as_array) else { continue; };
        for item in items {
            if item.get("type").and_then(Value::as_str) != Some("Assignment") { continue; }
            let content_id = item.get("content_id").and_then(|v| v.as_i64().map(|x| x.to_string()).or_else(|| v.as_str().map(str::to_string))).unwrap_or_default();
            let title = item.get("title").and_then(Value::as_str).unwrap_or_default().trim();
            if !content_id.is_empty() && !title.is_empty() { hints.insert(content_id, title.to_string()); }
        }
    }
    hints
}

fn official_date(value: Option<&str>) -> Option<String> {
    let raw = value?;
    chrono::DateTime::parse_from_rfc3339(raw).ok().map(|dt| dt.with_timezone(&chrono::Local).date_naive().format("%Y-%m-%d").to_string())
}

pub fn fetch_assignments(app: &AppHandle, students: &[StudentRequest]) -> Result<Vec<CanvasAssignmentRecord>, String> {
    let cache = load(app)?.ok_or_else(|| "Canvas is not connected. Paste the token once in Settings first.".to_string())?;
    let mut result = Vec::new();
    for student in students {
        if student.student_id.trim().is_empty() || student.canvas_user_id.trim().is_empty() { continue; }
        let courses_url = format!("{}/api/v1/users/{}/courses?enrollment_state=active&include[]=syllabus_body&per_page=100", cache.base_url, urlencoding::encode(&student.canvas_user_id));
        let courses = get_all(&cache, courses_url)?;
        for course in courses {
            let course_id = course.get("id").and_then(|v| v.as_i64().map(|x| x.to_string()).or_else(|| v.as_str().map(str::to_string))).unwrap_or_default();
            if course_id.is_empty() { continue; }
            let course_name = course.get("name").and_then(Value::as_str).unwrap_or("Course").to_string();
            let syllabus_body = course.get("syllabus_body").and_then(Value::as_str).unwrap_or_default().to_string();
            let module_hints = module_assignment_hints(&cache, &course_id);
            let assignments_url = format!("{}/api/v1/users/{}/courses/{}/assignments?per_page=100", cache.base_url, urlencoding::encode(&student.canvas_user_id), urlencoding::encode(&course_id));
            let assignments = get_all(&cache, assignments_url)?;
            for assignment in assignments {
                let assignment_id = assignment.get("id").and_then(|v| v.as_i64().map(|x| x.to_string()).or_else(|| v.as_str().map(str::to_string))).unwrap_or_default();
                let name = assignment.get("name").and_then(Value::as_str).unwrap_or("Assignment").to_string();
                let official = official_date(assignment.get("due_at").and_then(Value::as_str));
                let description = strip_html(assignment.get("description").and_then(Value::as_str).unwrap_or_default());
                let module_hint = module_hints.get(&assignment_id).map(String::as_str).unwrap_or_default();
                let (possible, source) = if official.is_some() { (None, None) }
                    else if let Some(date) = detect_date(&name) { (Some(date), Some("title".to_string())) }
                    else if let Some(date) = detect_date(&description) { (Some(date), Some("description".to_string())) }
                    else if let Some(date) = detect_date(module_hint) { (Some(date), Some("module".to_string())) }
                    else if let Some(date) = detect_date_near_assignment(&syllabus_body, &name) { (Some(date), Some("syllabus".to_string())) }
                    else { (None, None) };
                result.push(CanvasAssignmentRecord {
                    student_id: student.student_id.clone(), student_canvas_id: student.canvas_user_id.clone(), course_name: course_name.clone(), course_id: course_id.clone(), assignment_name: name, assignment_id,
                    official_due_date: official, possible_due_date: possible, detected_date_source: source,
                    canvas_url: assignment.get("html_url").and_then(Value::as_str).map(str::to_string),
                    published: assignment.get("published").and_then(Value::as_bool).unwrap_or(true),
                });
            }
        }
    }
    Ok(result)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_named_date_is_detected() {
        assert_eq!(detect_date("Puppet Video due September 16, 2026").as_deref(), Some("2026-09-16"));
    }

    #[test]
    fn impossible_date_is_rejected() {
        assert_eq!(detect_date("Due February 31, 2026"), None);
    }

    #[test]
    fn syllabus_detection_requires_assignment_neighborhood() {
        let syllabus = "Week 1: Intro September 1, 2026. Much later: Chemistry Test September 18, 2026. Final December 1, 2026.";
        assert_eq!(detect_date_near_assignment(syllabus, "Chemistry Test").as_deref(), Some("2026-09-18"));
        assert_eq!(detect_date_near_assignment(syllabus, "Unlisted Assignment"), None);
    }
}
