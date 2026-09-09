import { api, ApiError } from "../api.ts";
import { confirmDialog, showModal } from "../components/modal.ts";
import { toast } from "../components/toast.ts";
import { openTripModal } from "../components/tripModal.ts";
import { openCaptureWizard } from "../components/captureWizard.ts";
import { clear, h } from "../dom.ts";
import { formatKm, formatNzd, fyWindow } from "../../../shared/claims.ts";
import { useSplit } from "../components/useSplit.ts";
import type { CalEventDto, JobDto, VehicleDto } from "../../../shared/types.ts";

const LAST_VEHICLE_KEY = "jt:lastVehicle";

function localDay(date: Date): string {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function thumbOf(log: JobDto["startLog"]): HTMLElement {
  if (log?.hasPhoto) {
    return h("img", { class: "photo", style: "width:64px;height:48px;object-fit:cover;flex:none", src: api.photoUrl(log.id, "thumb"), alt: "" });
  }
  return h("div", { style: "width:64px;height:48px;border:1px dashed var(--line);flex:none;border-radius:var(--r-xs);display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:0.6rem" }, log ? "NO PHOTO" : "");
}

// Job target picker ----------------------------------------------------------

async function pickTarget(onChosen: (job: JobDto, role: "start" | "end") => void): Promise<void> {
  const [events, jobs] = await Promise.all([api.upcomingEvents(21).catch(() => [] as CalEventDto[]), api.jobs().catch(() => [] as JobDto[])]);
  const body = h("div", { class: "col" });

  const openJobs = jobs.filter((j) => j.status === "open" || j.status === "ready");
  const inFlight = openJobs.filter((j) => !(j.startLogId != null && j.endLogId != null));
  if (inFlight.length > 0) {
    body.append(h("h3", { style: "color:var(--fg-dim);text-transform:uppercase;font-size:0.75rem;letter-spacing:0.05em" }, "Continue a trip"));
    for (const j of inFlight) {
      const needs = j.startLogId == null ? "start photo" : "end photo";
      const b = h("button", { class: "btn", style: "justify-content:space-between;width:100%" },
        h("span", {}, j.client),
        h("span", { class: "text-dim", style: "font-size:0.75rem;font-weight:400" }, `${j.jobDate} • needs ${needs}${j.vehiclePlate ? ` • ${j.vehiclePlate}` : ""}`),
      );
      b.onclick = () => {
        modal.close();
        onChosen(j, j.startLogId == null ? "start" : "end");
      };
      body.append(b);
    }
  }

  const withEvent = new Map<string, JobDto>();
  for (const j of openJobs) if (j.eventUid) withEvent.set(j.eventUid, j);

  const upcoming = events.filter((e) => e.startAt != null);
  if (upcoming.length > 0) {
    body.append(h("h3", { style: "color:var(--fg-dim);text-transform:uppercase;font-size:0.75rem;letter-spacing:0.05em" }, "From calendar"));
    const groups = new Map<string, CalEventDto[]>();
    for (const e of upcoming) {
      const day = e.startAt!.slice(0, 10);
      const list = groups.get(day) ?? [];
      list.push(e);
      groups.set(day, list);
    }
    for (const [day, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      body.append(h("div", { class: "text-dim", style: "font-size:0.75rem;font-weight:600;margin-top:4px" }, day));
      for (const e of [...list].sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1))) {
        const existing = withEvent.get(e.uid);
        const b = h("button", { class: "btn", style: "justify-content:space-between;width:100%" },
          h("span", {}, `${fmtTime(e.startAt)} — ${e.summary}`),
          h("span", { class: "text-dim", style: "font-size:0.75rem;font-weight:400" }, e.location || "no address"),
        );
        b.onclick = async () => {
          modal.close();
          if (existing) {
            onChosen(existing, existing.startLogId == null ? "start" : "end");
          } else {
            try {
              const job = await api.createJob({ eventUid: e.uid });
              onChosen(job, "start");
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), "err");
            }
          }
        };
        body.append(b);
      }
    }
  } else {
    body.append(h("p", { class: "text-dim", style: "font-size:0.85rem" }, "No upcoming calendar events. Link your iCloud calendar in Settings to pick jobs here."));
  }

  body.append(h("h3", { style: "color:var(--fg-dim);text-transform:uppercase;font-size:0.75rem;letter-spacing:0.05em;margin-top:6px" }, "Manual job — travel type"));

  const presetRow = h("div", { class: "row", style: "gap:6px;margin-bottom:4px" });
  const group = (title: string, list: Array<{ label: string; template: string; notes: string; business: boolean }>) => {
    const wrap = h("div", { class: "col", style: "gap:4px" });
    wrap.append(h("span", { class: "text-dim", style: "font-size:0.72rem;font-weight:600" }, title));
    const chips = h("div", { class: "row", style: "gap:6px" });
    for (const p of list) {
      const chip = h("button", { class: p.business ? "btn outline sm" : "btn sm" }, p.label);
      chip.onclick = () => {
        chosenKind = p.business ? "business" : "personal";
        name.value = p.template;
        notesValue = p.notes;
        go.textContent = p.business ? "Start job (claimable)" : "Start trip (not claimable)";
        for (const other of document.querySelectorAll<HTMLElement>(".preset-on")) other.classList.remove("preset-on");
        chip.classList.add("preset-on");
        name.focus();
      };
      chips.append(chip);
    }
    wrap.append(chips);
    presetRow.append(wrap);
  };
  group("Claimable (business)", [
    { label: "Client session", template: "", notes: "PT session", business: true },
    { label: "Between clients", template: "", notes: "Client-to-client transfer", business: true },
    { label: "Equipment / gear", template: "", notes: "Bulky training gear transport", business: true },
    { label: "Supply run", template: "", notes: "Business supply run", business: true },
  ]);
  group("Not claimable (personal)", [
    { label: "Commute to gym", template: "Commute to regular gym (not claimable)", notes: "Fixed workplace commute", business: false },
    { label: "Personal errand", template: "Personal errand", notes: "", business: false },
    { label: "Social / leisure", template: "Social / leisure", notes: "", business: false },
  ]);

  const name = h("input", { class: "neon-input", placeholder: "Client / purpose (e.g. Sarah, PT session)" }) as HTMLInputElement;
  const date = h("input", { class: "neon-input", type: "date", value: localDay(new Date()) }) as HTMLInputElement;
  const loc = h("input", { class: "neon-input", placeholder: "Location (optional)" }) as HTMLInputElement;
  let chosenKind: "business" | "personal" = "business";
  let notesValue = "";
  const go = h("button", { class: "btn primary", style: "width:100%" }, "Start job (claimable)");
  go.onclick = async () => {
    const client = name.value.trim();
    try {
      const job = await api.createJob({
        client: client || undefined,
        location: loc.value.trim() || undefined,
        jobDate: date.value || undefined,
        kind: chosenKind,
        notes: notesValue || undefined,
      });
      modal.close();
      onChosen(job, "start");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  };
  body.append(presetRow,
    h("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:10px" },
      h("div", { class: "field", style: "grid-column:1/-1;margin:0" }, h("label", {}, "Client / purpose (optional for now)"), name),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Date"), date),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Location"), loc),
      h("div", { style: "grid-column:1/-1" },
        go,
        h("p", { class: "text-faint", style: "font-size:0.74rem;margin-top:6px;text-align:center" },
          "Leave the name blank to start now — rename it later from the trip's details popup."),
      ),
    ),
  );
  const modal = showModal({ title: "What is this photo for?", body, wide: true });
}

