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
  const fileInput = h("input", { type: "file", accept: "image/*", capture: "environment", class: "hide" }) as HTMLInputElement;
  const pickInput = h("input", { type: "file", accept: "image/*", class: "hide" }) as HTMLInputElement;

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
  let gpsSource: "live" | "exif" | "none" = "none";
  const takenAt = new Date();

  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem;margin:0" });
  const buttons: HTMLButtonElement[] = [];

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
    try {
      const saved = await api.uploadLog(ctx.job.id, photo, {
        role: ctx.role,
        vehicleId: ctx.vehicleId,
        takenAt: takenAt.toISOString(),
        ...(lat != null && lng != null ? { lat, lng, accuracy: accuracy ?? 0 } : {}),
        gpsSource,
      });
      modal.close();
      if (photo) {
        toast("Photo logged — enter the reading on the Review page");
        await onDone();
      } else {
        toast(`Saved at ${fmtTime(takenAt.toISOString())} without a photo — the reading can be set now or later`);
        await onDone();
        ctx.onManualSaved?.(saved);
      }
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : String(err);
      setBusy(false);
    }
  }

  const camBtn = h("button", { class: "btn primary", style: "width:100%;padding:16px;font-size:1rem" }, "Take photo");
  camBtn.onclick = async () => {
    errEl.textContent = "";
    setBusy(true);
    try {
      await locate();
    } finally {
      setBusy(false);
      pickFile(fileInput);
    }
  };
  const pickBtn = h("button", { class: "btn", style: "width:100%" }, "Use an existing photo");
  pickBtn.onclick = async () => {
    errEl.textContent = "";
    setBusy(true);
    try {
      await locate();
    } finally {
      setBusy(false);
      pickFile(pickInput);
    }
  };
  const laterBtn = h("button", { class: "btn ghost", style: "width:100%" }, "Later on — save now without a photo");
  laterBtn.onclick = async () => {
    errEl.textContent = "";
    await locate();
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
      h("div", { class: "col", style: "gap:6px" }, camBtn, pickBtn),
      h("p", { class: "text-faint", style: "font-size:0.72rem;text-align:center;margin:0" }, "— or —"),
      laterBtn,
      errEl,
    ),
  });
  metaEl.textContent = `${fmtTime(takenAt.toISOString())}  •  ${ctx.job.client}`;
}
