import { api, ApiError } from "../api.ts";
import { showModal } from "./modal.ts";
import { toast } from "./toast.ts";
import { h } from "../dom.ts";
import { locationPicker } from "./locationPicker.ts";
import { lastTravelMinutes, timingHelper } from "./timingHelper.ts";
import type { JobDto } from "../../../shared/types.ts";

export interface CaptureContext {
  job: JobDto;
  role: "start" | "end";
  vehicleId: number;
  /** When set (dashboard flows), the saved no-photo job opens in the trip popup so the reading can be entered straight away. */
  onManualSaved?: (job: JobDto) => void;
}

const GPS_TIMEOUT_MS = 3500; // never block saving on a pending GPS fix

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function getPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

/**
 * Phone-style odometer capture: Take photo / Use an existing photo (both save
 * automatically on selection), or "Later on" for a no-photo log with manual
 * arrival time, travel time from home base and an NZ address lookup.
 */
export async function openCaptureWizard(ctx: CaptureContext, onDone: () => Promise<void>): Promise<void> {
  const settings = await api.settings().catch(() => null);
  const homeBase = settings
    ? { homeBaseAddress: settings.homeBaseAddress, homeBaseLat: settings.homeBaseLat, homeBaseLng: settings.homeBaseLng }
    : null;

  const label = ctx.role === "start" ? "Start photo (before you drive)" : "End photo (trip finished)";
  const hiddenInputStyle = "position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none";
  const fileInput = h("input", { type: "file", accept: "image/*", capture: "environment", style: hiddenInputStyle }) as HTMLInputElement;
  const pickInput = h("input", { type: "file", accept: "image/*", style: hiddenInputStyle }) as HTMLInputElement;

  const preview = h("div", {
    style: "min-height:150px;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border:1px solid var(--line-dim);border-radius:var(--r-md);overflow:hidden",
  });
  const previewImg = h("img", { class: "photo", alt: "" }) as HTMLImageElement;
  previewImg.style.display = "none";

  const gpsEl = h("p", { class: "text-dim", style: "font-size:0.78rem;margin:0" }, "Location is captured before saving");
  const metaEl = h("p", { class: "text-dim", style: "font-size:0.78rem;margin:0" });
  const info = h("div", { style: "padding:2px 2px" }, gpsEl, metaEl);

  let lat: number | null = null;
  let lng: number | null = null;
  let accuracy: number | null = null;
  let gpsSource: "live" | "exif" | "manual" | "none" = "none";
  const takenAt = new Date();

  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem;margin:0" });
  const buttons: HTMLButtonElement[] = [];

  const picker = locationPicker({
    lat: ctx.role === "start" ? settings?.homeBaseLat ?? null : null,
    lng: ctx.role === "start" ? settings?.homeBaseLng ?? null : null,
    label: ctx.role === "start" ? settings?.homeBaseAddress ?? "" : "",
    homeBase,
    placeholder: ctx.role === "end" ? "Search the client's NZ address…" : "Search a NZ address…",
  });
  if (ctx.role === "end" && ctx.job.location) picker.prefill(ctx.job.location);

  const timing = timingHelper({
    role: ctx.role,
    arrivalIso: takenAt.toISOString(),
    durationMinutes: ctx.role === "start" ? lastTravelMinutes() : null,
  });
  if (ctx.job.eventUid) {
    api
      .calendarEventByUid(ctx.job.eventUid)
      .then((ev) => {
        if (ev?.startAt) timing.prefillArrival(ev.startAt);
      })
      .catch(() => {
        /* no linked event reachable */
      });
  }

  const manualPanel = h("div", { class: "col", style: "gap:10px;display:none;border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:10px;background:rgba(15,23,42,0.35)" });
  const saveManualBtn = h("button", { class: "btn primary", style: "width:100%" }, "Save without photo");
  const backBtn = h("button", { class: "btn ghost sm", style: "align-self:flex-start" }, "‹ Back to photo options");

  function setBusy(value: boolean): void {
    for (const b of buttons) b.disabled = value;
  }

  async function locate(): Promise<void> {
    gpsEl.textContent = "Getting GPS fix...";
    const pos = await Promise.race([
      getPosition(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS)),
    ]);
    if (pos) {
      lat = pos.lat;
      lng = pos.lng;
      accuracy = pos.accuracy;
      gpsSource = "live";
      gpsEl.textContent = `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)} ±${accuracy}m`;
    } else {
      gpsEl.textContent = "No live GPS here — the photo's EXIF is used if it has coordinates";
    }
  }

  let locating: Promise<void> | null = null;
  function startLocate(): void {
    if (!locating) locating = locate();
  }

  function pickFile(input: HTMLInputElement): void {
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) saveNow(file);
    };
    input.click();
  }

  async function saveNow(photo: File | null): Promise<void> {
    setBusy(true);
    errEl.textContent = "";
    if (locating) await locating;
    try {
      const fields: Record<string, string | number> = {
        role: ctx.role,
        vehicleId: ctx.vehicleId,
      };
      const pickErr = picker.error();
      if (pickErr) {
        errEl.textContent = pickErr;
        setBusy(false);
        return;
      }
      const place = picker.get();
      const usePicked = place != null && (!photo || picker.touched());
      if (photo) {
        fields.takenAt = takenAt.toISOString();
      } else {
        fields.takenAt = timing.iso();
      }
      if (usePicked) {
        fields.lat = place.lat;
        fields.lng = place.lng;
        fields.locationLabel = place.label;
        fields.gpsSource = "manual";
      } else if (lat != null && lng != null) {
        fields.lat = lat;
        fields.lng = lng;
        fields.accuracy = accuracy ?? 0;
        fields.gpsSource = gpsSource;
      }
      const saved = await api.uploadLog(ctx.job.id, photo, fields);
      modal.close();
      if (photo) {
        toast("Photo logged — enter the reading on the Review page");
        await onDone();
      } else {
        toast(`Saved at ${fmtTime(String(fields.takenAt))} without a photo — the reading can be set now or later`);
        await onDone();
        ctx.onManualSaved?.(saved);
      }
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : String(err);
      setBusy(false);
    }
  }

  const camBtn = h("button", { class: "btn primary", style: "width:100%;padding:16px;font-size:1rem" }, "Take photo");
  camBtn.onclick = () => {
    errEl.textContent = "";
    startLocate();
    pickFile(fileInput);
  };
  const pickBtn = h("button", { class: "btn", style: "width:100%" }, "Use an existing photo");
  pickBtn.onclick = () => {
    errEl.textContent = "";
    startLocate();
    pickFile(pickInput);
  };
  const photoSection = h("div", { class: "col", style: "gap:8px" },
    preview,
    info,
    h("div", { class: "col", style: "gap:6px" }, camBtn, pickBtn),
  );
  const divider = h("p", { class: "text-faint", style: "font-size:0.72rem;text-align:center;margin:0" }, "— or —");
  const laterBtn = h("button", { class: "btn ghost", style: "width:100%" }, "Later on — no photo, enter details");
  laterBtn.onclick = () => {
    errEl.textContent = "";
    startLocate();
    photoSection.style.display = "none";
    divider.style.display = "none";
    laterBtn.style.display = "none";
    manualPanel.style.display = "flex";
    (manualPanel.querySelector("input") as HTMLInputElement | null)?.focus();
  };
  backBtn.onclick = () => {
    manualPanel.style.display = "none";
    photoSection.style.display = "";
    divider.style.display = "";
    laterBtn.style.display = "";
  };
  saveManualBtn.onclick = () => {
    errEl.textContent = "";
    void saveNow(null);
  };
  buttons.push(camBtn, pickBtn, laterBtn, saveManualBtn);

  manualPanel.append(
    h("div", { class: "row spread" },
      h("span", { style: "font-weight:600;font-size:0.85rem" }, "No photo — set the trip time & location"),
      backBtn,
    ),
    timing.el,
    h("div", { class: "field", style: "margin:0" },
      h("label", {}, ctx.role === "start" ? "Leaving from" : "Arriving at"),
      picker.el,
    ),
    saveManualBtn,
  );

  preview.append(previewImg);
  const modal = showModal({
    title: "Log odometer",
    body: h("div", { class: "col" },
      h("div", { style: "font-weight:600" }, `${ctx.job.client} — ${label}`),
      photoSection,
      divider,
      laterBtn,
      manualPanel,
      errEl,
      fileInput,
      pickInput,
    ),
  });
  metaEl.textContent = `${fmtTime(takenAt.toISOString())}  •  ${ctx.job.client}`;
}
