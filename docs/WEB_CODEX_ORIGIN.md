# Recovered Codex Web Build

This repository includes the original Codex-built Torgy web application under `apps/web-codex/`.

## Provenance

- Original build date: August 29, 2026.
- Codex task/thread ID: `01a04c2d-202a-7351-a1ce-ad4a8c823dc9`.
- Original product began as `Northstar academic organizer` and was renamed to Torgy during the same build session.
- The recovered local Git branch was six commits ahead of its original OpenAI Sites remote at recovery time.
- The recovered worktree also contained one uncommitted change in `app/page.tsx`; the snapshot imported here includes that working-tree version.
- Generated folders such as `node_modules`, `.next`, `.vinext`, `.wrangler`, and `dist` were not imported.

## Original build history

| Time (CDT) | Commit | Author | Message |
| --- | --- | --- | --- |
| 01:40:53 | `8fe26d3` | Codex | Build Northstar academic organizer |
| 02:02:56 | `be60deb` | Codex | Make calendar functional and refine responsive task UX |
| 02:08:59 | `82d0af5` | TruJ0e | Rebrand academic organizer as Torgy |
| 09:11:37 | `a533991` | TruJ0e | Connect info dump tasks and calendar |
| 09:53:30 | `75c8326` | TruJ0e | Refine calendar interactions and capture tools |
| 10:04:10 | `44f2460` | TruJ0e | Unify capture and expand workspace layout |
| 10:33:06 | `6018f58` | TruJ0e | Improve scheduling and task organization |
| 13:01:23 | `3457abb` | TruJ0e | Automate Torgy task organization and Cloudflare hosting |
| 13:25:33 | `cf8fc87` | TruJ0e | Simplify Torgy task header and info dump |
| 13:40:38 | `67ff583` | TruJ0e | Fix recurring moves and calendar durations |
| 14:01:43 | `0cffa4f` | TruJ0e | Improve Torgy scheduling and info parsing |
| 14:16:18 | `7c2d32b` | TruJ0e | Simplify Torgy task details |

## Repository layout

- Root repository: current local-first Tauri/Vite Windows Torgy application.
- `apps/web-codex/`: recovered August 29 Vinext/Cloudflare web application.

The two implementations intentionally remain separately runnable. Shared features can now be reconciled into the current desktop architecture from one canonical private repository without losing the recovered source.
