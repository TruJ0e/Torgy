# Architecture

Vinext/React renders the shared responsive PWA. Product state is isolated from UI through `lib/domain.ts`; Drizzle describes portable SQLite/D1 tables for users, advisor relationships, tasks, recurrence, immutable task activity, calendar events, and sync runs. Provider boundaries are feature-flagged: Canvas REST, Microsoft Graph delegated calendar read, and Copilot browser automation must normalize into tasks/events and never bypass approval. A desktop wrapper should load this same UI rather than fork it.

Timestamps are stored as UTC ISO strings and displayed in the browser timezone. Source type plus external ID is unique to make repeated sync idempotent.
