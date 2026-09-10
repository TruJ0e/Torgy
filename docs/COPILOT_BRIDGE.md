# Copilot bridge

## Purpose

Copilot is used only as the university-approved language organizer behind Info Dump. Torgy remains responsible for local speech capture, schema validation, review, and database changes.

```text
local speech -> transcript -> Copilot prompt -> JSON suggestions -> local validator -> human review -> task(s)
```

## Security boundary

- Copilot runs in a separate Microsoft HTTPS WebView profile.
- The remote page is not granted Torgy IPC capabilities.
- Torgy does not scrape Microsoft auth tokens, cookies, passwords, localStorage, or sessionStorage.
- The bridge reads/interacts with visible page controls only.
- Authentication stays in the Microsoft/Edge WebView.

## Diagnostic

Settings → Copilot bridge → Test opens the approved URL and reports visible candidate:

- editable controls
- send/chat buttons
- response containers

The probe returns page metadata and element attributes only. This allows the live university Copilot DOM to be validated without exposing authentication material.

## Output contract

Copilot is instructed to return JSON only. Torgy validates the shape and ignores any Copilot-provided internal student ID, using the locally selected student instead.

All dates originating from Info Dump remain **Possible** when inserted into Torgy, including dates Copilot considered explicit. A human must confirm them before they become authoritative academic due dates.

## Failure behavior

If Copilot is disabled or unavailable, the core application still works. Development builds can use the deterministic local organizer, which does not pretend to provide AI-level correction.
