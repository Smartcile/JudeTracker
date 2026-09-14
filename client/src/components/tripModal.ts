import { api } from "../api.ts";
import { confirmDialog, showModal, type ModalHandle } from "./modal.ts";
import { toast } from "./toast.ts";
import { openDialModal } from "./dial.ts";
import { openCaptureWizard } from "./captureWizard.ts";
import { locationPicker } from "./locationPicker.ts";
import { distanceSelect, fromLocalInput, lastTravelMinutes, timingHelper, toLocalInput, travelTimeSelect } from "./timingHelper.ts";
import { h } from "../dom.ts";
import { formatKm, formatNzd } from "../../../shared/claims.ts";
import { shiftIsoMinutes } from "../../../shared/time.ts";
import type { CalEventDto, JobDto, LogDto, SettingsDto, VehicleDto } from "../../../shared/types.ts";

const pad = (km: number | null, digits: number) => (km == null ? "······" : String(km).padStart(digits, "0"));

function statusChip(status: JobDto["status"]): HTMLElement {
  return h("span", { class: `chip ${status}` }, status);
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return `${iso.slice(0, 10)} ${new Date(iso).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`;
}

function fmtLatLng(lat: number | null, lng: number | null): string {
  return lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "";
}

async function openReading(job: JobDto, role: "start" | "end" | "return", logId: number, changed: () => Promise<void>): Promise<void> {
  const info = await api.readingInfo(logId);
  const digits = info.vehicleDigits ?? 6;
  const locked = info.jobStatus === "claimed" || info.jobStatus === "submitted" || info.jobStatus === "paid";
  const roleLabel = role === "return" ? "return (home)" : role;
  openDialModal({
    digits,
    startKm: info.log.readingKm ?? info.prevReadingKm ?? info.floorKm,
    floorKm: info.floorKm,
    capKm: info.capKm,
    prevKm: info.prevReadingKm,
    canEdit: info.canEdit && !locked,
    title: `${job.client} — ${roleLabel} reading${job.vehiclePlate ? ` (${job.vehiclePlate})` : ""}`,
    photoUrl: info.log.hasPhoto ? api.photoUrl(logId, "full") : null,
    onConfirm: async (value) => {
      await api.setReading(logId, value);
      await changed();
    },
  });
}

function noPhotoBox(text: string): HTMLElement {
  const box = h("div", {
    style:
      "min-height:96px;border:1px dashed var(--line);border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:0.8rem;text-align:center;padding:8px;background:rgba(15,23,42,0.4)",
  });
  box.textContent = text;
  return box;
}

