import { api, ApiError } from "../api.ts";
import { showModal } from "./modal.ts";
import { toast } from "./toast.ts";
import { locateOnce } from "./captureWizard.ts";
import { h } from "../dom.ts";
import type { CalEventDto, JobDto, LogDto, VehicleDto } from "../../../shared/types.ts";

export interface TripFlowOptions {
  mode: "start" | "stop";
  /** Existing trip to start/stop. Omit to create a new trip on Start. */
  job?: JobDto;
  vehicles: VehicleDto[];
  onDone: () => Promise<void>;
}

const LAST_VEHICLE_KEY = "jt:lastVehicle";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pickVehicle(job: JobDto | undefined, vehicles: VehicleDto[]): VehicleDto | null {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const remembered = Number(localStorage.getItem(LAST_VEHICLE_KEY) ?? 0);
  return (
    (job?.vehicleId != null ? byId.get(job.vehicleId) : undefined) ??
    byId.get(remembered) ??
    vehicles.find((v) => v.active) ??
    vehicles[0] ??
    null
  );
}

function openEventPicker(currentUid: string | null, onPick: (event: CalEventDto | null) => void): void {
  const body = h("div", { class: "col", style: "gap:6px" });
  const modal = showModal({ title: "Calendar link", body });
  const list = h("div", { class: "col", style: "gap:4px" });
  const none = h("button", { class: "btn", style: "justify-content:flex-start;width:100%" },
    currentUid ? "No calendar event (unlink)" : "No calendar event (optional)",
  );
  none.onclick = () => {
    modal.close();
    onPick(null);
  };
  body.append(none, list);
  const loading = h("p", { class: "text-dim", style: "font-size:0.85rem;margin:4px 0" }, "Loading bookings…");
  list.append(loading);

  api
    .upcomingEvents(21)
    .then((events) => {
      loading.remove();
      const upcoming = events.filter((e) => e.startAt != null).sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1));
      if (upcoming.length === 0) {
        list.append(h("p", { class: "text-dim", style: "font-size:0.85rem;margin:4px 0" },
          "No upcoming bookings. Link your iCloud calendar in Settings to pick jobs here."));
        return;
      }
      for (const event of upcoming) {
        const row = h("button", {
          class: "btn",
          style: `justify-content:space-between;width:100%;text-align:left;${event.uid === currentUid ? "border-color:rgba(20,184,166,0.5);color:var(--accent)" : ""}`,
        },
          h("span", { style: "font-weight:600;white-space:normal" }, `${event.uid === currentUid ? "✓ " : ""}${event.summary || "Event"}`),
          h("span", { class: "text-dim", style: "font-size:0.72rem;white-space:nowrap" }, fmtTime(event.startAt!)),
        );
        row.onclick = () => {
          modal.close();
          onPick(event);
        };
        list.append(row);
      }
    })
    .catch(() => {
      loading.textContent = "Could not load bookings — check the calendar link in Settings.";
    });
}

/**
 * One-tap Start/Stop trip popup: optional odometer reading, photo and calendar
 * link, plus a live GPS fix resolved to a NZ address. Everything can be edited
 * later from the trip popup.
 */
