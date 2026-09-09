# AGENTS.md — working in this repo

Guide for coding agents (opencode, etc.). Read before editing. Keep this file current when structure or conventions change.

## Commands (run from repo root)

- `npm run dev` — API (tsx watch, :8090) + Vite (:5173), DB must be up
- `npm run typecheck` — `tsc` for server and client (must pass)
- `npm run test` — vitest (shared math/analysis, ICS parser, DTO mappers; pure units only)
- `npm run build` — typecheck + client bundle into `client/dist`
- `npm run start` — run API in prod mode (serves `client/dist` statically)
- `npm run db:generate` / `db:push` — Drizzle migrations (from repo root; Postgres URL defaults to `postgres://judetracker:judetracker@localhost:5433/judetracker`)

**Dev DB:** `docker compose up -d db` (host port **5433** — 5432 is often taken on this machine by other projects). The compose `app` container maps host **8090** because 8080 is also used by another project here. Keep those ports consistent everywhere (config.ts, compose.yaml, vite proxy).

## Mandatory workflow (applies to EVERY change)

1. **Tests are written, always.** Any change that touches logic — shared math/analysis (`shared/*.ts`), DTO mappers (`server/src/api/mappers.ts`), parsers/validators/formatting, reading rules, ICS/exif handling — MUST add or update vitest cases in the same change. New pure functions ship with a test from the start. Files: `shared/*.test.ts` and `server/test/*.test.ts` (fixtures under `server/test/fixtures/`). No test doubles or DB required: keep the logic under test pure and pass row-shaped objects in. UI-only tweaks without logic still don't require tests, but the suite must keep passing.
2. **Gates pass before finishing:** `npm run typecheck` then `npm run test` (use `npm.cmd` on Windows PowerShell — `npm.ps1` is blocked), and `npm run build` when the client changed. Do not leave the repo red.
3. **Docs are updated in the same change** whenever behaviour, commands or structure change:
   - `ROADMAP.md` — move shipped items to the Done list, add/update next candidates honestly, keep the "not built — do not add without asking" framing.
   - `README.md` — keep the feature bullets, run instructions and data notes truthful.
   - `AGENTS.md` — update commands, conventions, architecture map and gotchas when they change.
   Ask the user before marking large aspirational items done; small increments are fine to update immediately.

## Conventions

- **No code comments** unless asked; keep everything minimal and explicit.
- All source is TypeScript run directly (no emit): `tsx` for the server, Vite for the client. Imports across the `shared/` folder use explicit `../….ts` extensions (moduleResolution "bundler" + `allowImportingTsExtensions`).
- Do not add new npm deps casually — the stack is deliberately small (express, drizzle-orm, pg, zod, multer, sharp, exifr, node-ical, bcryptjs, tsx; client has zero runtime deps).
- Money: integer **cents** everywhere (`rateCents`, `amountCents`). km are integers.
- Odometer readings are integers, floored against the previous chronological reading per vehicle (server enforces in `server/src/services/readings.ts`); the client dial is cosmetic + fast feedback only.
- Job states: `open → ready → claimed → submitted → paid`. Once claimed: readings locked, vehicle rate snapshotted into `jobs.rate_cents`; `reopen` reverses both.
- Rates may be **tiered** (IRD style): a vehicle can carry `tier_km` (yearly km limit) + `tier_rate_cents`; when lodging a claim the server blends rate 1 / rate 2 across km already claimed that claim year (1 Jul–30 Jun) and snapshots the blended whole-cent rate (`tieredBlendedRateCents` in `shared/claims.ts`).
- **Personal-use baseline** is derived, never stored: `analyzeUse` in `shared/claims.ts` walks each vehicle's logs chronologically — segments between two photos of *different* jobs count as personal km; a job's own start→end segment is work km unless `jobs.trip_kind` is `personal` (explicit personal trips, logged via presets on the Log page, add their km to personal and are excluded from claims/totals/CSV). Because it derives from the same DTOs the UI renders, percentages always reflect current logs. Client surfaces: `components/useSplit.ts` → dashboard (FY card) + review (period panel). Personal travel that isn't logged at all is still not measured (ROADMAP).