function readingSlot(
  job: JobDto,
  role: "start" | "end" | "return",
  eventPromise: Promise<CalEventDto | null>,
  settingsPromise: Promise<SettingsDto | null>,
  changed: () => Promise<void>,
  onCapture?: () => void,
): HTMLElement {
  const log = role === "start" ? job.startLog : role === "end" ? job.endLog : job.returnLog;
  const slot = h("div", { class: "reading-slot", style: "gap:6px" });
  const label = role === "start" ? "Start" : role === "end" ? "End" : "Return (home)";

  if (!log) {
    if (role === "return") return h("div", {});
    slot.append(
      h("div", { class: "row spread" },
        h("span", { style: "font-weight:600;font-size:0.85rem" }, label),
        h("span", { class: "chip open" }, "no photo yet"),
      ),
      h("div", { class: "row", style: "gap:6px" },
        h("button", { class: "btn sm primary", onclick: () => onCapture?.() }, "Take / choose photo"),
        h("button", { class: "btn sm", onclick: () => onCapture?.() }, "Later on (no photo)"),
      ),
      h("p", { class: "text-faint", style: "font-size:0.78rem" }, "Capture now, or log without a photo and enter the reading later."),
    );
    return slot;
  }

  const locked = job.status === "claimed" || job.status === "submitted" || job.status === "paid";

  // Media area: the photo thumbnail, or an attach-photo control for manual logs.
  let media: HTMLElement;
  if (log.hasPhoto) {
    media = h("img", {
      class: "photo",
      style: "max-height:130px;aspect-ratio:4/3;object-fit:cover",
      src: api.photoUrl(log.id, "thumb"),
      alt: `${role} photo`,
      loading: "lazy",
    });
  } else if (locked) {
    media = noPhotoBox("Manual log — locked");
  } else {
    media = attachPhotoBox(log.id, changed);
  }

  const reading = h("span", { class: log.readingKm != null ? "reading-value" : "reading-value unset" }, pad(log.readingKm, 6));
  const edit = h("button", { class: "btn sm", disabled: locked }, log.readingKm != null ? "Edit" : "Enter reading");
  edit.onclick = () => void openReading(job, role, log.id, changed);
  const del = h("button", { class: "icon-btn danger", disabled: locked, title: "Delete log", style: "padding:4px 8px" }, "✕");
  del.onclick = async () => {
    const withPhoto = log.hasPhoto;
    if (!(await confirmDialog({
      title: withPhoto ? "Delete photo?" : "Delete reading?",
      message: withPhoto ? "Removes the photo, GPS and its reading from this job." : "Removes this manual log and its reading from the trip.",
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    try {
      await api.deleteLog(log.id);
      toast(withPhoto ? "Photo deleted" : "Reading deleted");
      await changed();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  };

  slot.append(
    h("div", { class: "row spread" },
      h("span", { style: "font-weight:600;font-size:0.85rem" }, label),
      h("span", { class: "text-faint mono", style: "font-size:0.72rem" }, fmtWhen(log.takenAt)),
    ),
    media,
    h("div", { class: "row spread" }, reading, h("div", { class: "row", style: "gap:4px" }, edit, del)),
    ...(locked ? [] : [logDetailsControls(role, log, job, eventPromise, settingsPromise, changed)]),
  );
  return slot;
}

/** Clickable "manual log" area: pick/photo a photo and attach it to this log. */
function attachPhotoBox(logId: number, changed: () => Promise<void>): HTMLElement {
  const hiddenInputStyle = "position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none";
  const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", style: hiddenInputStyle }) as HTMLInputElement;
  const pickInput = h("input", { type: "file", accept: "image/*", style: hiddenInputStyle }) as HTMLInputElement;
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.8rem;margin:0" });
  let busy = false;

  async function attach(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    errEl.textContent = "";
    try {
      await api.addLogPhoto(logId, file);
      toast("Photo attached to this log");
      await changed();
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      busy = false;
    }
  }

  function open(input: HTMLInputElement): void {
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void attach(file);
    };
    input.click();
  }

  const box = h("div", {
    role: "button",
    tabindex: "0",
    title: "Click to attach a photo to this manual log",
    style:
      "min-height:110px;border:2px dashed var(--line);border-radius:var(--r-sm);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--fg-dim);font-size:0.8rem;text-align:center;padding:10px;background:rgba(15,23,42,0.5);cursor:pointer",
  });
  box.onclick = () => open(pickInput);
  box.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(pickInput);
    }
  };
  box.append(
    h("span", { style: "font-weight:700;color:var(--sky);font-size:0.9rem" }, "＋ Add photo to this log"),
    h("span", {}, "Manual log — no photo yet. Click here (or use the buttons below)."),
  );

  const camBtn = h("button", { class: "btn sm", onclick: (e: Event) => { e.stopPropagation(); open(camInput); } }, "Camera");
  const pickBtn = h("button", { class: "btn sm", onclick: (e: Event) => { e.stopPropagation(); open(pickInput); } }, "Choose photo");
  const controls = h("div", { class: "row", style: "gap:6px" }, camBtn, pickBtn);
  const wrap = h("div", { class: "col", style: "gap:6px" }, box, controls, errEl, camInput, pickInput);
  return wrap;
}

/**
 * Manual override for a log: arrival/travel-time helper plus an NZ address
 * lookup that replaces the GPS point (typed coordinates stay as a fallback).
 */
function logDetailsControls(
  role: "start" | "end" | "return",
  log: LogDto,
  job: JobDto,
  eventPromise: Promise<CalEventDto | null>,
  settingsPromise: Promise<SettingsDto | null>,
  changed: () => Promise<void>,
): HTMLElement {
  const wrap = h("div", { class: "col", style: "gap:6px" });
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.8rem;margin:0" });

  const openBtn = h("button", { class: "btn sm", style: "align-self:flex-start" }, "Edit time & location");
  const panel = h("div", {
    class: "col",
    style: "gap:8px;display:none;border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:8px;background:rgba(15,23,42,0.35)",
  });

  const timing = timingHelper({ role: role === "start" ? "start" : "end", arrivalIso: log.takenAt, durationMinutes: null });
  const picker = locationPicker({ lat: log.lat, lng: log.lng, homeBase: null });
  void settingsPromise.then((s) => {
    if (s) picker.setHomeBase(s);
  });

  // Return logs can set their reading from the distance driven home (client reading + km).
  const baseKm = job.endLog?.readingKm ?? null;
  const currentDistance = role === "return" && baseKm != null && log.readingKm != null ? log.readingKm - baseKm : null;
  const distance = role === "return" && baseKm != null ? distanceSelect(currentDistance) : null;
  const distanceHint = h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" });
  if (distance) {
    const sync = (): void => {
      const km = distance.value();
      distanceHint.textContent =
        km == null
          ? "Pick a distance to set the odometer, or use Edit to dial the reading."
          : `Reading at home: ${pad(baseKm! + km, 6)}`;
    };
    distance.el.addEventListener("input", sync);
    distance.el.addEventListener("change", sync);
    sync();
  }

  const eventSlot = h("div", { class: "row" });
  void eventPromise.then((ev) => {
    if (!ev?.startAt) return;
    const useEvent = h("button", { class: "btn sm ghost", style: "align-self:flex-start;font-size:0.72rem;padding:3px 8px" }, "⏱ Use calendar arrival");
    useEvent.onclick = () => timing.setArrival(ev.startAt!);
    eventSlot.append(useEvent);
  });

  function reset(): void {
    timing.setArrival(log.takenAt);
    picker.set(log.lat != null && log.lng != null ? { lat: log.lat, lng: log.lng, label: "" } : null);
    errEl.textContent = "";
  }

  openBtn.onclick = () => {
    const open = panel.style.display === "none";
    panel.style.display = open ? "flex" : "none";
    if (open) (panel.querySelector("input") as HTMLInputElement | null)?.focus();
  };

  const save = h("button", { class: "btn sm primary" }, "Save changes");
  const cancel = h("button", { class: "btn sm ghost", onclick: () => { panel.style.display = "none"; reset(); } }, "Cancel");
  save.onclick = async () => {
    errEl.textContent = "";
    const body: { takenAt?: string; lat?: number | null; lng?: number | null } = {};
    const iso = timing.iso();
    if (Math.floor(new Date(iso).getTime() / 60_000) !== Math.floor(new Date(log.takenAt).getTime() / 60_000)) {
      body.takenAt = iso;
    }
    const pickErr = picker.error();
    if (pickErr) {
      errEl.textContent = pickErr;
      return;
    }
    const place = picker.get();
    const hasGps = log.lat != null && log.lng != null;
    if (place) {
      const roundedSame = hasGps && place.lat.toFixed(6) === log.lat!.toFixed(6) && place.lng.toFixed(6) === log.lng!.toFixed(6);
      if (!roundedSame) {
        body.lat = place.lat;
        body.lng = place.lng;
      }
    } else if (hasGps) {
      body.lat = null;
      body.lng = null;
    }

    let readingTarget: number | null = null;
    if (distance) {
      const km = distance.value();
      if (km != null) readingTarget = baseKm! + km;
    }
    const readingChanged = readingTarget != null && readingTarget !== log.readingKm;

    if (body.takenAt === undefined && body.lat === undefined && !readingChanged) {
      toast("No changes to save");
      return;
    }
    save.disabled = true;
    try {
      if (readingChanged && readingTarget != null) await api.setReading(log.id, readingTarget);
      if (body.takenAt !== undefined || body.lat !== undefined) await api.patchLog(log.id, body);
      toast(role === "start" && body.takenAt ? "Saved — the trip date follows the start log" : "Log updated");
      await changed();
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      save.disabled = false;
    }
  };

  const distanceField = distance
    ? h("div", { class: "field", style: "margin:0" }, h("label", {}, "Distance home"), distance.el, distanceHint)
    : null;
  panel.append(
    timing.el,
    eventSlot,
    ...(distanceField ? [distanceField] : []),
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Location"), picker.el),
    h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
      `GPS: ${fmtLatLng(log.lat, log.lng) || "none"}${log.lat != null ? ` (${log.gpsSource})` : ""}. Pick an address to replace it (stored as manual); clear the location to remove the point.`),
    h("div", { class: "row", style: "gap:6px" }, save, cancel),
    errEl,
  );

  wrap.append(openBtn, panel);
  return wrap;
}

/** One-tap return leg: adds the home-arrival reading to this same trip. */
function driveHomeSection(
  current: JobDto,
  settingsPromise: Promise<SettingsDto | null>,
  eventPromise: Promise<CalEventDto | null>,
  changed: () => Promise<void>,
): HTMLElement {
  const box = h("div", { class: "col", style: "gap:6px" });
  if (!current.endLog) {
    box.append(
      h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
        "Log the client arrival (end) first — the drive home is added as this trip's return reading."),
    );
    return box;
  }
  if (current.status === "claimed" || current.status === "submitted" || current.status === "paid") {
    box.append(
      h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
        "Claim lodged — reopen the trip to add the drive home."),
    );
    return box;
  }
  void Promise.all([settingsPromise, eventPromise]).then(([settings, event]) => {
    if (settings?.homeBaseLat == null || settings.homeBaseLng == null) {
      box.append(
        h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
          "Set a home base in Settings to log the drive home."),
      );
      return;
    }
    const departDefault = event?.endAt ?? current.endLog?.takenAt ?? null;
    const btn = h("button", { class: "btn sm", style: "white-space:nowrap" }, "＋ Log drive home");
    btn.onclick = () => openReturnTripModal(current, departDefault, changed);
    box.append(
      h("div", { class: "row spread", style: "gap:8px;align-items:center" },
        h("div", { class: "col", style: "gap:1px;min-width:0" },
          h("span", { class: "text-dim", style: "font-size:0.78rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase" }, "Drive home"),
          h("span", { class: "text-faint", style: "font-size:0.72rem" }, `Adds the drive back to ${settings.homeBaseAddress || "home base"} as this trip's return reading.`),
        ),
        btn,
      ),
    );
  });
  return box;
}

