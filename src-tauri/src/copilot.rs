use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

fn approved_microsoft_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "copilot.microsoft.com"
        || host == "m365.cloud.microsoft"
        || host == "www.microsoft365.com"
        || host == "www.office.com"
        || host == "office.com"
        || host.ends_with(".microsoft.com")
        || host.ends_with(".office.com")
        || host.ends_with(".cloud.microsoft")
}

fn copilot_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = app.get_webview_window("copilot")
        .ok_or_else(|| "Copilot is not open. Open the approved Microsoft Copilot window first.".to_string())?;
    let current = window.url().map_err(|e| format!("Could not verify the current Copilot URL: {e}"))?;
    let approved = current.scheme() == "https"
        && current.host_str().is_some_and(approved_microsoft_host);
    if !approved {
        return Err("The Copilot bridge stopped because the remote window navigated outside the approved Microsoft HTTPS boundary. Reopen Copilot from Torgy Settings.".to_string());
    }
    Ok(window)
}

fn eval_json(window: &WebviewWindow, script: String) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<String>();
    window
        .eval_with_callback(script, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Could not evaluate the Copilot bridge script: {e}"))?;

    let raw = rx
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| "Copilot did not return a bridge result in time.".to_string())?;

    serde_json::from_str::<Value>(&raw).or_else(|_| {
        // Some WebView runtimes may wrap the callback value as a JSON string.
        serde_json::from_str::<String>(&raw)
            .ok()
            .and_then(|inner| serde_json::from_str::<Value>(&inner).ok())
            .ok_or_else(|| format!("Copilot returned an unreadable bridge result: {raw}"))
    })
}

pub fn open_window(app: &AppHandle, raw_url: &str) -> Result<(), String> {
    let parsed = Url::parse(raw_url).map_err(|_| "Copilot URL is not valid.".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Copilot must use HTTPS.".to_string());
    }
    let host = parsed.host_str().ok_or_else(|| "Copilot URL has no host.".to_string())?;
    if !approved_microsoft_host(host) {
        return Err("For this build, the Copilot window is restricted to Microsoft-owned HTTPS hosts.".to_string());
    }

    if let Some(existing) = app.get_webview_window("copilot") {
        let current = existing.url().map_err(|e| format!("Could not read Copilot URL: {e}"))?;
        if current.host_str() != parsed.host_str() {
            existing
                .navigate(parsed)
                .map_err(|e| format!("Could not navigate Copilot window: {e}"))?;
        }
        existing.set_focus().map_err(|e| format!("Could not focus Copilot window: {e}"))?;
        return Ok(());
    }

    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the local Copilot profile directory: {e}"))?
        .join("copilot-webview");
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Could not create the local Copilot profile directory: {e}"))?;

    WebviewWindowBuilder::new(app, "copilot", WebviewUrl::External(parsed))
        .title("Microsoft Copilot — Torgy bridge")
        .data_directory(profile_dir)
        .general_autofill_enabled(false)
        .inner_size(1100.0, 820.0)
        .min_inner_size(760.0, 560.0)
        .build()
        .map_err(|e| format!("Could not open Microsoft Copilot: {e}"))?;
    Ok(())
}

pub fn probe(app: &AppHandle) -> Result<Value, String> {
    let window = copilot_window(app)?;
    let script = r#"
(() => {
  try {
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const descriptor = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      name: el.getAttribute('name'),
      testId: el.getAttribute('data-testid'),
      classHint: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') : null
    });
    const editables = [...document.querySelectorAll('textarea:not([disabled]), input[type="text"]:not([disabled]), [contenteditable="true"]')]
      .filter(visible).map(descriptor).slice(-16);
    const buttons = [...document.querySelectorAll('button')]
      .filter(visible)
      .map((el) => ({ ...descriptor(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), disabled: !!el.disabled }))
      .filter((b) => /send|submit|chat|new|message/i.test(`${b.text} ${b.aria} ${b.name} ${b.testId}`))
      .slice(-24);
    const responseContainers = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-testid*="response" i], [data-testid*="message" i], [role="article"], article')]
      .filter(visible).map(descriptor).slice(-20);
    return {
      ok: true,
      url: location.href,
      title: document.title,
      editables,
      buttons,
      responseContainers,
      counts: { editables: editables.length, buttons: buttons.length, responseContainers: responseContainers.length }
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
})()
"#;
    eval_json(&window, script.to_string())
}

pub fn submit_prompt(app: &AppHandle, prompt: &str) -> Result<Value, String> {
    let window = copilot_window(app)?;
    let prompt_json = serde_json::to_string(prompt).map_err(|e| format!("Could not encode Copilot prompt: {e}"))?;
    let script = format!(
        r#"
(() => {{
  try {{
    const prompt = {prompt_json};
    const visible = (el) => {{
      if (!(el instanceof HTMLElement)) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }};
    const candidates = [...document.querySelectorAll('textarea:not([disabled]), input[type="text"]:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"]')]
      .filter(visible);
    const input = candidates.at(-1);
    if (!input) return {{ ok: false, stage: 'input', error: 'No visible Copilot input was found.' }};

    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {{
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, prompt); else input.value = prompt;
      input.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: prompt }}));
      input.dispatchEvent(new Event('change', {{ bubbles: true }}));
    }} else {{
      input.replaceChildren(document.createTextNode(prompt));
      input.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: prompt }}));
    }}

    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const send = buttons.find((button) => {{
      if (button.disabled) return false;
      const label = `${{button.getAttribute('aria-label') || ''}} ${{button.getAttribute('title') || ''}} ${{button.getAttribute('data-testid') || ''}} ${{button.textContent || ''}}`;
      return /send|submit/i.test(label);
    }});
    if (!send) return {{ ok: false, stage: 'send', error: 'Prompt was entered, but no visible Send button was detected.' }};
    send.click();
    return {{ ok: true, stage: 'submitted' }};
  }} catch (error) {{
    return {{ ok: false, stage: 'exception', error: String(error) }};
  }}
}})()
"#
    );
    eval_json(&window, script)
}

pub fn read_latest_response(app: &AppHandle) -> Result<Value, String> {
    let window = copilot_window(app)?;
    let script = r#"
(() => {
  try {
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="response" i]',
      '[data-testid*="message" i]',
      '[role="article"]',
      'article'
    ];
    const all = [...document.querySelectorAll(selectors.join(','))]
      .filter(visible)
      .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length >= 10);
    const unique = [...new Set(all)];
    return { ok: true, response: unique.at(-1) || '', candidateCount: unique.length };
  } catch (error) {
    return { ok: false, error: String(error), response: '' };
  }
})()
"#;
    eval_json(&window, script.to_string())
}

pub fn status(app: &AppHandle) -> Value {
    if let Some(window) = app.get_webview_window("copilot") {
        let url = window.url().ok().map(|value| value.to_string());
        json!({ "open": true, "url": url })
    } else {
        json!({ "open": false, "url": Value::Null })
    }
}
