import { api } from "../api.ts";
import { confirmDialog, showModal, type ModalHandle } from "./modal.ts";
import { toast } from "./toast.ts";
import { openDialModal } from "./dial.ts";
import { openCaptureWizard } from "./captureWizard.ts";
import { h } from "../dom.ts";
import { formatKm, formatNzd } from "../../../shared/claims.ts";
import type { CalEventDto, JobDto } from "../../../shared/types.ts";

const pad = (km: number | null, digits: number) => (km == null ? "······" : String(km).padStart(digits, "0"));

function statusChip(status: JobDto["status"]): HTMLElement {
  return h("span", { class: `chip ${status}` }, status);
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return `${iso.slice(0, 10)} ${new Date(iso).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`;
}

async function openReading(job: JobDto, role: "start" | "end", logId: number, changed: () => Promise<void>): Promise<void> {
  const info = await api.readingInfo(logId);
  const digits = info.vehicleDigits ?? 6;
  const locked = info.jobStatus === "claimed" || info.jobStatus === "submitted" || info.jobStatus === "paid";
  openDialModal({
    digits,
    startKm: info.log.readingKm ?? info.prevReadingKm ?? info.floorKm,
    floorKm: info.floorKm,
    capKm: info.capKm,
    prevKm: info.prevReadingKm,
    canEdit: info.canEdit && !locked,
    title: `${job.client} — ${role} reading${job.vehiclePlate ? ` (${job.vehiclePlate})` : ""}`,
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

function readingSlot(job: JobDto, role: "start" | "end", changed: () => Promise<void>, onCapture?: () => void): HTMLElement {
  const log = role === "start" ? job.startLog : job.endLog;
  const slot = h("div", { class: "reading-slot", style: "gap:6px" });

  if (!log) {
    slot.append(
      h("div", { class: "row spread" },
        h("span", { style: "font-weight:600;font-size:0.85rem" }, role === "start" ? "Start" : "End"),
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
  const del = h("button", { class: "icon-btn danger", disabled: locked, title: "Delete photo", style: "padding:4px 8px" }, "✕");
  del.onclick = async () => {
    if (!(await confirmDialog({ title: "Delete photo?", message: "Removes the photo, GPS and its reading from this job.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteLog(log.id);
      toast("Photo deleted");
      await changed();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  };

  slot.append(
    h("div", { class: "row spread" },
      h("span", { style: "font-weight:600;font-size:0.85rem" }, role === "start" ? "Start" : "End"),
      h("span", { class: "text-faint mono", style: "font-size:0.72rem" }, fmtWhen(log.takenAt)),
    ),
    media,
    h("div", { class: "row spread" }, reading, h("div", { class: "row", style: "gap:4px" }, edit, del)),
  );
  return slot;
}

/** Clickable "manual log" area: pick/photo a photo and attach it to this log. */
function attachPhotoBox(logId: number, changed: () => Promise<void>): HTMLElement {
  const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", class: "hide" }) as HTMLInputElement;
  const pickInput = h("input", { type: "file", accept: "image/*", class: "hide" }) as HTMLInputElement;
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
  const wrap = h("div", { class: "col", style: "gap:6px" }, box, controls, errEl);
  return wrap;
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
    if (needs) row.append(h("span", { class: "text-dim", style: "font-size:0.78rem" }, "Needs both photos + readings"));
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

/** Popup with full, editable details for a trip (used by Review + Log pages). */
/**
 * Searchable calendar-event linker: shows the linked booking (if any) and lets
 * the user search the synced feed to link, change or unlink this trip.
 */
function eventLinker(current: JobDto, changed: () => Promise<void>): HTMLElement {
  let cache: CalEventDto[] | null = null;

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

  // Searchable dropdown
  const search = h("input", { class: "neon-input", placeholder: "Search client bookings…", autocomplete: "off" }) as HTMLInputElement;
  const results = h("div", {
    style:
      "max-height:200px;overflow-y:auto;border:1px solid var(--line-dim);border-radius:var(--r-sm);background:var(--bg-input);display:none",
  });
  const hint = h("p", { class: "text-faint", style: "font-size:0.74rem;margin:0" }, "Type to filter — click a booking to link this trip to it.");
  const panel = h("div", { class: "col", style: "gap:6px;display:none" }, search, results, hint);

  function dayLabel(iso: string | null): string {
    return iso ? iso.slice(0, 10) : "";
  }

  async function ensureEvents(): Promise<void> {
    if (cache) return;
    const from = new Date();
    from.setFullYear(from.getFullYear() - 2);
    const to = new Date();
    to.setFullYear(to.getFullYear() + 2);
    cache = await api.calendarEvents(from.toISOString(), to.toISOString()).catch(() => []);
  }

  function clearResults(): void {
    while (results.firstChild) results.removeChild(results.firstChild);
  }

  function renderMatches(): void {
    clearResults();
    if (!cache) return;
    const q = search.value.trim().toLowerCase();
    const matches = cache!
      .filter((e) => !q || `${e.summary} ${e.location}`.toLowerCase().includes(q))
      .sort((a, b) => ((a.startAt ?? "") < (b.startAt ?? "") ? -1 : 1))
      .slice(0, 40);
    if (matches.length === 0) {
      results.append(h("div", { class: "text-dim", style: "padding:10px;font-size:0.85rem" }, "No matching bookings — try another search or check the calendar link in Settings."));
      return;
    }
    for (const e of matches) {
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
      row.onclick = async () => {
        try {
          await api.patchJob(current.id, { eventUid: e.uid });
          toast(`Linked to “${e.summary || "event"}”`);
          await changed();
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), "err");
        }
      };
      results.append(row);
    }
  }

  async function openPanel(): Promise<void> {
    if (panel.style.display === "none") {
      panel.style.display = "flex";
      await ensureEvents();
      renderMatches();
      search.focus();
    } else {
      panel.style.display = "none";
    }
  }

  changeBtn.onclick = () => void openPanel();
  search.oninput = renderMatches;
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
  const location = h("input", { class: "neon-input", value: job.location, placeholder: "Location" }) as HTMLInputElement;
  const notes = h("textarea", { class: "neon-input", rows: 2, style: "resize:vertical;min-height:52px", placeholder: "Notes / purpose detail" }) as HTMLTextAreaElement;
  notes.value = job.notes;
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem" });

  let modal: ModalHandle;

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
    location.value = current.location;
    notes.value = current.notes;

    const chips = h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" },
      current.tripKind === "personal" ? h("span", { class: "chip personal" }, "Personal") : statusChip(current.status),
      current.vehiclePlate ? h("span", { class: "badge" }, current.vehiclePlate) : null,
      current.claimedAt ? h("span", { class: "badge muted" }, `claimed ${current.claimedAt.slice(0, 10)}`) : null,
      current.paidAt ? h("span", { class: "badge muted" }, `paid ${current.paidAt.slice(0, 10)}`) : null,
    );

    const linker = eventLinker(current, changed);

    async function captureFor(role: "start" | "end"): Promise<void> {
      if (current.vehicleId != null) {
        openCaptureWizard({ job: current, role, vehicleId: current.vehicleId }, changed);
        return;
      }
      try {
        const vehicles = await api.vehicles();
        const pick = vehicles.find((v) => v.active) ?? vehicles[0];
        if (!pick) {
          toast("Add a vehicle in Settings first", "err");
          return;
        }
        openCaptureWizard({ job: current, role, vehicleId: pick.id }, changed);
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
      try {
        await api.patchJob(current.id, {
          client: client.value.trim(),
          location: location.value.trim(),
          notes: notes.value.trim(),
        });
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
      readingSlot(current, "start", changed, () => void captureFor("start")),
      readingSlot(current, "end", changed, () => void captureFor("end")),
    );

    return h("div", { class: "col", style: "gap:12px" },
      chips,
      linker,
      h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px" },
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Client / purpose"), client),
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Location"), location),
      ),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Notes"), notes),
      photos,
      money,
      h("div", { class: "row spread" }, claimControls(current, changed), delTrip),
      errEl,
      h("div", { class: "row", style: "justify-content:flex-end" }, saveDetails),
    );
  }

  modal = showModal({ title: `Trip — ${job.jobDate}`, body: build(job), wide: true });
}