function openReturnTripModal(job: JobDto, departDefaultIso: string | null, changed: () => Promise<void>): void {
  const departI = h("input", {
    class: "neon-input",
    type: "datetime-local",
    value: toLocalInput(departDefaultIso ?? new Date().toISOString()),
  }) as HTMLInputElement;
  const travel = travelTimeSelect(lastTravelMinutes() ?? 30);
  const baseKm = job.endLog?.readingKm ?? null;
  const distance = baseKm != null ? distanceSelect(null) : null;
  const arriveEl = h("p", { class: "text-dim", style: "font-size:0.8rem;margin:0" });
  const distanceEl = h("p", { class: "text-dim", style: "font-size:0.8rem;margin:0" });
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem;margin:0" });

  const departureIso = (): string => fromLocalInput(departI.value) ?? new Date().toISOString();
  const arrivalIso = (): string => shiftIsoMinutes(departureIso(), travel.value() ?? 0);
  const refresh = (): void => {
    arriveEl.textContent = `Arrive home at ${new Date(arrivalIso()).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`;
    if (baseKm == null) {
      distanceEl.textContent = "Enter the client reading first to use distance — or dial the return reading later.";
      return;
    }
    const km = distance?.value() ?? null;
    distanceEl.textContent =
      km == null
        ? `Distance not set — the return reading stays blank until you dial it (client reading ${pad(baseKm, 6)}).`
        : `Reading at home: ${pad(baseKm + km, 6)} (client ${pad(baseKm, 6)} + ${km} km)`;
  };
  departI.oninput = refresh;
  travel.el.addEventListener("input", refresh);
  travel.el.addEventListener("change", refresh);
  if (distance) {
    distance.el.addEventListener("input", refresh);
    distance.el.addEventListener("change", refresh);
  }
  refresh();

  const save = h("button", { class: "btn primary" }, "Add return reading");
  save.onclick = async () => {
    errEl.textContent = "";
    const departAt = departureIso();
    const arriveAt = arrivalIso();
    if (new Date(arriveAt).getTime() <= new Date(departAt).getTime()) {
      errEl.textContent = "Add a travel time (or a later arrival) so the trip takes positive time.";
      return;
    }
    save.disabled = true;
    try {
      await api.addReturnLog(job.id, { departAt, arriveAt, distanceKm: baseKm != null ? distance?.value() ?? null : null });
      modal.close();
      toast("Drive home added to this trip");
      await changed();
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      save.disabled = false;
    }
  };

  const body = h("div", { class: "col" },
    h("p", { class: "text-dim", style: "font-size:0.85rem;margin:0" },
      "Adds the drive home as this trip's return reading, so one claim covers the whole back-and-forth."),
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Leave the client"), departI),
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Travel time home"), travel.el),
    distance ? h("div", { class: "field", style: "margin:0" }, h("label", {}, "Distance home"), distance.el) : null,
    arriveEl,
    distanceEl,
    errEl,
    h("div", { class: "row", style: "justify-content:flex-end" },
      h("button", { class: "btn", onclick: () => modal.close() }, "Cancel"),
      save,
    ),
  );
  const modal = showModal({ title: `Drive home — ${job.client}`, body });
}

