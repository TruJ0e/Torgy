use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

const CHATGPT_URL: &str = "https://chatgpt.com";

fn approved_chatgpt_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "chatgpt.com"
        || host == "chat.openai.com"
        || host == "auth.openai.com"
        || host == "auth0.openai.com"
        || host.ends_with(".openai.com")
        || host.ends_with(".chatgpt.com")
}

/// Third-party identity providers offered on the ChatGPT login page
/// ("Continue with Google / Microsoft / Apple"). The window may legitimately
/// sit on these during sign-in, but the bridge never runs scripts there.
fn sign_in_provider_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    matches!(
        host.as_str(),
        "accounts.google.com"
            | "login.live.com"
            | "login.microsoftonline.com"
            | "account.live.com"
            | "appleid.apple.com"
    )
}

fn boundary_error(current: &Url) -> Option<String> {
    let host = current.host_str().unwrap_or_default();
    if current.scheme() == "https" && approved_chatgpt_host(host) {
        return None;
    }
    if current.scheme() == "https" && sign_in_provider_host(host) {
        return Some(format!("ChatGPT sign-in is still in progress on {host}. Finish signing in inside the ChatGPT window, then retry."));
    }
    Some("The ChatGPT bridge stopped because the remote window navigated outside the approved OpenAI HTTPS boundary. Reopen ChatGPT from TruCalenZer Settings.".to_string())
}

fn gpt_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = app.get_webview_window("gpt").ok_or_else(|| {
        "ChatGPT is not open. Open the ChatGPT window first.".to_string()
    })?;
    let current = window
        .url()
        .map_err(|e| format!("Could not verify the current ChatGPT URL: {e}"))?;
    if let Some(error) = boundary_error(&current) {
        return Err(error);
    }
    Ok(window)
}

fn eval_json(window: &WebviewWindow, script: String) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<String>();
    window
        .eval_with_callback(script, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Could not evaluate the ChatGPT bridge script: {e}"))?;

    let raw = rx
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| "ChatGPT did not return a bridge result in time.".to_string())?;

    serde_json::from_str::<Value>(&raw).or_else(|_| {
        // Some WebView runtimes may wrap the callback value as a JSON string.
        serde_json::from_str::<String>(&raw)
            .ok()
            .and_then(|inner| serde_json::from_str::<Value>(&inner).ok())
            .ok_or_else(|| format!("ChatGPT returned an unreadable bridge result: {raw}"))
    })
}

