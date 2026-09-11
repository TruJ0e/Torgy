# Torgy Academic Organizer

A private, task-first workspace for advisors and students. The working prototype includes one-tap task completion with timestamps and undo, advisor/student views, search and source filters, overdue detection, a week calendar, deterministic quick-add, proposal approval, mock integration status, JSON backup, offline device persistence, and a D1/SQLite-ready relational schema with migrations.

## Run

Requires Node 22.13+.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use the header role selector to exercise advisor and student permission surfaces.

## Verify

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm run db:generate
```

## Configuration and limitations

Copy `.env.example` to `.env.local`; never commit credentials. Canvas, Microsoft Graph, and the live Copilot/Edge bridge require institution/provider configuration and approval. Current UI sync uses safe mocks and never reports a real connection. D1 models and migration history are included; the visible prototype persists offline data per device until server routes and institutional identity are enabled.

See [architecture](docs/architecture.md), [security](docs/security.md), and [university rollout](docs/university-rollout.md).