/** Onward trip: starts where this one ended (time, place and odometer), with no calendar event. */
function onwardSection(current: JobDto, refresh: () => Promise<void>, close: () => void): HTMLElement {
  const box = h("div", { class: "col", style: "gap:6px" });
  if (!current.endLog) {
    box.append(
      h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
        "The client arrival (end) is needed before adding the next trip on."),
    );
    return box;
  }
  const btn = h("button", { class: "btn sm", style: "white-space:nowrap" }, "＋ Add a trip on");
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const next = await api.createNextTrip(current.id);
      close();
      toast("New trip added — starts where this one ended");
      await refresh();
      openTripModal(next, refresh);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
      btn.disabled = false;
    }
  };
  box.append(
    h("div", { class: "row spread", style: "gap:8px;align-items:center" },
      h("div", { class: "col", style: "gap:1px;min-width:0" },
        h("span", { class: "text-dim", style: "font-size:0.78rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase" }, "Onward trip"),
        h("span", { class: "text-faint", style: "font-size:0.72rem" }, "Starts at this trip's end — same time, place and odometer — without the calendar event."),
      ),
      btn,
    ),
  );
  return box;
}

function claimControls(job: JobDto, changed: () => Promise<void>): HTMLElement {
  const row = h("div", { class: "row", style: "gap:6px" });
  if (job.tripKind === "personal") {
    row.append(
      h("span", { class: "chip personal" }, "Personal"),
      h("span", { class: "text-dim", style: "font-size:0.78rem" }, "Not claimable — counts toward the personal-use split"),
    );
    return row;
  }
  const needs = job.startLog == null || job.endLog == null || job.km == null;
  const go = async (action: () => Promise<unknown>, msg: string) => {
    try {
      await action();
      toast(msg);
      await changed();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  };

  if (job.status === "ready" || job.status === "open") {
    const claim = h("button", { class: "btn sm primary", disabled: needs }, "Lodge claim");
    claim.onclick = async () => {
      if (!(await confirmDialog({
        title: "Lodge claim?",
        message: `${job.client}\n${job.km} km at $${((job.effectiveRateCents ?? 0) / 100).toFixed(2)}/km\n= ${formatNzd(job.amountCents ?? 0)}\n\nThe rate is locked in once claimed.`,
        confirmLabel: "Lodge claim",
      }))) return;
      await go(() => api.claim(job.id, "claimed"), "Claim lodged");
    };
    if (needs) {
      row.append(h("span", { class: "text-dim", style: "font-size:0.78rem" },
        job.returnLog ? "Needs both photos, the client reading and the return reading" : "Needs both photos + readings"));
    }
    row.append(claim);
  } else {
    if (job.status === "claimed" || job.status === "submitted") {
      const nextLabel = job.status === "claimed" ? "Mark submitted" : "Mark paid";
      const next = h("button", { class: "btn sm" }, nextLabel);
      next.onclick = () => go(() => api.claim(job.id, job.status === "claimed" ? "submitted" : "paid"), nextLabel);
      row.append(next);
    }
    const reopen = h("button", { class: "btn sm danger" }, "Reopen");
    reopen.onclick = async () => {
      if (!(await confirmDialog({ title: "Reopen?", message: "Unlocks readings and clears the rate snapshot.", confirmLabel: "Reopen", danger: true }))) return;
      await go(() => api.reopen(job.id), "Job reopened");
    };
    row.append(reopen);
  }
  return row;
}

/** Pick/change the trip's car, or add a new one. Changing is blocked once a reading pins the trip to a car. */
function vehiclePicker(current: JobDto, changed: () => Promise<void>): HTMLElement {
  const claimed = current.status === "claimed" || current.status === "submitted" || current.status === "paid";
  const readingPins = current.startLog?.readingKm != null || current.endLog?.readingKm != null;
  const locked = claimed || readingPins;

  const wrap = h("div", { class: "col", style: "gap:4px" });
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.8rem;margin:0" });
  const hint = h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" });
  hint.textContent = claimed
    ? "Claim lodged - reopen the trip to change the car."
    : readingPins
      ? `A reading is entered, which pins this trip to ${current.vehiclePlate ?? "its car"}.`
      : current.vehicleId == null
        ? "Photos and readings log against this car - pick it before capturing, or add it below."
        : "Change the car anytime before a reading is entered.";

  const select = h("select", { class: "neon-input vehicle-select", disabled: locked, title: locked ? hint.textContent : undefined }) as HTMLSelectElement;
  let vehicles: VehicleDto[] = [];

  async function load(): Promise<void> {
    try {
      vehicles = await api.vehicles();
    } catch {
      vehicles = [];
    }
    renderOptions();
  }

  function renderOptions(): void {
    while (select.firstChild) select.removeChild(select.firstChild);
    const noneOpt = h("option", { value: "" }, vehicles.length === 0 ? "No cars yet" : "— pick a car —") as HTMLOptionElement;
    select.append(noneOpt);
    for (const v of [...vehicles].sort((a, b) => Number(b.active) - Number(a.active) || a.plate.localeCompare(b.plate))) {
      const label = `${v.plate} — ${[v.make, v.model].filter(Boolean).join(" ") || "car"} — $${(v.rateCents / 100).toFixed(2)}/km${v.active ? "" : " (inactive)"}`;
      const opt = h("option", { value: String(v.id) }, label) as HTMLOptionElement;
      opt.selected = v.id === current.vehicleId;
      select.append(opt);
    }
    if (current.vehicleId == null) noneOpt.selected = true;
  }

  select.onchange = async () => {
    const vehicleId = Number(select.value);
    if (!vehicleId || vehicleId === current.vehicleId) return;
    errEl.textContent = "";
    try {
      await api.patchJob(current.id, { vehicleId });
      const v = vehicles.find((x) => x.id === vehicleId);
      toast(`Car changed to ${v?.plate ?? "new car"}`);
      await changed();
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      renderOptions();
    }
  };

  const addToggle = h("button", { class: "btn sm", style: "white-space:nowrap", disabled: locked }, "＋ Add a car");
  const head = h("div", { class: "row", style: "gap:6px;align-items:center;flex-wrap:wrap" },
    h("span", { class: "text-dim", style: "font-size:0.78rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase" }, "Car"),
    select, addToggle,
  );
  head.style.alignItems = "center";

  const plateI = h("input", { class: "neon-input", placeholder: "Plate e.g. ABC123", autocomplete: "off", maxlength: "12" }) as HTMLInputElement;
  const makeI = h("input", { class: "neon-input", placeholder: "Make (optional)", maxlength: "40" }) as HTMLInputElement;
  const modelI = h("input", { class: "neon-input", placeholder: "Model (optional)", maxlength: "40" }) as HTMLInputElement;
  const rateI = h("input", { class: "neon-input", type: "number", step: "0.01", min: "0", placeholder: "$/km e.g. 0.95" }) as HTMLInputElement;
  const addForm = h("div", { class: "col", style: "gap:6px;display:none;border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:8px;background:rgba(15,23,42,0.35)" });
  const addSave = h("button", { class: "btn sm primary" }, "Add car");
  const addCancel = h("button", { class: "btn sm ghost", onclick: () => { addForm.style.display = "none"; errEl.textContent = ""; } }, "Cancel");

  addToggle.onclick = () => {
    if (addForm.style.display === "none") {
      addForm.style.display = "flex";
      plateI.focus();
    } else {
      addForm.style.display = "none";
    }
  };

  addSave.onclick = async () => {
    const plate = plateI.value.trim();
    const rate = Number(rateI.value);
    if (!plate) {
      errEl.textContent = "Plate is required.";
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      errEl.textContent = "Enter the km rate in $ (e.g. 0.95).";
      return;
    }
    errEl.textContent = "";
    addSave.disabled = true;
    try {
      const created = await api.createVehicle({
        plate,
        make: makeI.value.trim(),
        model: modelI.value.trim(),
        rateCents: Math.round(rate * 100),
        digits: 6,
        active: true,
        tierKm: null,
        tierRateCents: null,
      });
      toast(`${created.plate} added`);
      vehicles = await api.vehicles();
      renderOptions();
      if (!locked && current.vehicleId == null) {
        await api.patchJob(current.id, { vehicleId: created.id });
        toast(`Car set to ${created.plate}`);
        await changed();
        return;
      }
      for (const opt of [...select.options]) if (opt.value === String(created.id)) opt.selected = true;
      addForm.style.display = "none";
      plateI.value = makeI.value = modelI.value = rateI.value = "";
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      addSave.disabled = false;
    }
  };

  addForm.append(
    h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px" },
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Plate"), plateI),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Rate"), rateI),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Make"), makeI),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Model"), modelI),
    ),
    h("div", { class: "row", style: "gap:6px" }, addSave, addCancel),
  );

  wrap.append(head, hint, errEl, addForm);
  void load();
  return wrap;
}

