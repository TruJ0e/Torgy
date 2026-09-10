# Security model

This is an engineering design, not a certification of university policy compliance.

## Required properties

- Private source repository; synthetic test data only.
- No student data, access tokens, refresh tokens, cookies, session storage, database files, or exports committed to Git.
- Production runtime data stored outside source/project directories.
- No telemetry or analytics unless explicitly approved later.
- No public listening port in the production desktop build.
- Frontend has least-privilege IPC access to local backend commands.
- Student mode cannot obtain staff/faculty sync credentials.
- Current Windows application state is protected with current-user Windows DPAPI in the application data directory. University IT may require a different approved storage design before real data.
- Microsoft/Copilot authentication remains Microsoft-controlled; Torgy must not scrape or persist browser auth material.
- A staff-share service credential must never be embedded in the student frontend or source repository.
- Logs must redact names, identifiers, tokens, and imported academic content.

## Date integrity

`official source date` or `human confirmation` => confirmed.

A date inferred from title, description, speech, syllabus, or other free text => possible only. It must not silently populate the authoritative due date.

## Sync integrity

Every task has a stable Torgy UUID, version, updated timestamp, origin, and optional source-record ID. Sync packages use append-only changes rather than sharing the live local database.


## Remote WebView boundary

The Microsoft Copilot WebView is deliberately excluded from the local Torgy capability. Tauri versions must remain at or above the remote-origin ACL security fix line (2.11.1+) so remote origins cannot invoke custom Torgy commands without an explicit remote capability. No such remote capability is configured.
