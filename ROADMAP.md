# Roadmap

Milestones marked done shipped in v0.1; the rest are candidate improvements, roughly prioritised.

## Done — v0.1 (current)

- [x] PIN auth (4–6 digits, hashed), sessions with idle auto-lock + sliding expiry
- [x] Vehicles CRUD (plate, make/model, $NZ/km rate, odometer digit count) + first-run wizard-less setup screen
- [x] iCloud public calendar sync (ICS/webcal): upsert by UID, auto-poll 15 min, manual sync, error surfacing
- [x] Phone logging: camera / existing photo, live GPS with EXIF fallback, time capture, job picker (calendar events, active trips, manual jobs), vehicle memory
- [x] Review page: photo previews per job slot, odometer dial entry (prefill previous reading, auto-advance typing, arrow keys / wheel arrows, floor validation, increase readout)
- [x] Claims: km = end − start, rate snapshot on claim (optional IRD-style tiered rates per vehicle per claim year), statuses open → ready → claimed → submitted → paid, reopen
- [x] Totals by period (NZ financial year default) + per-vehicle breakdown
- [x] CSV logbook export
- [x] Calendar pruning: events removed from the iCloud feed are deleted, unless a job still references them (linked trips survive)
- [x] Delete an existing job (removes its photos + claim; photos shared with another job are kept)
- [x] Tiered IRD-style rates per vehicle (configurable km limit per claim year) in Settings
- [x] Modern dark-mode SaaS UI: slate palette + solid teal accent, rounded cards, metric-card dashboards, trips table with expandable rows, grouped Settings cards, blurred modal overlays, PWA manifest + icons, Docker Compose + multi-stage Dockerfile
- [x] Personal-use baseline: km between consecutive work-trip photos counts as personal; live work/personal split + business-use % on dashboard (FY) and review (period + per vehicle), recalculated whenever logs/readings change (`analyzeUse`/`businessUsePct` in `shared/claims.ts`)
- [x] Trip kinds + travel presets: manual jobs pick a scenario preset (client session, between clients, equipment/gear, supply run — claimable; commute/gym, personal errand, leisure — marked **personal** and excluded from claims/totals/CSV while counted in the personal-use split)
- [x] Delete trips from the dashboard "Recent trips" list (confirm dialog; Review's expanded rows also offer it)
- [x] In-app FAQ (IRD vehicle/km guidance from the supplied brief): FAQ tab with accordion Q&As and the quick-reference scenario table
- [x] Calendar page (month view of bookings, trip-exists markers, create-trip-from-event, manual new trip) + searchable link/unlink of trips to calendar events from the trip details popup (`PATCH /api/jobs/:id { eventUid }`)

## Next candidates (not built — do not add without asking)

- [ ] **Manual pairing / re-pairing of photos to job slots** (a boundary photo between two jobs on one outing currently can't belong to both)
- [ ] Odometer OCR — auto-read the reading from the photo, dial pre-filled for confirmation
- [ ] Offline photo queue on the phone (queue uploads when the home network is unreachable)
- [ ] Photo viewing on the phone from the Review page in the field (already possible on laptop)
- [ ] Monthly email/notification nudge for un-entered readings
- [ ] Rate-change alerts when IRD announces new km rates
- [ ] Annual logbook PDF with photo contact sheet for paper records
- [ ] Optional second user / multi-device calendar-level PINs (currently single-user by design)

## Maintenance notes

- Postgres migrations live in `server/drizzle` — regenerate with `npm run db:generate` after schema changes and commit the SQL.
- When IRD rates change: edit rates in Settings; lodged claims keep their snapshot.
- Watch `SESSION_IDLE_MINUTES`/`SESSION_TTL_MINUTES` env knobs if lock behaviour needs tuning.
