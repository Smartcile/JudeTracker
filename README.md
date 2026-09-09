# JudeTracker

Single-user mileage tracker for NZ business travel claims. Log odometer photos against client jobs from an iCloud calendar, then pair the readings up on the laptop with an odometer dial and track the claimable amount per trip.

**Stack:** Node.js + TypeScript (Express 5) · Postgres 16 · Drizzle ORM · vanilla TS single-page app (Vite) · Docker Compose.

## What it does

- **Log page (phone)** — take a photo of the odometer (saves automatically) or **"Use an existing photo"**; no photo handy? **"Later on"** logs the trip anyway (GPS + time + vehicle) and you enter the reading later. The app records time + GPS (live fix, or reads GPS from the photo's EXIF). Manual jobs pick a **travel-type preset** (PT client session, between clients, equipment/gear, supply run — claimable; gym commute, errands, leisure — recorded as **personal**, excluded from claims but counted in your personal-use split). An unnamed job can be started and named later.
- **Trip details popup** — click any trip (Log page lists, Review table, or Calendar chips) to open an editable popup: client/purpose, location, notes, both photo slots (capture, readings via the dial, delete photo), claim status flow, and delete trip. A **searchable calendar linker** shows the linked booking and lets you search the synced feed to link, change or unlink the trip from an event.
- **Calendar page** — month view of your iCloud bookings with a "trip exists" indicator, per-event trip creation, and a manual "+ New trip" button.
- **FAQ tab** — in-app IRD guidance for vehicle & kilometre claims: home→client rules, return legs, client-to-client travel, the 14,000 km tier structure and logbook record requirements, plus a quick-reference claimability table.
- **Jobs come from an iCloud calendar** — paste the *Public Calendar* (webcal / `.ics`) share link in Settings. Events become jobs with client + address.
- **Review page (laptop)** — each job shows its two photos side by side. Click **ENTER** next to a photo to type the odometer reading into a mechanical-style dial: digits are prefilled from the previous chronological reading, typing auto-advances, arrow keys / on-wheel arrows roll digits. Readings that would go below an earlier one are rejected; the dial always shows the increase.
- **Money** — km = end − start, × the vehicle's rate ($NZ/km, IRD-style, per vehicle, editable; optionally tiered: rate 1 up to a yearly km limit per vehicle, then rate 2 — the split follows the NZ claim year 1 Jul–30 Jun) = claimable amount. Rate is snapshotted when you lodge a claim. Move jobs through `open → ready → claimed → submitted → paid`, view monthly / NZ financial-year totals, and export the full logbook as CSV.
- **Business-use % (personal-use baseline)** — distance between consecutive trip photos that no job covers counts as **personal km** (e.g. the odometer roll between the end of one job and the start of the next). The app derives work km, personal km and the business-use % from current readings, so the split updates automatically whenever any log or reading is edited. See it on the dashboard (this FY) and on Review (selected period, per vehicle). Handy for the IRD actual-costs logbook method — note it is a baseline: personal trips that aren't bracketed by work-trip photos aren't measured yet (see ROADMAP).
- **PIN login** with idle auto-lock.

## Run it

Requires [Docker](https://docs.docker.com/engine/install/) with Compose.

```bash
git clone <your repo url>
cd jude-tracker
docker compose up -d --build
```

Open http://localhost:8090 — the first screen asks you to create a 4–6 digit PIN.

**On Windows** just run the launcher (builds, starts, waits for health and opens the browser):

```powershell
powershell -ExecutionPolicy Bypass -File .\run-judetracker.ps1   # -Rebuild / -Down / -Port 9000 / -NoOpen
```

Every setting has a sane default and can be overridden with a local `.env` (see `.env.example`): `APP_PORT`, `POSTGRES_USER/PASSWORD/DB`, `COOKIE_SECURE`. The database port is bound to localhost only; the app port is the one to expose if you put a reverse proxy in front.

**Persistent data lives in Docker volumes** (`db_data`, `jt_data` for photos) — back them up, not the containers.

### Deploy on a server (prebuilt image)

Every push to `master` publishes the image to GitHub Container Registry (`ghcr.io/smartcile/judetracker:master`). On the server:

```bash
curl -O https://raw.githubusercontent.com/Smartcile/JudeTracker/master/compose.server.example.yaml
mv compose.server.example.yaml compose.yaml
# create a .env with POSTGRES_PASSWORD etc. (see .env.example)
docker compose up -d
```

`compose.server.example.yaml` is the image-based equivalent of the local `compose.yaml`.

### Local development

```bash
npm install
docker compose up -d db          # Postgres on host port 5433
npm run dev                      # API :8090 + Vite dev server :5173
```

Scripts: `dev`, `build`, `typecheck`, `test`, `start`, `db:generate`, `db:push`. Vitest covers the shared math/analysis, ICS parsing and DTO mappers (`npm run test`) — new pure logic must ship with cases (see AGENTS.md).

## Using it with iCloud

1. On iCloud.com → Calendar → the calendar of booked clients → **Share** → **Public Calendar** → copy the `webcal://…/calendar.ics` link (convert to `https://` if you prefer).
2. Paste it in JudeTracker → Settings → Client calendar → Save. The tracker polls it every 15 minutes and also syncs when you open the Log page.

## Phone access away from home (live GPS)

Browser GPS needs HTTPS. Recommended setup: run the Docker app on a small always-on machine at home and connect your phone over **Tailscale**:

```bash
tailscale up                    # on the server
tailscale serve --bg 8090       # serves https://<machine>.tailnet.ts.net -> :8090
```

Install the Tailscale app on the phone and open the HTTPS URL — you can now add it to your home screen (PWA). Without HTTPS the app still works; photo GPS is then read from EXIF instead of live.

## NZ mileage context

Keep your logbook records — the CSV export covers date, client, vehicle, odometer readings, km, rate and amount. The per-vehicle rate is whatever you set (IRD km rates change; edit the rate in Settings — lodged claims keep the rate they were lodged at). This app is a record-keeping tool, not tax advice.

## Project layout

```
client/            Vite + vanilla TS SPA (pages, odometer dial, theme CSS)
server/            Express API, Drizzle schema/migrations, ICS/EXIF/photo services
shared/            Pure logic shared by both sides (claims math, DTO types)
compose.yaml       db + app
Dockerfile         multi-stage build
scripts/           icon generation
```

More detail for AI agents in [AGENTS.md](AGENTS.md); the plan is in [ROADMAP.md](ROADMAP.md).