/** Popup with full, editable details for a trip (used by Review + Log pages). */
/**
 * Searchable calendar-event linker: shows the linked booking (if any) and lets
 * the user search the synced feed to link, change or unlink this trip.
 */
function eventLinker(current: JobDto, changed: () => Promise<void>): HTMLElement {
  const wrap = h("div", { class: "col", style: "gap:6px" });

  const label = h("span", { class: "text-dim", style: "font-size:0.78rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase" }, "Calendar event");
  const linkedBadge = h("span", { class: "badge ok", style: "display:none" });
  const removedBadge = h("span", { class: "badge warn", style: "display:none" }, "Link removed in feed");
  const summary = h("span", { class: "text-dim", style: "font-size:0.88rem;flex:1;min-width:0" });

  const changeBtn = h("button", { class: "btn sm" }, current.eventUid ? "Change / search" : "Link calendar event");
  const unlinkBtn = current.eventUid
    ? h("button", { class: "btn sm danger", onclick: async () => {
        try {
          await api.patchJob(current.id, { eventUid: null });
          toast("Unlinked from calendar");
          await changed();
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), "err");
        }
      } }, "Unlink")
    : null;

  const statusRow = h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" },
    linkedBadge, removedBadge, summary, h("div", { style: "flex:1" }), changeBtn,
  );
  if (unlinkBtn) statusRow.append(unlinkBtn);

  if (current.eventUid) {
    summary.textContent = "Looking up linked event…";
    api.calendarEventByUid(current.eventUid)
      .then((ev) => {
        if (!ev) {
          removedBadge.style.display = "inline-block";
          summary.textContent = current.eventUid;
          return;
        }
        linkedBadge.style.display = "inline-block";
        const when = ev.startAt ? fmtWhen(ev.startAt) : ev.allDay ? "All day" : "";
        summary.textContent = `${ev.summary || "Event"}${when ? ` — ${when}` : ""}${ev.location ? ` @ ${ev.location}` : ""}`;
      })
      .catch(() => {
        removedBadge.style.display = "inline-block";
        summary.textContent = "";
      });
  } else {
    summary.textContent = "No calendar event linked";
  }

  async function linkTo(e: CalEventDto): Promise<void> {
    try {
      await api.patchJob(current.id, { eventUid: e.uid });
      toast(`Linked to “${e.summary || "event"}”`);
      await changed();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  }

  // Search mode --------------------------------------------------------------
  const search = h("input", { class: "neon-input", placeholder: "Search client bookings…", autocomplete: "off" }) as HTMLInputElement;
  const results = h("div", {
    style:
      "max-height:210px;overflow-y:auto;border:1px solid var(--line-dim);border-radius:var(--r-sm);background:var(--bg-input)",
  });
  const searchHint = h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
    "Bookings closest to today are listed first — type a client name to search older bookings too.");
  const searchBox = h("div", { class: "col", style: "gap:6px" }, search, results, searchHint);

  function dayLabel(iso: string | null): string {
    return iso ? iso.slice(0, 10) : "";
  }

  const NEAR_PAST_MS = 3 * 24 * 3600 * 1000;
  const NEAR_FUTURE_MS = 35 * 24 * 3600 * 1000;
  let nearCache: CalEventDto[] | null = null;
  let fullCache: CalEventDto[] | null = null;
  let searchSeq = 0;

  async function loadNear(): Promise<CalEventDto[]> {
    if (nearCache) return nearCache;
    const now = Date.now();
    const events = await api
      .calendarEvents(new Date(now - NEAR_PAST_MS).toISOString(), new Date(now + NEAR_FUTURE_MS).toISOString())
      .catch(() => null);
    nearCache = events ?? [];
    return nearCache;
  }

  async function loadFull(): Promise<CalEventDto[]> {
    if (fullCache) return fullCache;
    const from = new Date();
    from.setFullYear(from.getFullYear() - 2);
    const to = new Date();
    to.setFullYear(to.getFullYear() + 2);
    fullCache = await api.calendarEvents(from.toISOString(), to.toISOString()).catch(() => null);
    return fullCache ?? [];
  }

  function clearResults(): void {
    while (results.firstChild) results.removeChild(results.firstChild);
  }

  function appendRows(list: CalEventDto[]): void {
    for (const e of list) {
      const isCurrent = current.eventUid === e.uid;
      const row = h("button", {
        class: "btn",
        style: `justify-content:flex-start;width:100%;border-radius:0;border-left:none;border-right:none;border-top:none;text-align:left;${isCurrent ? "border-color:rgba(20,184,166,0.5);color:var(--accent)" : ""}`,
      },
        h("div", { class: "col", style: "gap:1px;min-width:0" },
          h("span", { style: "font-weight:600;white-space:normal" }, `${isCurrent ? "✓ " : ""}${e.summary || "Event"}`),
          h("span", { class: "text-dim", style: "font-size:0.74rem;white-space:normal" },
            [dayLabel(e.startAt), e.allDay ? "all day" : null, e.location].filter(Boolean).join(" • ")),
        ),
      );
      row.onclick = () => void linkTo(e);
      results.append(row);
    }
  }

  function emptyState(text: string): void {
    results.append(h("div", { class: "text-dim", style: "padding:10px;font-size:0.85rem" }, text));
  }

  async function renderMatches(): Promise<void> {
    const q = search.value.trim().toLowerCase();
    const seq = ++searchSeq;
    clearResults();
    if (!q) {
      if (!nearCache) emptyState("Loading the closest bookings…");
      const near = await loadNear();
      if (seq !== searchSeq) return;
      clearResults();
      if (near.length === 0) {
        emptyState("No bookings around today — type a client name to search the whole calendar.");
        return;
      }
      const byCloseness = [...near]
        .filter((e) => e.startAt != null)
        .sort(
          (a, b) =>
            Math.abs(Date.parse(a.startAt!) - Date.now()) - Math.abs(Date.parse(b.startAt!) - Date.now()) ||
            (a.startAt! < b.startAt! ? -1 : 1),
        )
        .slice(0, 40);
      appendRows(byCloseness);
      return;
    }
    if (!fullCache) emptyState("Searching the whole calendar…");
    const full = await loadFull();
    if (seq !== searchSeq) return;
    clearResults();
    const matches = full
      .filter((e) => `${e.summary} ${e.location}`.toLowerCase().includes(q))
      .sort((a, b) => ((a.startAt ?? "") < (b.startAt ?? "") ? -1 : 1))
      .slice(0, 40);
    if (matches.length === 0) {
      emptyState("No matching bookings — check the calendar link in Settings.");
      return;
    }
    appendRows(matches);
  }

  // Calendar (month browse) mode --------------------------------------------
  const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() };
  const monthCache = new Map<string, CalEventDto[]>();
  const calHead = h("div", { class: "row", style: "gap:6px;align-items:center" });
  const calLabel = h("span", { style: "font-weight:600;font-size:0.9rem;flex:1;text-align:center;white-space:nowrap" });
  const calPrev = h("button", { class: "btn sm", title: "Previous month" }, "‹");
  const calNext = h("button", { class: "btn sm", title: "Next month" }, "›");
  const calToday = h("button", { class: "btn sm outline", style: "white-space:nowrap" }, "Today");
  calHead.append(calPrev, calLabel, calNext, calToday);

  const calGrid = h("div", {
    class: "cal-grid",
    style:
      "display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--line-dim);border:1px solid var(--line-dim);border-radius:var(--r-sm);overflow:hidden;max-height:230px;overflow-y:auto",
  });
  const calHint = h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
    "Click a booking to link this trip to it — linked bookings are marked ✓.");
  const calBox = h("div", { class: "col", style: "gap:6px;display:none" }, calHead, calGrid, calHint);

  function localDayOf(date: Date): string {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }

  function monthSpan(): { from: Date; to: Date } {
    const from = new Date(view.year, view.month, 1, 0, 0, 0, 0);
    const to = new Date(view.year, view.month + 1, 0, 23, 59, 59, 999);
    return { from, to };
  }

  async function loadMonth(): Promise<CalEventDto[]> {
    const key = `${view.year}-${view.month}`;
    const cached = monthCache.get(key);
    if (cached) return cached;
    const { from, to } = monthSpan();
    const events = await api.calendarEvents(from.toISOString(), to.toISOString()).catch(() => [] as CalEventDto[]);
    monthCache.set(key, events);
    return events;
  }

  async function renderCal(): Promise<void> {
    while (calGrid.firstChild) calGrid.removeChild(calGrid.firstChild);
    calLabel.textContent = new Date(view.year, view.month, 1).toLocaleString("en-NZ", { month: "long", year: "numeric" });
    const events = (await loadMonth()).filter((e) => e.startAt != null);
    const byDay = new Map<string, CalEventDto[]>();
    for (const e of events) {
      const day = e.startAt!.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(e);
      byDay.set(day, list);
    }

    for (const wd of WEEKDAYS) {
      calGrid.append(h("div", { style: "background:var(--bg-raised);color:var(--fg-faint);font-size:0.6rem;font-weight:700;text-align:center;padding:3px 0;position:sticky;top:0" }, wd));
    }

    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const todayStr = localDayOf(new Date());
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    for (let i = 0; i < offset; i++) calGrid.append(h("div", {}));

    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(view.year, view.month, d);
      const key = localDayOf(day);
      const list = (byDay.get(key) ?? []).slice().sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1));
      const cell = h("div", {
        style:
          `background:var(--bg-panel);min-height:${list.length ? "58px" : "38px"};padding:3px;display:flex;flex-direction:column;gap:2px`,
      });
      const isToday = key === todayStr;
      const num = h("span", {
        style: isToday
          ? "font-size:0.66rem;color:#04211c;background:var(--accent);border-radius:999px;width:17px;height:17px;display:flex;align-items:center;justify-content:center;font-weight:700;margin-left:auto"
          : "font-size:0.66rem;color:var(--fg-dim);font-weight:600;margin-left:auto",
      }, String(d));
      cell.append(h("div", { style: "display:flex;justify-content:flex-end" }, num));

      const visible = list.slice(0, 2);
      for (const e of visible) {
        const isCurrent = current.eventUid === e.uid;
        const chip = h("button", {
          class: "btn sm",
          title: `${e.summary || "Event"}${e.location ? ` — ${e.location}` : ""}`,
          style: `justify-content:flex-start;width:100%;padding:1px 5px;font-size:0.62rem;font-weight:600;border-radius:var(--r-xs);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${isCurrent ? "background:var(--accent-soft);border-color:rgba(20,184,166,0.5);color:var(--accent)" : "border-color:var(--line);color:var(--fg-dim)"}`,
        }, `${isCurrent ? "✓ " : ""}${e.summary || "Event"}`);
        chip.onclick = () => void linkTo(e);
        cell.append(chip);
      }
      if (list.length > 2) {
        const more = h("button", { class: "btn sm ghost", style: "padding:1px 5px;font-size:0.6rem;border-radius:var(--r-xs);justify-content:center" }, `+${list.length - 2} more`);
        more.onclick = () => openDayList(key, list);
        cell.append(more);
      }
      calGrid.append(cell);
    }
  }

  function openDayList(day: string, list: CalEventDto[]): void {
    const body = h("div", { class: "col" });
    const dayModal = showModal({ title: `${day} — ${list.length} booking(s)`, body });
    for (const e of [...list].sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1))) {
      const isCurrent = current.eventUid === e.uid;
      const row = h("button", {
        class: "btn",
        style: `justify-content:space-between;width:100%;text-align:left;${isCurrent ? "border-color:rgba(20,184,166,0.5);color:var(--accent)" : ""}`,
      },
        h("div", { class: "col", style: "gap:1px;min-width:0" },
          h("span", { style: "font-weight:600" }, `${isCurrent ? "✓ " : ""}${e.summary || "Event"}`),
          h("span", { class: "text-dim", style: "font-size:0.74rem" }, e.location || "no address"),
        ),
        h("span", { class: "text-dim mono", style: "font-size:0.72rem" }, e.startAt ? e.startAt.slice(11, 16) : "all day"),
      );
      row.onclick = () => {
        dayModal.close();
        void linkTo(e);
      };
      body.append(row);
    }
  }

  // Panel chrome --------------------------------------------------------------
  const modeBar = h("div", { class: "row", style: "gap:4px" });
  const searchTab = h("button", { class: "btn sm" }, "Search");
  const calTab = h("button", { class: "btn sm ghost" }, "Browse calendar");
  modeBar.append(searchTab, calTab);

  const panel = h("div", { class: "col", style: "gap:8px;display:none" }, modeBar, searchBox, calBox);

  function setMode(mode: "search" | "cal"): void {
    const searching = mode === "search";
    searchTab.className = `btn sm${searching ? " preset-on" : " ghost"}`;
    calTab.className = `btn sm${searching ? " ghost" : " preset-on"}`;
    searchBox.style.display = searching ? "flex" : "none";
    calBox.style.display = searching ? "none" : "flex";
    if (searching) {
      search.focus();
      void renderMatches();
    } else {
      void renderCal();
    }
  }
  searchTab.onclick = () => setMode("search");
  calTab.onclick = () => setMode("cal");
  calPrev.onclick = () => {
    const d = new Date(view.year, view.month - 1, 1);
    view = { year: d.getFullYear(), month: d.getMonth() };
    void renderCal();
  };
  calNext.onclick = () => {
    const d = new Date(view.year, view.month + 1, 1);
    view = { year: d.getFullYear(), month: d.getMonth() };
    void renderCal();
  };
  calToday.onclick = () => {
    const d = new Date();
    view = { year: d.getFullYear(), month: d.getMonth() };
    void renderCal();
  };

  async function openPanel(): Promise<void> {
    if (panel.style.display === "none") {
      panel.style.display = "flex";
      setMode("search");
    } else {
      panel.style.display = "none";
    }
  }

  changeBtn.onclick = () => void openPanel();
  search.oninput = () => void renderMatches();
  search.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      panel.style.display = "none";
      search.blur();
    }
  };

  wrap.append(h("div", { class: "row spread", style: "gap:6px;align-items:flex-start" },
    label, h("div", { style: "flex:1" })), statusRow, panel);
  return wrap;
}

