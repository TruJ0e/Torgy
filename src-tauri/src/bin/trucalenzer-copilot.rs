//! `trucalenzer-copilot` — per-device CLI for the TruCalenZer Copilot bridge.
//!
//! Talks directly to copilot.microsoft.com's own HTTP/WebSocket API using the
//! device owner's Microsoft sign-in. No paid API, no browser, no DOM scraping.
//!
//! Commands:
//!   login [--cookies "<header>"]  Sign in this device (MSAL device-code flow,
//!                                 or store pasted cookies directly).
//!   status                        Print JSON auth status.
//!   ask --text "..."              One-shot chat; prints the reply text.
//!   organize                      Read the full prompt from stdin, print JSON:
//!                                 {"provider":"copilot","responseText":"..."}.
//!
//! Exit codes: 0 ok, 2 auth required, 1 other error. Diagnostics go to stderr;
//! machine-readable output goes to stdout.

use std::io::Read;
use trucalenzer_lib::copilot_cli;

fn usage() -> ! {
    eprintln!("usage:");
    eprintln!("  trucalenzer-copilot login [--json] [--cookies \"<cookie header>\"]");
    eprintln!("  trucalenzer-copilot status");
    eprintln!("  trucalenzer-copilot ask --text \"...\"");
    eprintln!("  trucalenzer-copilot organize   # prompt via stdin");
    std::process::exit(1);
}

fn main() {
    let mut args = std::env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| usage());
    let rest: Vec<String> = args.collect();

    let code = match cmd.as_str() {
        "login" => cmd_login(&rest),
        "status" => cmd_status(),
        "ask" => cmd_ask(&rest),
        "organize" => cmd_organize(),
        _ => usage(),
    };
    std::process::exit(code);
}

fn cmd_login(rest: &[String]) -> i32 {
    let json_output = rest.iter().any(|a| a == "--json");
    // `--cookies` escape hatch: store pasted cookies without any OAuth dance.
    if let Some(i) = rest.iter().position(|a| a == "--cookies") {
        let value = rest.get(i + 1).cloned().unwrap_or_default();
        if value.trim().is_empty() {
            eprintln!("--cookies needs a value");
            return 1;
        }
        let mut session = copilot_cli::load_session().unwrap_or_default();
        session.cookies = Some(value.trim().to_string());
        match copilot_cli::save_session(&session) {
            Ok(()) => {
                println!("Cookies stored for this device.");
                0
            }
            Err(e) => {
                eprintln!("Could not store cookies: {e}");
                1
            }
        }
    } else {
        if !json_output {
            println!("Signing in this device to Microsoft Copilot (one-time per device).");
        }
        match copilot_cli::device_code_login(json_output) {
            Ok(session) => match copilot_cli::save_session(&session) {
                Ok(()) => {
                    if json_output {
                        eprintln!("signed-in");
                    } else {
                        println!("Signed in. This device can now use the Copilot bridge.");
                    }
                    0
                }
                Err(e) => {
                    eprintln!("Sign-in worked but the session could not be stored: {e}");
                    1
                }
            },
            Err(e) => {
                eprintln!("Login failed: {e}");
                1
            }
        }
    }
}

fn cmd_status() -> i32 {
    println!("{}", copilot_cli::status_json());
    0
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn cmd_ask(rest: &[String]) -> i32 {
    let text = flag_value(rest, "--text").unwrap_or_default();
    if text.trim().is_empty() {
        eprintln!("ask needs --text \"...\"");
        return 1;
    }
    match copilot_cli::organize_once(&text) {
        Ok(answer) => {
            println!("{answer}");
            0
        }
        Err(e) => {
            eprintln!("ask failed: {e}");
            if e.starts_with("AUTH_REQUIRED") {
                2
            } else {
                1
            }
        }
    }
}

fn cmd_organize() -> i32 {
    let mut prompt = String::new();
    if std::io::stdin().read_to_string(&mut prompt).is_err() || prompt.trim().is_empty() {
        eprintln!("organize reads the full prompt from stdin");
        return 1;
    }
    match copilot_cli::organize_once(&prompt) {
        Ok(response_text) => {
            let out = serde_json::json!({
                "provider": "copilot",
                "responseText": response_text,
            });
            println!("{out}");
            0
        }
        Err(e) => {
            eprintln!("organize failed: {e}");
            if e.starts_with("AUTH_REQUIRED") {
                2
            } else {
                1
            }
        }
    }
}