// Page -------------------------------------------------------------------------

function manualSavedPopup(saved: JobDto): void {
  openTripModal(saved, rerender);
}

export async function renderDashboard(root: HTMLElement): Promise<void> {
  clear(root);
  const [jobs, vehicles] = await Promise.all([api.jobs(), api.vehicles()]);
  const year = fyWindow(localDay(new Date()));
  const fyJobs = jobs.filter((j) => j.jobDate >= year.from && j.jobDate <= year.to);
  const lodged = fyJobs.filter((j) => j.status === "claimed" || j.status === "submitted" || j.status === "paid");
  const lodgedAmount = lodged.reduce((sum, j) => sum + (j.amountCents ?? 0), 0);
  const open = jobs.filter((j) => j.status === "open" || j.status === "ready");
  const today = localDay(new Date());
  const todayTrips = open.filter((j) => j.jobDate === today);

  const cta = h("button", { class: "cta" }, "+ Log New Trip");
  const hero = h("div", { class: "hero" },
    h("h1", {}, "Log your next trip"),
    h("p", {}, "Photograph the odometer at the start and end of a job — readings, km and claim value follow. No photo handy? Pick “Later on”."),
    cta,
  );
  cta.onclick = () => startCapture(vehicles);

  const metric = (label: string, dotClass: string, value: string, sub: string) =>
    h("div", { class: "metric" },
      h("div", { class: "metric-label" }, h("span", { class: `dot ${dotClass}` }), label),
      h("div", { class: "metric-value" }, value),
      h("div", { class: "metric-sub" }, sub),
    );
  const metrics = h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px" },
    metric("Open trips", "amber", String(open.length), "awaiting photos or readings"),
    metric("Trips today", "teal", String(todayTrips.length), "started or in progress"),
    metric("Lodged this FY", "green", formatNzd(lodgedAmount), `${lodged.length} claimed / submitted / paid`),
  );
  root.append(hero, metrics);

  // Personal-use baseline
  const useCard = h("div", { class: "card", style: "margin-bottom:16px" });
  useCard.append(h("div", { class: "card-head" },
    h("div", { class: "card-title" }, "Personal-use baseline"),
    h("span", { class: "text-dim", style: "font-size:0.78rem" }, `${year.from} — ${year.to}`),
  ));
  const rows = useSplit(fyJobs);
  if (rows.length === 0 || (rows.length === 1 && rows[0]!.totalKm === 0)) {
    useCard.append(h("div", { class: "empty", style: "padding:18px" },
      h("div", { class: "empty-title" }, "No readings yet this year"),
      h("p", {}, "Once trips have readings, the distance between trips that no job covers counts as personal use, and your business-use % appears here. It updates automatically as logs change."),
    ));
  } else {
    const grid = h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px" });
    for (const row of rows) {
      const stat = (label: string, value: string) =>
        h("div", { class: "metric", style: "border-color:var(--line)" },
          h("div", { class: "metric-label" }, label),
          h("div", { class: "metric-value", style: "font-size:1.15rem" }, value),
        );
      grid.append(h("div", { class: "col", style: "gap:8px" },
        h("div", { style: "font-weight:600;font-size:0.85rem" }, row.label),
        h("div", { class: "row", style: "gap:8px;align-items:stretch" },
          stat("Work", `${formatKm(row.workKm)} km`),
          stat("Personal", `${formatKm(row.personalKm)} km`),
        ),
        row.pct != null
          ? h("p", { style: "font-size:0.85rem;color:var(--fg-dim)" },
            h("span", { class: "mono", style: "color:var(--accent);font-size:1.05rem" }, `${row.pct}%`),
            "  business use")
          : h("p", { class: "text-faint", style: "font-size:0.8rem" }, "No distance to split yet"),
      ));
    }
    useCard.append(grid);
    useCard.append(h("p", { class: "text-faint", style: "font-size:0.76rem;margin-top:10px" },
      "Personal km = odometer distance between consecutive trip photos that no job covers, plus trips logged as personal. Baseline only — fully accurate splits need every outing logged."));
  }
  root.append(useCard);

  if (vehicles.length === 0) {
    root.append(h("div", { class: "card" },
      h("div", { class: "empty" },
        h("span", { class: "empty-glyph" }, "· · ·"),
        h("div", { class: "empty-title" }, "No vehicles yet"),
        h("p", {}, "Add your car(s) in Settings first — each trip logs against a vehicle and its rate."),
      ),
    ));
    return;
  }

  // Trips in progress
  const openSection = open.filter((j) => j.startLogId == null || j.endLogId == null);
  if (openSection.length > 0) {
    const card = h("div", { class: "card", style: "margin-bottom:16px" });
    card.append(h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Trips in progress")));
    for (const j of openSection) {
      const row = h("div", { class: "trip-row row-click", onclick: () => openTripModal(j, rerender) });
      const roleBtn = h("button", { class: j.startLogId == null ? "btn sm primary" : "btn sm" },
        j.startLogId == null ? "Take start photo" : "Take end photo");
      roleBtn.onclick = (e: Event) => {
        e.stopPropagation();
        const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
        const vehicleId = j.vehicleId ?? Number(localStorage.getItem(LAST_VEHICLE_KEY) ?? 0);
        const v = vehiclesById.get(vehicleId) ?? vehicles.find((x) => x.active) ?? vehicles[0];
        if (!v) return;
        openCaptureWizard({ job: j, role: j.startLogId == null ? "start" : "end", vehicleId: v.id, onManualSaved: manualSavedPopup }, rerender);
      };
      const del = h("button", { class: "icon-btn danger", title: "Delete trip", "aria-label": "Delete trip" }, "✕");
      del.onclick = (e: Event) => {
        e.stopPropagation();
        void confirmDeleteTrip(j);
      };
      row.append(
        thumbOf(j.startLog),
        h("div", { class: "col", style: "gap:1px;flex:1;min-width:0" },
          h("span", { style: "font-weight:600" }, j.client),
          h("span", { class: "text-dim", style: "font-size:0.78rem" },
            `${j.jobDate}${j.vehiclePlate ? ` • ${j.vehiclePlate}` : ""}${j.startLog?.takenAt ? ` • start ${fmtTime(j.startLog.takenAt)}` : ""}`),
        ),
        roleBtn,
        del,
      );
      card.append(row);
    }
    root.append(card);
  }

  // Recent trips (open trips hidden unless toggled)
  const showOpenTrips = showOpenInRecent;
  const recentSource = showOpenTrips ? jobs : jobs.filter((j) => j.status !== "open");
  const recent = recentSource.slice(0, 8);
  const hiddenOpen = jobs.length - recentSource.length;
  const recCard = h("div", { class: "card" });
  const toggle = h("button", { class: showOpenTrips ? "btn sm outline preset-on" : "btn sm ghost", style: "white-space:nowrap" },
    showOpenTrips ? "Hide open trips" : `Show open trips${hiddenOpen > 0 ? ` (${hiddenOpen})` : ""}`);
  toggle.onclick = () => {
    showOpenInRecent = !showOpenInRecent;
    void rerender();
  };
  recCard.append(h("div", { class: "card-head" },
    h("div", { class: "row", style: "gap:8px" },
      h("div", { class: "card-title" }, "Recent trips"),
      h("span", { class: "text-dim", style: "font-size:0.8rem" }, `${recent.length} shown — click a trip to view / edit`),
    ),
    toggle,
  ));
  if (recent.length === 0) {
    recCard.append(h("div", { class: "empty" },
      h("div", { class: "empty-title" }, "No trips logged yet"),
      h("p", {}, "Click + Log New Trip above to start tracking your first job."),
    ));
  } else {
    for (const j of recent) {
      const row = h("div", { class: "trip-row row-click", onclick: () => openTripModal(j, rerender) });
      const kindChip = j.tripKind === "personal"
        ? h("span", { class: "chip personal" }, "Personal")
        : h("span", { class: `chip ${j.status}` }, j.status);
      const del = h("button", { class: "icon-btn danger", title: "Delete trip", "aria-label": "Delete trip" }, "✕");
      del.onclick = (e: Event) => {
        e.stopPropagation();
        void confirmDeleteTrip(j);
      };
      row.append(
        h("div", { class: "col", style: "gap:1px;flex:1;min-width:0" },
          h("div", { class: "row", style: "gap:8px" },
            h("span", { style: "font-weight:600" }, j.client),
            kindChip,
          ),
          h("span", { class: "text-dim", style: "font-size:0.78rem" },
            [j.jobDate, j.vehiclePlate, j.location].filter(Boolean).join("  •  ")),
        ),
        h("span", { class: "mono text-dim", style: "font-size:0.85rem" },
          j.km != null ? `${j.km.toLocaleString("en-NZ")} km` : "—"),
        h("span", { class: "mono", style: "font-size:0.9rem;color:var(--accent);min-width:76px;text-align:right" },
          j.amountCents != null ? formatNzd(j.amountCents) : ""),
        del,
        h("span", { class: "trip-arrow" }, "›"),
      );
      recCard.append(row);
    }
  }
  root.append(recCard);
}

function startCapture(vehicles: VehicleDto[]): void {
  pickTarget((job, role) => {
    const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
    const vehicleId = job.vehicleId ?? Number(localStorage.getItem(LAST_VEHICLE_KEY) ?? 0);
    const v = vehiclesById.get(vehicleId) ?? vehicles.find((x) => x.active) ?? vehicles[0];
    if (!v) return;
    localStorage.setItem(LAST_VEHICLE_KEY, String(v.id));
    openCaptureWizard({ job, role, vehicleId: v.id, onManualSaved: manualSavedPopup }, rerender);
  });
}

async function rerender(): Promise<void> {
  const main = document.querySelector("main");
  if (main) await renderDashboard(main as HTMLElement);
}

let showOpenInRecent = false;

async function confirmDeleteTrip(job: JobDto): Promise<void> {
  if (!(await confirmDialog({
    title: `Delete "${job.client}"?`,
    message: "Removes the trip, its photos, readings and any lodged claim. This cannot be undone.",
    confirmLabel: "Delete trip",
    danger: true,
  }))) return;
  try {
    await api.deleteJob(job.id);
    toast("Trip deleted");
    await rerender();
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "err");
  }
}