export function openTripModal(job: JobDto, refresh: () => Promise<void>): void {
  const client = h("input", { class: "neon-input", value: job.client, placeholder: "Client / purpose" }) as HTMLInputElement;
  const notes = h("textarea", { class: "neon-input", rows: 2, style: "resize:vertical;min-height:52px", placeholder: "Notes / purpose detail" }) as HTMLTextAreaElement;
  notes.value = job.notes;
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem" });

  let modal: ModalHandle;

  const settingsPromise = api.settings().catch(() => null);
  const eventPromise: Promise<CalEventDto | null> = job.eventUid
    ? api.calendarEventByUid(job.eventUid).catch(() => null)
    : Promise.resolve(null);

  async function fetchJob(): Promise<JobDto | null> {
    try {
      const jobs = await api.jobs();
      return jobs.find((j) => j.id === job.id) ?? null;
    } catch {
      return null;
    }
  }

  /** Refresh page data and reopen this modal with the freshest job. */
  async function changed(): Promise<void> {
    modal.close();
    try {
      await refresh();
    } catch {
      /* page-level refresh handled by caller */
    }
    const updated = await fetchJob();
    if (updated) openTripModal(updated, refresh);
  }

  function build(current: JobDto): HTMLElement {
    client.value = current.client;
    notes.value = current.notes;

    const picker = locationPicker({
      lat: current.locationLat,
      lng: current.locationLng,
      label: current.location,
      homeBase: null,
      placeholder: "Search the client's NZ address…",
    });
    if (current.location && current.locationLat == null) picker.prefill(current.location);

    const chips = h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" },
      current.tripKind === "personal" ? h("span", { class: "chip personal" }, "Personal") : statusChip(current.status),
      current.vehiclePlate ? h("span", { class: "badge" }, current.vehiclePlate) : null,
      current.claimedAt ? h("span", { class: "badge muted" }, `claimed ${current.claimedAt.slice(0, 10)}`) : null,
      current.paidAt ? h("span", { class: "badge muted" }, `paid ${current.paidAt.slice(0, 10)}`) : null,
    );

    const car = vehiclePicker(current, changed);
    const linker = eventLinker(current, changed);

    async function captureFor(role: "start" | "end"): Promise<void> {
      if (current.vehicleId != null) {
        void openCaptureWizard({ job: current, role, vehicleId: current.vehicleId }, changed);
        return;
      }
      try {
        const vehicles = await api.vehicles();
        const pick = vehicles.find((v) => v.active) ?? vehicles[0];
        if (!pick) {
          toast("Add a vehicle in Settings first", "err");
          return;
        }
        void openCaptureWizard({ job: current, role, vehicleId: pick.id }, changed);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "err");
      }
    }

    const sumLeft = current.km != null
      ? h("span", { class: "mono", style: "font-size:1.05rem" }, `${formatKm(current.km)} km`)
      : h("span", { class: "text-dim" }, "— km");
    const sumRight = current.amountCents != null
      ? h("span", { class: "mono", style: "font-size:1.2rem;color:var(--accent)" }, formatNzd(current.amountCents))
      : h("span", { class: "text-dim", style: "font-size:0.85rem" },
        current.effectiveRateCents != null ? `@ $${(current.effectiveRateCents / 100).toFixed(2)}/km` : "");
    const money = h("div", { class: "row spread", style: "border-top:1px solid var(--line-dim);padding-top:8px" }, sumLeft, sumRight);

    const saveDetails = h("button", { class: "btn", style: "align-self:flex-end" }, "Save details");
    saveDetails.onclick = async () => {
      errEl.textContent = "";
      const pickErr = picker.error();
      if (pickErr) {
        errEl.textContent = pickErr;
        return;
      }
      const body: {
        client: string;
        notes: string;
        location?: string;
        locationLat?: number | null;
        locationLng?: number | null;
      } = { client: client.value.trim(), notes: notes.value.trim() };
      if (picker.touched()) {
        const place = picker.get();
        if (place) {
          body.location = place.label || current.location;
          body.locationLat = place.lat;
          body.locationLng = place.lng;
        } else {
          body.location = "";
          body.locationLat = null;
          body.locationLng = null;
        }
      }
      try {
        await api.patchJob(current.id, body);
        toast("Details saved");
        await changed();
      } catch (err) {
        errEl.textContent = err instanceof Error ? err.message : String(err);
      }
    };

    const delTrip = h("button", { class: "btn danger sm", style: "align-self:flex-end" }, "Delete trip");
    delTrip.onclick = async () => {
      if (!(await confirmDialog({
        title: `Delete "${current.client}"?`,
        message: "Removes the trip, its photos, readings and any lodged claim. This cannot be undone.",
        confirmLabel: "Delete trip",
        danger: true,
      }))) return;
      try {
        await api.deleteJob(current.id);
        modal.close();
        toast("Trip deleted");
        await refresh();
      } catch (err) {
        errEl.textContent = err instanceof Error ? err.message : String(err);
      }
    };

    const photos = h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px" },
      readingSlot(current, "start", eventPromise, settingsPromise, changed, () => void captureFor("start")),
      readingSlot(current, "end", eventPromise, settingsPromise, changed, () => void captureFor("end")),
    );

    const returnArea = current.returnLog
      ? readingSlot(current, "return", eventPromise, settingsPromise, changed)
      : driveHomeSection(current, settingsPromise, eventPromise, changed);

    return h("div", { class: "col", style: "gap:12px" },
      chips,
      car,
      linker,
      h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px" },
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Client / purpose"), client),
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Location"), picker.el),
      ),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Notes"), notes),
      photos,
      returnArea,
      onwardSection(current, refresh, () => modal.close()),
      money,
      h("div", { class: "row spread" }, claimControls(current, changed), delTrip),
      errEl,
      h("div", { class: "row", style: "justify-content:flex-end" }, saveDetails),
    );
  }

  modal = showModal({ title: `Trip — ${job.jobDate}`, body: build(job), wide: true });
}