export function openTripFlow(opts: TripFlowOptions): void {
  const { mode } = opts;
  const isStart = mode === "start";
  const vehicle = pickVehicle(opts.job, opts.vehicles);
  if (!vehicle) {
    toast("Add a vehicle in Settings first — each trip logs against a car.", "err");
    return;
  }
  const car = vehicle;
  if (isStart && opts.job?.startLogId != null) {
    toast("This trip is already started — use Stop trip.", "err");
    return;
  }
  if (!isStart && !opts.job?.startLogId) {
    toast("Start the trip before stopping it.", "err");
    return;
  }

  const mileageI = h("input", {
    class: "neon-input",
    type: "number",
    inputmode: "numeric",
    min: "0",
    step: "1",
    placeholder: "e.g. 123456",
  }) as HTMLInputElement;

  const hiddenStyle = "position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none";
  const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", style: hiddenStyle }) as HTMLInputElement;
  const pickInput = h("input", { type: "file", accept: "image/*", style: hiddenStyle }) as HTMLInputElement;
  const photoName = h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" }, "Photo optional — odometer, dashboard or anything helpful.");
  const preview = h("img", { class: "photo", alt: "" }) as HTMLImageElement;
  preview.style.display = "none";
  preview.style.width = "100%";
  preview.style.maxHeight = "140px";
  preview.style.objectFit = "cover";
  preview.style.borderRadius = "var(--r-sm)";
  let photoFile: File | null = null;
  let previewUrl: string | null = null;

  const gpsEl = h("p", { class: "text-dim", style: "font-size:0.78rem;margin:0" }, "Getting GPS fix…");
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem;margin:0" });
  const eventSummary = h("span", { class: "text-dim", style: "font-size:0.78rem;flex:1;min-width:0" });

  let selectedEvent: CalEventDto | null = null;
  let eventTouched = false;
  const initialEventUid = opts.job?.eventUid ?? null;

  function renderEvent(): void {
    if (selectedEvent) {
      eventSummary.textContent = `${selectedEvent.summary || "Event"}${selectedEvent.startAt ? ` — ${fmtTime(selectedEvent.startAt)}` : ""}`;
    } else if (eventTouched) {
      eventSummary.textContent = "No calendar event linked";
    } else if (initialEventUid) {
      eventSummary.textContent = "Linked calendar event";
    } else {
      eventSummary.textContent = "No calendar event linked (optional)";
    }
  }
  renderEvent();

  if (initialEventUid) {
    api
      .calendarEventByUid(initialEventUid)
      .then((event) => {
        if (event && !eventTouched) {
          selectedEvent = event;
          renderEvent();
        }
      })
      .catch(() => undefined);
  }

  const calendarBtn = h("button", { class: "btn", type: "button" }, "Calendar link");
  calendarBtn.onclick = () => {
    openEventPicker(selectedEvent?.uid ?? initialEventUid, (event) => {
      selectedEvent = event;
      eventTouched = true;
      renderEvent();
    });
  };

  function setPhoto(file: File | null): void {
    photoFile = file;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (!file) {
      preview.style.display = "none";
      preview.removeAttribute("src");
      photoName.textContent = "Photo optional — odometer, dashboard or anything helpful.";
      removePhotoBtn.style.display = "none";
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.style.display = "block";
    photoName.textContent = file.name;
    removePhotoBtn.style.display = "";
  }

  function openPicker(input: HTMLInputElement): void {
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) setPhoto(file);
    };
    input.click();
  }

  const photoBtn = h("button", { class: "btn", type: "button" }, "Photo");
  photoBtn.onclick = () => openPicker(camInput);
  const chooseBtn = h("button", { class: "btn ghost sm", type: "button" }, "Choose existing");
  chooseBtn.onclick = () => openPicker(pickInput);
  const removePhotoBtn = h("button", {
    class: "btn ghost sm",
    type: "button",
    onclick: () => setPhoto(null),
  }, "Remove photo");
  removePhotoBtn.style.display = "none";

  const located: { pos: { lat: number; lng: number; accuracy: number } | null; label: string } = { pos: null, label: "" };
  const gpsReady = locateOnce().then(async (pos) => {
    if (!pos) {
      gpsEl.textContent = "No live GPS here — this log will save without a location.";
      return;
    }
    located.pos = pos;
    gpsEl.textContent = `GPS ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} — looking up the address…`;
    try {
      located.label = (await api.reverseGeocode(pos.lat, pos.lng)).label;
      gpsEl.textContent = `📍 ${located.label}`;
    } catch {
      gpsEl.textContent = `GPS ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (address lookup unavailable)`;
    }
  });

  const actionBtn = h("button", { class: "btn primary", type: "button", style: "width:100%;padding:14px;font-size:1rem" },
    isStart ? "Start" : "Stop",
  );
  const cancelBtn = h("button", { class: "btn ghost", type: "button", onclick: () => modal.close() }, "Cancel");

  function readMileage(): number | null {
    const raw = mileageI.value.trim();
    if (!raw) return null;
    const km = Number(raw);
    if (!Number.isInteger(km) || km < 0) throw new Error("Enter the odometer as a whole number of km.");
    const max = 10 ** (car.digits || 6) - 1;
    if (km > max) throw new Error(`That odometer only shows ${car.digits || 6} digits (max ${max}).`);
    return km;
  }

  async function resolveStartJob(): Promise<{ job: JobDto; created: boolean }> {
    if (opts.job) return { job: opts.job, created: false };
    if (selectedEvent) {
      const jobs = await api.jobs();
      const existing = jobs.find(
        (j) => j.eventUid === selectedEvent!.uid && (j.status === "open" || j.status === "ready"),
      );
      if (existing) {
        if (existing.startLogId != null) {
          throw new Error("That booking already has a trip — stop it from Trips in progress first.");
        }
        return { job: existing, created: false };
      }
      return { job: await api.createJob({ eventUid: selectedEvent.uid }), created: true };
    }
    return { job: await api.createJob({}), created: true };
  }

  actionBtn.onclick = async () => {
    errEl.textContent = "";
    actionBtn.disabled = true;
    let createdJobId: number | null = null;
    try {
      const km = readMileage();
      await gpsReady;

      let target: JobDto;
      if (isStart) {
        const resolved = await resolveStartJob();
        target = resolved.job;
        if (resolved.created) createdJobId = target.id;
      } else {
        target = opts.job!;
      }

      const desiredUid = selectedEvent?.uid ?? (eventTouched ? null : target.eventUid);
      if (desiredUid !== target.eventUid) {
        await api.patchJob(target.id, { eventUid: desiredUid });
      }

      const fields: Record<string, string | number> = {
        role: mode,
        vehicleId: target.vehicleId ?? car.id,
        takenAt: new Date().toISOString(),
      };
      if (located.pos) {
        fields.lat = located.pos.lat;
        fields.lng = located.pos.lng;
        fields.accuracy = located.pos.accuracy;
        fields.gpsSource = "live";
      }
      if (located.label) fields.locationLabel = located.label;

      const saved = await api.uploadLog(target.id, photoFile, fields);
      const log: LogDto | null = isStart ? saved.startLog : saved.endLog;
      if (!log) throw new Error("The trip was saved, but its log slot is missing.");

      let readingWarning = "";
      if (km != null) {
        try {
          await api.setReading(log.id, km);
        } catch (err) {
          readingWarning = err instanceof ApiError ? err.message : String(err);
        }
      }

      localStorage.setItem(LAST_VEHICLE_KEY, String(fields.vehicleId));

      modal.close();
      toast(isStart ? "Trip started" : "Trip stopped");
      if (readingWarning) toast(`Reading not saved: ${readingWarning}`, "err");
      await opts.onDone();
    } catch (err) {
      if (createdJobId != null) await api.deleteJob(createdJobId).catch(() => undefined);
      errEl.textContent = err instanceof Error ? err.message : String(err);
      actionBtn.disabled = false;
    }
  };

  const startHint = opts.job?.startLog
    ? h("p", { class: "text-faint", style: "font-size:0.74rem;margin:0" },
      `Started ${fmtTime(opts.job.startLog.takenAt)}${opts.job.startLog.locationLabel ? ` at ${opts.job.startLog.locationLabel}` : ""}`)
    : null;

  const body = h("div", { class: "col", style: "gap:12px" },
    h("p", { class: "text-dim", style: "font-size:0.85rem;margin:0" },
      isStart
        ? "Starting now. Everything here is optional and editable later."
        : "Stopping now. Add the end mileage or a photo if you have them."),
    startHint,
    h("div", { class: "field", style: "margin:0" },
      h("label", {}, "Mileage / odometer (optional)"),
      mileageI,
      opts.job?.startLog?.readingKm != null
        ? h("p", { class: "text-faint", style: "font-size:0.72rem;margin:4px 0 0" }, `Start reading: ${opts.job.startLog.readingKm} km`)
        : null,
    ),
    h("div", { class: "col", style: "gap:8px" },
      preview,
      h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, photoBtn, chooseBtn, removePhotoBtn),
      photoName,
      camInput,
      pickInput,
    ),
    h("div", { class: "col", style: "gap:4px" },
      h("div", { class: "row", style: "gap:6px;align-items:center" }, calendarBtn, eventSummary),
    ),
    gpsEl,
    errEl,
    actionBtn,
    cancelBtn,
  );

  const modal = showModal({ title: isStart ? "Start trip" : "Stop trip", body });
}
