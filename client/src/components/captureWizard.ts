import { api, ApiError } from "../api.ts";
import { showModal } from "./modal.ts";
import { toast } from "./toast.ts";
import { h } from "../dom.ts";
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

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local YYYY-MM-DDTHH:MM value for an <input type=datetime-local>. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
 * automatically on selection), or "Later on" to log without a photo.
 */
export function openCaptureWizard(ctx: CaptureContext, onDone: () => Promise<void>): void {
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

  const manualToggle = h("button", { class: "btn ghost sm", style: "align-self:flex-start" }, "Set date, time & location manually");
  const manualPanel = h("div", { class: "col", style: "gap:6px;display:none;border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:8px;background:rgba(15,23,42,0.35)" });
  let takenDirty = false;
  const whenI = h("input", { class: "neon-input", type: "datetime-local", value: toLocalInput(takenAt.toISOString()) }) as HTMLInputElement;
  whenI.oninput = () => {
    takenDirty = true;
  };
  const latI = h("input", { class: "neon-input", type: "number", step: "any", min: "-90", max: "90", placeholder: "Latitude" }) as HTMLInputElement;
  const lngI = h("input", { class: "neon-input", type: "number", step: "any", min: "-180", max: "180", placeholder: "Longitude" }) as HTMLInputElement;
  manualToggle.onclick = () => {
    const open = manualPanel.style.display === "none";
    manualPanel.style.display = open ? "flex" : "none";
    manualToggle.textContent = open ? "Use photo time / live GPS instead" : "Set date, time & location manually";
  };
  manualPanel.append(
    h("div", { class: "col", style: "gap:2px" },
      h("span", { class: "text-dim", style: "font-size:0.72rem;font-weight:600" }, "When"),
      whenI,
    ),
    h("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:6px" },
      h("div", { class: "col", style: "gap:2px" },
        h("span", { class: "text-dim", style: "font-size:0.72rem;font-weight:600" }, "Latitude"),
        latI,
      ),
      h("div", { class: "col", style: "gap:2px" },
        h("span", { class: "text-dim", style: "font-size:0.72rem;font-weight:600" }, "Longitude"),
        lngI,
      ),
    ),
    h("p", { class: "text-faint", style: "font-size:0.72rem;margin:0" },
      "Leave coordinates empty to keep the live GPS / photo EXIF location. Type both to pin a manual location instead."),
  );

  function manualLocation(): { lat: number; lng: number } | null {
    const latRaw = latI.value.trim();
    const lngRaw = lngI.value.trim();
    if (latRaw === "" && lngRaw === "") return null;
    const latNum = Number(latRaw);
    const lngNum = Number(lngRaw);
    if (latRaw === "" || lngRaw === "" || !Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      errEl.textContent = "Enter both latitude and longitude to set a manual location.";
      return null;
    }
    return { lat: latNum, lng: lngNum };
  }

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
    const coordsGiven = latI.value.trim() !== "" || lngI.value.trim() !== "";
    const manualPos = manualLocation();
    if (coordsGiven && !manualPos) {
      setBusy(false);
      return;
    }
    if (!whenI.value) {
      errEl.textContent = "Enter the date and time first.";
      setBusy(false);
      return;
    }
    try {
      const chosenIso = takenDirty && whenI.value ? new Date(whenI.value).toISOString() : takenAt.toISOString();
      const fields: Record<string, string | number> = {
        role: ctx.role,
        vehicleId: ctx.vehicleId,
        takenAt: chosenIso,
      };
      if (manualPos) {
        fields.lat = manualPos.lat;
        fields.lng = manualPos.lng;
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
        toast(`Saved at ${fmtTime(chosenIso)} without a photo — the reading can be set now or later`);
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
  const laterBtn = h("button", { class: "btn ghost", style: "width:100%" }, "Later on — save now without a photo");
  laterBtn.onclick = async () => {
    errEl.textContent = "";
    startLocate();
    await saveNow(null);
  };
  buttons.push(camBtn, pickBtn, laterBtn);

  preview.append(previewImg);
  const modal = showModal({
    title: "Log odometer",
    body: h("div", { class: "col" },
      h("div", { style: "font-weight:600" }, `${ctx.job.client} — ${label}`),
      preview,
      info,
      manualToggle,
      manualPanel,
      h("div", { class: "col", style: "gap:6px" }, camBtn, pickBtn),
      h("p", { class: "text-faint", style: "font-size:0.72rem;text-align:center;margin:0" }, "— or —"),
      laterBtn,
      errEl,
      fileInput,
      pickInput,
    ),
  });
  metaEl.textContent = `${fmtTime(takenAt.toISOString())}  •  ${ctx.job.client}`;
}
