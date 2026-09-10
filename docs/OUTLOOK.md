# Outlook calendar integration

## Authentication

Torgy uses Microsoft Entra as a public desktop client with authorization-code + PKCE. There is no embedded client secret. The system browser handles sign-in and returns the authorization code to a temporary loopback listener bound to `127.0.0.1` on a random port.

Access/refresh tokens are cached locally using Windows DPAPI.

## Sync semantics

Torgy uses Microsoft Graph calendar delta synchronization and stores the delta link locally. Torgy-created events carry:

- `Torgy` category
- Torgy task ID marker
- Torgy student ID marker
- Torgy task version marker
- transaction ID on event creation

These are used to reconnect events after restore/reinstall and to reduce accidental duplicate event creation.

## Critical rule

Outlook is a **schedule**, not the academic source of truth.

- Academic due date: `dueDate` / `possibleDate`.
- Planned work or meeting time: `scheduledAt`.

Dragging, editing, or deleting a linked Outlook event updates/clears `scheduledAt` only. It never changes an assignment's due date or date-confidence state.

## Two-way flow

```text
Torgy scheduled task -> Graph event
Graph event moved      -> Torgy scheduledAt changes
Graph event deleted    -> Torgy scheduledAt clears
Torgy schedule removed -> Graph event deleted
```

Only Outlook events categorized `Torgy` are imported as new Torgy records.
