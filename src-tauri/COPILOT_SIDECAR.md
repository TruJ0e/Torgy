# `trucalenzer-copilot` sidecar CLI

Per-device CLI for the TruCalenZer Copilot bridge. Talks directly to
copilot.microsoft.com's own HTTP/WebSocket API using the device owner's
Microsoft sign-in. No paid API, no browser, no DOM scraping.

## Why it exists

The original bridge drove a Tauri WebView with injected JavaScript (find the
input box, stuff the prompt in, click Send, poll the DOM for the response).
Every Microsoft UI tweak risked breaking it. The sidecar replaces that with
the same endpoints the Copilot web app itself uses:

1. `POST https://copilot.microsoft.com/c/api/conversations` → conversation id
2. `wss://copilot.microsoft.com/c/api/chat?api-version=2&...` with an MSAL
   access token (scope `ChatAI.ReadWrite`) as `accessToken`
3. Event-JSON frames: `send` → `appendText`* (incremental deltas) → `done`

## One-time setup per device

```
trucalenzer-copilot login
```

Opens the MSAL device-code flow: visit the printed URL, enter the code, sign
in with the Microsoft/university account. Tokens are stored in a `0600`
session file under the platform app-data dir and auto-refreshed.

Escape hatches:

- `trucalenzer-copilot login --cookies "<cookie header>"` — paste session
  cookies from a signed-in browser instead of OAuth.
- `COPILOT_COOKIES` / `TRUCALENZER_COPILOT_TOKEN` env vars (debugging).
- `TRUCALENZER_COPILOT_SCOPE` env var if the default scope needs adjusting.

## Commands

| Command | Effect |
|---|---|
| `login [--cookies ...]` | Sign this device in (one-time). |
| `status` | JSON: `{"ok":bool,"authed":bool,"expires_in_seconds":n}`. |
| `ask --text "..."` | One-shot chat; reply text on stdout. |
| `organize` | Full prompt via stdin; `{"provider":"copilot","responseText":"..."}` on stdout. |

Exit codes: `0` ok, `2` auth required (re-run login), `1` other error.
Diagnostics go to stderr; machine-readable output goes to stdout.

## How the app uses it

- `copilot_sidecar_organize(prompt)` Tauri command shells out to the binary
  sitting next to the app executable (bundled via `externalBin`).
- `copilot_sidecar_status()` backs the Settings → Copilot bridge → Test button.
- The frontend (`src/services/copilot.ts`) tries the sidecar first and only
  falls back to the legacy WebView bridge when the binary is absent.
- Auth failures surface a plain message telling the user to run the login
  command once per device.

## Notes / risks

- Unofficial API surface: Microsoft can change it without notice. HTTP
  endpoints shift far less often than DOM structure, which is the whole point.
- Anti-bot `challenge` frames (hashcash + arithmetic PoW) are solved in-code;
  an unsolvable null challenge means bad auth → re-login.
- One active chat thread per signed-in account: the CLI is one-shot, so calls
  are naturally serialized. Don't hammer it (~20 rapid turns soft-blocks).
