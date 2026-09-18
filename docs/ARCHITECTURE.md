# Architecture

## Goal

One installable Windows desktop application with two role modes: coordinator and student. Both roles use the same codebase and task schema. Coordinator/student separation is enforced by local role behavior, pairing, and the remote transport permissions rather than by maintaining separate products.

## Local core

- React UI bundled inside Tauri.
- Rust backend in the same installation.
- Current-user DPAPI-protected application snapshot in the user's app-data directory.
- DPAPI-protected Outlook and Canvas credential caches.
- Local task/calendar/student state.
- Local append-only outbound synchronization queue.
- Local Windows speech capture.
- Backup export + schema-validated restore.
- No hosted Torgy server.
- No telemetry by default.
- Windows packaging carries the offline WebView2 installer so end-user installation does not require a runtime download.

## Trust boundaries

### Main Torgy WebView
Bundled application code only. It may invoke the explicitly registered Torgy commands.

### Copilot WebView
Remote Microsoft HTTPS content. It does not receive Torgy IPC capabilities. The Rust host may inspect and interact with visible DOM controls. Torgy intentionally does not read cookies, auth tokens, localStorage, sessionStorage, or passwords from the Copilot page.

### Local state
The application snapshot is protected with Windows current-user DPAPI. A university may substitute another approved local-at-rest mechanism later without changing the logical data model.

### Local student sync spool
`%ProgramData%\Torgy\spool` contains encrypted transport packets only. The interactive user can write/read the opaque spool. Agent configuration remains restricted to SYSTEM/Administrators.

### Managed student sync worker
The separately installed Torgy Machine Agent creates a scheduled task that runs the administrator-protected `torgy-machine-agent.exe` from Program Files as SYSTEM once per minute. The current-user Torgy executable is never a SYSTEM task target. The agent moves encrypted packets between the local spool and the university-approved staff/faculty synchronization location; the student interactive account receives neither the share credential nor browse permission.

### Coordinator transport
Coordinator installations may use direct staff-drive access under the coordinator's authorized staff identity. The coordinator app still exchanges encrypted task envelopes rather than opening a shared live database.

## Synchronization crypto

Each local installation creates a random X25519 identity. Pairing exchanges only public keys. Per-mailbox shared keys are derived from X25519 Diffie-Hellman output plus the mailbox ID. Individual envelopes are encrypted/authenticated with ChaCha20-Poly1305 using a fresh random nonce and mailbox ID as associated data.

The share sees opaque `.torgy` packet files and pairing metadata; it is never the live Torgy database.

## Duplicate/convergence model

1. Same task UUID → version comparison/update.
2. Same authoritative source ID → merge.
3. Same deterministic fingerprint → merge.
4. High-confidence independent same-student/course/title/date copies → merge.
5. Ambiguous similarity → local duplicate-review queue.
6. Processed envelope IDs are remembered so repeated delivery is idempotent.
7. Task aliases remember merged IDs so later packets converge on one canonical record.

## Outlook boundary

Torgy uses Entra public-client OAuth authorization-code + PKCE and delegated calendar access. Tokens are stored locally with DPAPI. Torgy adds opaque task markers and a `Torgy` category to its events.

Important semantic rule:

- `dueDate` = academic deadline.
- `scheduledAt` = planned work/meeting time.

Outlook edits can change `scheduledAt`, duration, and Torgy-created Outlook-only titles. They do not modify `dueDate`, `possibleDate`, or academic date confidence.

## Academic import boundary

Torgy accepts local JSON/CSV/TSV exports and optionally direct Canvas access. Canvas official `due_at` remains authoritative. Date text detected from title, description, a matching module item, or syllabus text near the assignment name is always returned as Possible only.

## Integration isolation

1. **Copilot** — optional Info Dump language organizer.
2. **Outlook** — optional two-way calendar sync.
3. **Academic source** — local Docs/file import or approved direct Canvas.
4. **Coordinator sync** — encrypted task-envelope exchange through approved university transport.

Every connector can fail or be disabled independently. Core local tasks remain usable offline.
