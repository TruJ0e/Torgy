# Torgy

Torgy is a **local-first Windows desktop application** for academic coordination. The repository contains code and synthetic fixtures only. Real student records, university credentials, Canvas tokens, Microsoft tokens, backups, and local Torgy state must never be committed.

## Current implementation

Torgy 0.4.0 contains the complete application-side architecture that can be finished without university-specific credentials or infrastructure values:

- Tauri + React Windows desktop shell; no hosted Torgy backend or cloud database.
- One shared workspace with coordinator `MASTER` / single-student filtering.
- Student mode using the same codebase with coordinator-only views hidden.
- Tasks, weekly calendar, schedule-vs-due-date separation, recurrence fields, priorities, and completion status.
- Confirmed / Possible / Undated academic dates. AI/text-inferred dates never become authoritative automatically.
- Local Windows speech capture for Info Dump.
- Info Dump review flow plus an isolated Microsoft Copilot WebView/DOM bridge.
- Copilot diagnostic probe that reports visible input/send/response candidates without reading cookies, tokens, localStorage, sessionStorage, or passwords.
- Current-user Windows DPAPI protection for local Torgy state and locally cached connector credentials.
- Encrypted student/coordinator synchronization envelopes using X25519 key agreement + ChaCha20-Poly1305 authenticated encryption.
- One-time coordinator/student pairing codes with random mailbox identifiers.
- Student transport through a SYSTEM scheduled task so the interactive student account never receives staff-share access.
- Offline queues, versioning, idempotent envelopes, task aliases, deterministic duplicate detection, and human review for ambiguous duplicates.
- Two-way Microsoft Outlook calendar synchronization using Entra public-client OAuth + PKCE. Outlook changes schedule work time only; they never rewrite academic due dates.
- Outlook transaction IDs and Torgy task markers to reduce duplicate calendar events and support recovery after reinstall/restore.
- Local academic import from JSON/CSV/TSV/Docs-style exports.
- Optional direct Canvas connector with pagination, official `due_at` preservation, and Possible-date detection from title, description, matching module item, or assignment-adjacent syllabus text.
- Backup export plus schema-validated restore/migration.
- Settings Readiness Check for storage, Copilot, Outlook, sync transport, pairing, academic source, and backup/restore.
- Windows NSIS installer hooks that configure the local encrypted spool and managed SYSTEM sync worker.
- GitHub Actions for safety checks, TypeScript/tests, Rust checks, and Windows installer generation.

## Runtime boundary

```text
Torgy.exe
├─ bundled React UI
├─ Rust local backend
├─ DPAPI-protected local state
├─ local Windows speech capture
├─ local offline sync queue
├─ local encrypted sync identity
└─ optional approved outbound integrations
   ├─ Microsoft Copilot
   ├─ Microsoft Outlook / Graph
   ├─ Canvas, if approved
   └─ university staff/faculty sync share via approved device/service identity
```

There is no Torgy-hosted server and no telemetry by default.

## Student/coordinator transport

The student UI does **not** receive credentials to the staff/faculty synchronization location. The Windows installer creates a local ProgramData spool and a scheduled task that runs `torgy.exe --sync-agent` as `SYSTEM` once per minute. The interactive app exchanges only encrypted packets with that local spool.

On a domain-managed university device, the SYSTEM worker can be authorized through the machine/device identity or another IT-approved service identity. The remote share ACL remains an IT responsibility. Torgy does not embed a reusable staff-share password.

## One-installer experience

The intended deployment is one Windows installer:

```text
TorgySetup.exe
  → UAC / managed deployment approval
  → install Torgy
  → create local spool + ACLs
  → create SYSTEM sync task
  → launch Torgy
```

First launch remains simple:

- Coordinator: choose Coordinator, sign into Microsoft when Outlook is enabled, add/pair students.
- Student: choose Student, enter the coordinator's one-time pairing code.

Normal synchronization is automatic after configuration. Users do not browse or manipulate the sync share directly.

## Development setup on Windows

Install Node.js 22+, Rust stable, Microsoft C++ build tools, and WebView2. Then:

```powershell
npm install
npm run security:repo
npm run release:preflight
npm run core:check
npm test
npm run desktop:dev
```

Build the Windows installer:

```powershell
npm run desktop:build
```

The NSIS installer is generated under `src-tauri/target/release/bundle/nsis/`.

The installer is currently **per-machine** because the managed student synchronization worker runs as SYSTEM. University software deployment can remove the need for end users to handle elevation manually.

## Deployment defaults

`src-tauri/deployment.defaults.json` contains only non-secret deployment values. GitHub repository/organization variables can inject these during CI:

- `TORGY_COPILOT_URL`
- `TORGY_OUTLOOK_TENANT_ID`
- `TORGY_OUTLOOK_CLIENT_ID`
- `TORGY_SYNC_SHARE_PATH`
- `TORGY_CANVAS_BASE_URL`

Passwords, access tokens, refresh tokens, client secrets, or student data are intentionally unsupported as build-time defaults.

## Copilot bridge

The installed app opens the university-approved Microsoft Copilot experience in a separate WebView profile. The remote Microsoft page is not given Tauri IPC access. Torgy's Rust host interacts only with visible DOM controls.

Info Dump flow:

```text
local microphone
  → local speech transcription
  → raw transcript
  → approved Copilot session
  → strict JSON suggestions
  → local validation
  → human review
  → local Torgy task(s)
```

Run the in-app **Copilot bridge → Test** action once against the real university session. The diagnostic reports candidate input, send, and response elements so Microsoft DOM differences can be handled without exposing authentication material.

## Academic-date safety

Torgy deliberately distinguishes academic truth from suggestions:

- Canvas `due_at` or a human-confirmed date → **Confirmed**.
- Date detected in title, description, module, syllabus vicinity, speech, Copilot, or local export text → **Possible**.
- No reliable date → **Undated**.

Only humans or authoritative source dates promote a Possible date to Confirmed.

## Backup and restore

Settings can export the current local snapshot as JSON and restore a supported Torgy backup. Restore runs schema migration before the snapshot is accepted. Backups may contain student data in production and therefore must be stored only in an approved location.

## Verification available in this repository

- `npm run security:repo` — rejects obvious secrets and prohibited runtime files.
- `npm run release:preflight` — checks version parity, installer mode, SYSTEM worker hook, CSP, deployment-default safety, and required release files.
- `npm run core:check` — strict TypeScript check of application services.
- `npm test` — unit and synthetic offline/reconnect tests.
- GitHub Actions additionally runs Windows `cargo check` and builds the NSIS installer.

## Values still supplied by the university

No code can invent or authorize these environment-specific values:

1. Approved Microsoft Copilot URL/experience and permission for this integration style.
2. Entra tenant ID + public desktop client registration for Outlook.
3. Staff/faculty-only sync path and machine/service identity ACL.
4. Whether direct Canvas is approved or a Docs/file import path should be used.
5. Code-signing / software-deployment method.

These are configuration/approval inputs, not missing product logic.

See `SECURITY.md` and `docs/` for the trust boundaries and deployment details.