pub fn open_window(app: &AppHandle) -> Result<(), String> {
    // ChatGPT has a single canonical entry point; there is no URL setting.
    let parsed = Url::parse(CHATGPT_URL).map_err(|_| "ChatGPT URL is not valid.".to_string())?;
    if parsed.scheme() != "https" {
        return Err("ChatGPT must use HTTPS.".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "ChatGPT URL has no host.".to_string())?;
    if !approved_chatgpt_host(host) {
        return Err(
            "For this build, the ChatGPT window is restricted to OpenAI-owned HTTPS hosts."
                .to_string(),
        );
    }

    if let Some(existing) = app.get_webview_window("gpt") {
        let current = existing
            .url()
            .map_err(|e| format!("Could not read ChatGPT URL: {e}"))?;
        // Leave the window alone while it is on an OpenAI host (e.g. mid-login on
        // auth.openai.com, or inside an existing conversation) or on a sign-in
        // provider; only pull it back home when it wandered somewhere else.
        let host = current.host_str().unwrap_or_default();
        let stay = current.scheme() == "https"
            && (approved_chatgpt_host(host) || sign_in_provider_host(host));
        if !stay {
            existing
                .navigate(parsed)
                .map_err(|e| format!("Could not navigate ChatGPT window: {e}"))?;
        }
        existing
            .set_focus()
            .map_err(|e| format!("Could not focus ChatGPT window: {e}"))?;
        return Ok(());
    }

    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the local ChatGPT profile directory: {e}"))?
        .join("gpt-webview");
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Could not create the local ChatGPT profile directory: {e}"))?;

    WebviewWindowBuilder::new(app, "gpt", WebviewUrl::External(parsed))
        .title("ChatGPT — TruCalenZer bridge")
        .data_directory(profile_dir)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .general_autofill_enabled(false)
        .inner_size(1100.0, 820.0)
        .min_inner_size(760.0, 560.0)
        .build()
        .map_err(|e| format!("Could not open ChatGPT: {e}"))?;
    Ok(())
}

/// Shared DOM helpers injected ahead of every bridge script. chatgpt.com has
/// shipped two composer/transcript generations:
///   - ProseMirror `#prompt-textarea`, `button[data-testid="send-button"]`,
///     assistant turns on `[data-message-author-role="assistant"]`;
///   - plain `textarea[name="prompt"]`, `button[aria-label="Send message"]`
///     (no test id), assistant turns on `li[data-message-role="assistant"]`
///     that gain `data-message-complete` once streaming finishes.
/// Both are matched so a rollout in either direction keeps the bridge working.
const DOM_HELPERS: &str = r#"
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const labelOf = (el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''} ${el.textContent || ''}`;
    const findComposer = () => {
      const known = ['#prompt-textarea', 'textarea[name="prompt"]', '[contenteditable="true"][role="textbox"]']
        .map((selector) => document.querySelector(selector))
        .find((el) => el && visible(el));
      if (known) return known;
      return [...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"]')].filter(visible).at(-1) || null;
    };
    const findSend = () => {
      const buttons = [...document.querySelectorAll('button')].filter(visible);
      return buttons.find((b) => b.getAttribute('data-testid') === 'send-button')
        || buttons.find((b) => b.id === 'composer-submit-button' && !/stop/i.test(labelOf(b)))
        || buttons.find((b) => /\bsend\b/i.test(b.getAttribute('aria-label') || ''))
        || buttons.find((b) => /send|submit/i.test(labelOf(b)) && !/stop/i.test(labelOf(b)))
        || null;
    };
    const findStop = () => [...document.querySelectorAll('button')].filter(visible)
      .find((b) => b.getAttribute('data-testid') === 'stop-button' || /stop (generating|streaming)/i.test(b.getAttribute('aria-label') || '')) || null;
    const assistantTurns = () => [...document.querySelectorAll('[data-message-role="assistant"], [data-message-author-role="assistant"]')]
      // Older markup can nest role nodes; keep only the outermost per turn.
      .filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)));
    const turnText = (el) => {
      const body = el.querySelector('[data-assistant-markdown-root], .markdown') || el;
      return (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const composerText = (el) => (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) ? el.value : (el.innerText || el.textContent || '');
"#;

fn bridge_script(body: &str) -> String {
    format!(
        "(() => {{\n  try {{\n{DOM_HELPERS}\n{body}\n  }} catch (error) {{\n    return {{ ok: false, stage: 'exception', error: String(error) }};\n  }}\n}})()"
    )
}

pub fn probe(app: &AppHandle) -> Result<Value, String> {
    let window = gpt_window(app)?;
    let body = r#"
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
      .filter((b) => /send|submit|chat|new|message|stop/i.test(`${b.text} ${b.aria} ${b.name} ${b.testId}`))
      .slice(-24);
    const responseContainers = assistantTurns().filter(visible).map(descriptor).slice(-20);
    const composer = findComposer();
    // Logged-out chatgpt.com still chats but shows "Log in" controls; report
    // it so a missing sign-in is visible rather than a silent failure.
    const loginVisible = [...document.querySelectorAll('button, a')].filter(visible)
      .some((el) => /^\s*log in\s*$/i.test(el.textContent || ''));
    return {
      ok: true,
      url: location.href,
      title: document.title,
      composerPresent: !!composer,
      composer: composer ? descriptor(composer) : null,
      sendButtonPresent: !!findSend(),
      generating: !!findStop(),
      signedIn: !loginVisible,
      editables,
      buttons,
      responseContainers,
      counts: { editables: editables.length, buttons: buttons.length, responseContainers: responseContainers.length }
    };
"#;
    eval_json(&window, bridge_script(body))
}

pub fn submit_prompt(app: &AppHandle, prompt: &str) -> Result<Value, String> {
    let window = gpt_window(app)?;
    let prompt_json = serde_json::to_string(prompt)
        .map_err(|e| format!("Could not encode ChatGPT prompt: {e}"))?;
    let insert_body = format!(
        r#"
    const prompt = {prompt_json};
    const input = findComposer();
    if (!input) return {{ ok: false, stage: 'input', error: 'No visible ChatGPT input was found.' }};

    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {{
      // React-controlled textarea: use the native setter so React sees the change.
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, prompt); else input.value = prompt;
      input.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: prompt }}));
      input.dispatchEvent(new Event('change', {{ bubbles: true }}));
    }} else {{
      // Contenteditable (ProseMirror) composer: select any existing draft and
      // insert through execCommand so the editor's own input handling runs.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand('insertText', false, prompt);
      if (!inserted) {{
        input.replaceChildren(document.createTextNode(prompt));
        input.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: prompt }}));
      }}
    }}
    const landed = composerText(input).replace(/\s+/g, ' ').trim();
    const expected = prompt.replace(/\s+/g, ' ').trim();
    if (!landed.startsWith(expected.slice(0, 40))) {{
      return {{ ok: false, stage: 'input', error: 'The prompt did not land in the ChatGPT composer.' }};
    }}
    return {{ ok: true, stage: 'inserted', composer: input.tagName.toLowerCase() }};
"#
    );
    let inserted = eval_json(&window, bridge_script(&insert_body))?;
    if inserted.get("ok") != Some(&Value::Bool(true)) {
        return Ok(inserted);
    }

    // The send control renders/enables only after React processes the input,
    // so it is not reliably clickable in the same tick as the insert. Poll.
    let click_body = r#"
    const send = findSend();
    if (!send) return { ok: false, stage: 'send', error: 'Prompt was entered, but no visible Send button was detected.' };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') return { ok: false, stage: 'send', error: 'Prompt was entered, but the Send button stayed disabled.' };
    send.click();
    return { ok: true, stage: 'submitted' };
"#;
    let mut last = Value::Null;
    for _ in 0..20 {
        last = eval_json(&window, bridge_script(click_body))?;
        if last.get("ok") == Some(&Value::Bool(true)) {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Ok(last)
}

pub fn read_latest_response(app: &AppHandle) -> Result<Value, String> {
    let window = gpt_window(app)?;
    // Only assistant turns are read: generic article/message selectors also
    // match the user's own prompt bubble, which contains the JSON schema.
    let body = r#"
    const turns = assistantTurns().filter(visible);
    const last = turns.at(-1) || null;
    const generating = !!findStop();
    // Current markup flags finished turns with data-message-complete; on
    // markup without the flag, fall back to "no stop button showing".
    const usesFlag = !!document.querySelector('[data-message-role="assistant"]');
    const flagged = !!last && last.hasAttribute('data-message-complete');
    const complete = !!last && !generating && (usesFlag ? flagged : true);
    return {
      ok: true,
      response: last ? turnText(last) : '',
      assistantCount: turns.length,
      generating,
      complete,
      candidateCount: turns.length
    };
"#;
    eval_json(&window, bridge_script(body))
}

pub fn status(app: &AppHandle) -> Value {
    if let Some(window) = app.get_webview_window("gpt") {
        let url = window.url().ok().map(|value| value.to_string());
        json!({ "open": true, "url": url })
    } else {
        json!({ "open": false, "url": Value::Null })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_for(url: &str) -> Option<String> {
        boundary_error(&Url::parse(url).unwrap())
    }

    #[test]
    fn openai_login_and_chat_hosts_stay_inside_the_boundary() {
        for url in [
            "https://chatgpt.com/c/123",
            "https://chat.openai.com/",
            "https://auth.openai.com/log-in",
            "https://auth0.openai.com/u/login",
            "https://platform.openai.com/",
            "https://sora.chatgpt.com/",
        ] {
            assert_eq!(err_for(url), None, "{url}");
        }
    }

    #[test]
    fn sign_in_providers_report_sign_in_in_progress() {
        let error = err_for("https://accounts.google.com/o/oauth2/auth").unwrap();
        assert!(error.contains("sign-in is still in progress"));
        let error = err_for("https://login.live.com/oauth20_authorize.srf").unwrap();
        assert!(error.contains("sign-in is still in progress"));
    }

    #[test]
    fn non_openai_hosts_and_plain_http_trip_the_boundary() {
        for url in [
            "https://example.com/",
            "https://evilopenai.com/",
            "https://openai.com.evil.test/",
            "https://chatgpt.com.evil.test/",
            "http://chatgpt.com/",
        ] {
            let error = err_for(url).unwrap();
            assert!(error.contains("outside the approved OpenAI HTTPS boundary"), "{url}");
        }
    }
}