## Architecture

- `server/src/app.ts` — route mounting. Note the mounting scheme: routers mounted at `/api/<name>` define paths relative to themselves (e.g. `jobsRouter` is mounted at `/api/jobs` with `/` and `/:id`); routers mounted at bare `/api` define full paths (`/jobs/:id/logs`, `/claims/summary`). This has burned us once.
- `server/src/db/schema.ts` — drizzle schema, source of truth for migrations in `server/drizzle/` (committed; boot runs `migrate`).
- `server/src/api/mappers.ts` — row → DTO (camelCase JSON) conversion. `shared/types.ts` defines all DTOs; keep the two in sync.
- `server/src/services/` — ical fetch/parse, exif GPS, sharp photo storage (`{DATA_DIR}/photos/log-<id>/orig.<ext>` + `thumb.jpg` + `full.jpg`), reading rules, calendar sync, job assembly.
- `client/src/` — vanilla TS, no framework. `dom.ts` `h()` hyperscript helper. Pages: `pages/dashboard.ts` (phone logging), `pages/review.ts` (laptop: readings + claims + totals), `pages/settings.ts` (vehicles, calendar, PIN, export), `pages/calendar.ts` (month view of booked clients), `pages/faq.ts` (IRD FAQ, content in `data/faq.ts`). Components: `components/captureWizard.ts` (Take photo / existing photo / "Later on" no-photo flow, auto-saves), `components/tripModal.ts` (the shared editable trip popup used by every list — editing, photo capture, readings, claims, delete), `dial.ts` (odometer dial modal), `pinpad.ts`, `modal.ts`, `toast.ts`, `useSplit.ts` (per-vehicle use analysis rows).
- Test suites: `shared/claims.test.ts`, `server/test/ical.test.ts`, `server/test/mappers.test.ts` — extend these patterns rather than inventing new harnesses.
- Styling: `client/src/styles/theme.css` — modern dark-mode SaaS design system. Slate palette (`--bg: #0b0f19`, surface `#111827`), solid teal accent (`--accent: #14b8a6`), rounded corners (`--r-sm/md/lg`), sans-serif UI (`--font-ui`), monospace only for plates, odometer readings and the dial. Components: `.card`, `.metric`, `.tbl` (trips table with expandable rows), `.btn` (+ `primary | outline | danger | ghost`), `.badge`, `.chip` (status), `.empty`, `.modal-overlay/.modal-panel`. Back-compat class `.neon-btn` is an alias for `.btn`. Keep the look consistent: deep slate surfaces, soft shadows, no neon glows, no all-caps text styling.

## Data/API notes

- Photos are served via authenticated route `/api/photos/:id?size=thumb|full|orig`. Logs may exist **without** a photo (`logs.has_photo = false`, the "Later on" manual flow) — photo endpoints 404 for them and UIs render a dashed "no photo" placeholder; readings work regardless.
- A job's start/end are two `logs` rows referenced by `jobs.start_log_id` / `end_log_id` (a log may never be shared between two jobs in the current UI — see ROADMAP).
- GPS sources: `live` (browser geolocation), `exif` (read from photo), `none`. When a log arrives with a photo but no coordinates the server tries EXIF.
- Calendar events are upserted by UID from the configured ICS URL; on every sync, events missing from the feed are pruned unless a job references their `event_uid` (job-linked rows survive; `syncCalendar` returns `{added, updated, removed, total}`).
- Jobs may be deleted via `DELETE /api/jobs/:id` — the job's two logs and their photo files are removed too, unless another job still references a shared log (only the reference is dropped then).

## Gotchas

- PowerShell on this machine blocks `npm.ps1` — always use `npm.cmd` in shells.
- `docker compose up -d db` only starts Postgres for dev; full stack needs `docker compose up -d --build`.
- Express 5 auto-forwards async errors; JSON body parse failures arrive as `SyntaxError` (500 via errorHandler) — validate client JSON before sending.
- `confirmDialog` (modal.ts) must `resolve(true)` on the confirm button **before** calling `modal.close()` — closing fires `onClose`, which resolves false (this silently cancelled every confirmation once; there is a comment in the file).
