import { api, ApiError } from "../api.ts";
import { confirmDialog, showModal } from "../components/modal.ts";
import { toast } from "../components/toast.ts";
import { locationPicker } from "../components/locationPicker.ts";
import { clear, h } from "../dom.ts";
import type { SettingsDto, VehicleDto } from "../../../shared/types.ts";

let settings: SettingsDto | null = null;
let vehicles: VehicleDto[] = [];

async function refresh(): Promise<void> {
  [settings, vehicles] = await Promise.all([api.settings(), api.vehicles()]);
}

function fyBounds(): { from: string; to: string } {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${year}-07-01`, to: `${year + 1}-06-30` };
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Vehicles ---------------------------------------------------------------------

function vehicleForm(v?: VehicleDto): { fields: HTMLElement; values: () => Omit<VehicleDto, "id"> } {
  const plate = h("input", { class: "neon-input", value: v?.plate ?? "", placeholder: "ABC123", maxlength: "12" }) as HTMLInputElement;
  const make = h("input", { class: "neon-input", value: v?.make ?? "", placeholder: "Toyota" }) as HTMLInputElement;
  const model = h("input", { class: "neon-input", value: v?.model ?? "", placeholder: "Corolla" }) as HTMLInputElement;
  const rate = h("input", {
    class: "neon-input",
    value: v ? String(v.rateCents / 100) : "0.95",
    inputmode: "decimal",
    type: "number",
    step: "0.01",
    min: "0",
  }) as HTMLInputElement;
  const digits = h("select", { class: "neon-input" }) as HTMLSelectElement;
  for (const d of [5, 6, 7]) {
    const o = document.createElement("option");
    o.value = String(d);
    o.textContent = `${d} digits`;
    if ((v?.digits ?? 6) === d) o.selected = true;
    digits.append(o);
  }
  const active = h("input", { type: "checkbox", checked: v?.active ?? true }) as HTMLInputElement;
  const activeRow = h("label", { class: "check-row" }, active, "Active vehicle");

  // Tiered (IRD-style) rates
  const tiered = h("input", { type: "checkbox", checked: v?.tierKm != null && v?.tierRateCents != null }) as HTMLInputElement;
  const tierRow = h("label", { class: "check-row" }, tiered, "Tiered rates (IRD style)");
  const tierHint = h("p", { class: "text-dim", style: "font-size:0.78rem;margin:0" },
    "The first rate applies up to a yearly km limit per vehicle (1 July – 30 June). Above it, the second rate applies.");
  const tierKm = h("input", {
    class: "neon-input",
    value: v?.tierKm != null ? String(v.tierKm) : "14000",
    inputmode: "numeric",
    type: "number",
    min: "1",
    step: "1",
  }) as HTMLInputElement;
  const tierRate = h("input", {
    class: "neon-input",
    value: v?.tierRateCents != null ? String(v.tierRateCents / 100) : "0.63",
    inputmode: "decimal",
    type: "number",
    step: "0.01",
    min: "0",
  }) as HTMLInputElement;

  const tierFields = h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px" },
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Km limit per claim year"), tierKm),
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Rate after limit ($/km)"), tierRate),
  );
  const tierBox = h("div", { class: "col", style: "border:1px dashed var(--line);border-radius:var(--r-md);padding:12px" },
    tierHint, tierFields);

  function syncTier(): void {
    const on = tiered.checked;
    tierKm.disabled = !on;
    tierRate.disabled = !on;
    tierBox.style.opacity = on ? "1" : "0.5";
  }
  tiered.onchange = syncTier;
  syncTier();

  const rateField = h("div", { class: "field", style: "margin:0" }, h("label", {}, "Rate ($/km)"), rate);
  const digitsField = h("div", { class: "field", style: "margin:0" }, h("label", {}, "Odometer digits"), digits);

  const fields = h("div", { class: "col" },
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Number plate"), plate),
    h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px" },
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Make"), make),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Model"), model),
    ),
    h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px" }, rateField, digitsField),
    tierRow,
    tierBox,
    activeRow,
  );

  const values = (): Omit<VehicleDto, "id"> => ({
    plate: plate.value.trim().toUpperCase(),
    make: make.value.trim().toUpperCase(),
    model: model.value.trim().toUpperCase(),
    rateCents: Math.round((parseFloat(rate.value) || 0) * 100),
    tierKm: tiered.checked ? Math.round(parseFloat(tierKm.value) || 0) || null : null,
    tierRateCents: tiered.checked ? Math.round((parseFloat(tierRate.value) || 0) * 100) : null,
    digits: Number(digits.value),
    active: active.checked,
  });
  return { fields, values };
}

function vehicleRateSummary(v: VehicleDto): HTMLElement {
  if (v.tierKm != null && v.tierRateCents != null) {
    return h("span", { class: "text-dim", style: "font-size:0.8rem" },
      h("span", { class: "badge ok" }, `${fmtMoney(v.rateCents)}/km`),
      ` first ${v.tierKm.toLocaleString("en-NZ")} km/yr, then `,
      h("span", { class: "badge ok" }, `${fmtMoney(v.tierRateCents)}/km`),
    );
  }
  return h("span", { class: "badge ok" }, `${fmtMoney(v.rateCents)}/km`);
}

function vehicleModal(v?: VehicleDto): void {
  const { fields, values } = vehicleForm(v);
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem" });
  const modal = showModal({ title: v ? `Edit ${v.plate}` : "Add vehicle", body: h("div", { class: "col" }, fields, errEl) });
  const actions = h("div", { class: "row", style: "justify-content:flex-end;margin-top:4px" });
  const cancel = h("button", { class: "btn", onclick: () => modal.close() }, "Cancel");
  const save = h("button", { class: "btn primary" }, v ? "Save vehicle" : "Add vehicle");
  save.onclick = async () => {
    try {
      if (v) await api.updateVehicle({ ...values(), id: v.id });
      else await api.createVehicle(values());
      modal.close();
      toast(v ? "Vehicle updated" : "Vehicle added");
      await rerender();
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
    }
  };
  actions.append(cancel, save);
  fields.append(actions);
}

function renderVehicles(body: HTMLElement): void {
  clear(body);
  body.append(h("div", { class: "card-head" },
    h("div", { class: "card-title" }, "Fleet / vehicles"),
    h("button", { class: "btn primary sm", onclick: () => vehicleModal() }, "+ Add vehicle"),
  ));

  if (vehicles.length === 0) {
    body.append(h("div", { class: "empty" },
      h("div", { class: "empty-title" }, "No vehicles yet"),
      h("p", {}, "Add the car(s) you claim mileage for."),
    ));
    return;
  }
  const list = h("div", { class: "col", style: "gap:0" });
  vehicles.forEach((v, index) => {
    const row = h("div", { class: "trip-row", style: index === 0 ? "border-top:1px solid var(--line-dim)" : "" });
    const name = h("div", { class: "col", style: "gap:1px;flex:1;min-width:0" },
      h("div", { class: "row", style: "gap:8px" },
        h("span", { class: "badge" }, v.plate),
        h("span", { style: "font-weight:600" }, [v.make, v.model].filter(Boolean).join(" ") || "Vehicle"),
        v.active ? null : h("span", { class: "badge warn" }, "inactive"),
      ),
      h("div", { class: "row", style: "gap:8px" }, vehicleRateSummary(v), h("span", { class: "text-faint", style: "font-size:0.76rem" }, `${v.digits}-digit odometer`)),
    );
    const edit = h("button", { class: "icon-btn", title: "Edit", onclick: () => vehicleModal(v) }, "✎");
    const del = h("button", { class: "icon-btn danger", title: "Delete", onclick: deleteVehicle });
    del.append(document.createTextNode("✕"));
    async function deleteVehicle(): Promise<void> {
      if (!(await confirmDialog({ title: `Delete ${v.plate}?`, message: "The vehicle can only be removed once no jobs or logs reference it.", confirmLabel: "Delete", danger: true }))) return;
      try {
        await api.deleteVehicle(v.id);
        toast(`${v.plate} deleted`);
        await rerender();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "err");
      }
    }
    row.append(name, h("div", { class: "row", style: "gap:2px" }, edit, del));
    list.append(row);
  });
  body.append(list);
}

// Calendar ---------------------------------------------------------------------

function renderCalendar(body: HTMLElement): void {
  clear(body);
  body.append(h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Calendar integration")));

  const label = h("input", { class: "neon-input", value: settings?.calendarLabel ?? "Client calendar" }) as HTMLInputElement;
  const url = h("input", {
    class: "neon-input",
    value: settings?.calendarUrl ?? "",
    placeholder: "https://pXX-caldav.icloud.com/published/.../calendar.ics",
  }) as HTMLInputElement;
  const helper = h("p", { class: "text-dim", style: "font-size:0.78rem" },
    "iCloud: open the calendar's Share settings and copy its Public Calendar (webcal) link. JudeTracker syncs it automatically every 15 minutes.");

  const status = h("span");
  if (settings?.syncError) {
    status.append(h("span", { class: "badge warn" }, "Sync error"), h("span", { class: "text-danger", style: "font-size:0.8rem" }, `  ${settings.syncError}`));
  } else if (settings?.lastSyncAt) {
    status.append(h("span", { class: "badge ok" }, "Synced"), h("span", { class: "text-dim", style: "font-size:0.8rem" }, `  last check ${new Date(settings.lastSyncAt).toLocaleString("en-NZ")}`));
  } else {
    status.append(h("span", { class: "badge warn" }, "Not synced"), h("span", { class: "text-dim", style: "font-size:0.8rem" }, "  no calendar link yet"));
  }

  const syncBtn = h("button", { class: "btn" }, "Sync now");
  const saveBtn = h("button", { class: "btn primary" }, "Save calendar link");
  syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing...";
    try {
      const r = await api.syncCalendar();
      const bits = [`${r.added} new`, `${r.updated} updated`];
      if (r.removed > 0) bits.push(`${r.removed} removed`);
      toast(`Calendar synced: ${bits.join(", ")}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
    await rerender();
  };
  saveBtn.onclick = async () => {
    try {
      await api.saveSettings({ calendarUrl: url.value.trim() || null, calendarLabel: label.value.trim() });
      toast("Link saved — syncing now");
      saveBtn.disabled = true;
      try {
        await api.syncCalendar();
      } catch {
        /* error shows in the badge after re-render */
      }
      await rerender();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  };

  body.append(
    h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px" },
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "Calendar name"), label),
      h("div", { class: "field", style: "margin:0" }, h("label", {}, "iCloud public calendar link (.ics)"), url),
    ),
    helper,
    h("div", { class: "row", style: "gap:10px" }, status),
    h("div", { class: "row", style: "justify-content:flex-end" }, syncBtn, saveBtn),
  );
}

// Home base --------------------------------------------------------------------

function renderHomeBase(body: HTMLElement): void {
  clear(body);
  body.append(h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Home base")));

  const picker = locationPicker({
    lat: settings?.homeBaseLat ?? null,
    lng: settings?.homeBaseLng ?? null,
    label: settings?.homeBaseAddress ?? "",
    homeBase: null,
    placeholder: "Search your home address…",
  });
  const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem;margin:0" });
  const saveBtn = h("button", { class: "btn primary" }, "Save home base");
  saveBtn.onclick = async () => {
    errEl.textContent = "";
    const pickErr = picker.error();
    if (pickErr) {
      errEl.textContent = pickErr;
      return;
    }
    const place = picker.get();
    try {
      await api.saveSettings({
        homeBaseAddress: place?.label ?? "",
        homeBaseLat: place?.lat ?? null,
        homeBaseLng: place?.lng ?? null,
      });
      toast("Home base saved");
      await rerender();
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
    }
  };

  body.append(
    h("p", { class: "text-dim", style: "font-size:0.85rem;margin-bottom:10px" },
      "Used as the start of home → client trips and for the “Log drive home” return leg. Search a NZ address (results are cached for offline reuse) or enter coordinates."),
    h("div", { class: "field", style: "margin:0" }, h("label", {}, "Home address"), picker.el),
    h("div", { class: "row", style: "justify-content:flex-end" }, saveBtn),
    errEl,
  );
}

// Security ---------------------------------------------------------------------

function renderSecurity(body: HTMLElement): void {
  clear(body);
  body.append(h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Security & session")));

  const pinBtn = h("button", { class: "btn" }, "Change PIN");
  pinBtn.onclick = () => {
    const current = h("input", { class: "neon-input", type: "password", inputmode: "numeric", maxlength: "6", placeholder: "Current PIN" }) as HTMLInputElement;
    const next = h("input", { class: "neon-input", type: "password", inputmode: "numeric", maxlength: "6", placeholder: "New PIN (4-6 digits)" }) as HTMLInputElement;
    const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem" });
    const modal = showModal({
      title: "Change PIN",
      body: h("div", { class: "col" },
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Current PIN"), current),
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "New PIN"), next),
        errEl,
      ),
    });
    const actions = h("div", { class: "row", style: "justify-content:flex-end" });
    const cancel = h("button", { class: "btn", onclick: () => modal.close() }, "Cancel");
    const save = h("button", { class: "btn primary" }, "Update PIN");
    save.onclick = async () => {
      try {
        await api.changePin(current.value, next.value);
        modal.close();
        toast("PIN changed — you'll be asked for it again next visit");
      } catch (err) {
        errEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
      }
    };
    actions.append(cancel, save);
    const bodyEl = next.parentElement?.parentElement;
    bodyEl?.append(actions);
  };

  const logoutBtn = h("button", { class: "btn danger" }, "Log out");
  logoutBtn.onclick = async () => {
    await api.logout();
    location.reload();
  };

  const row = h("div", { class: "row", style: "justify-content:space-between" },
    h("span", { class: "text-dim", style: "font-size:0.85rem" }, "Sessions time out after 15 minutes idle."),
    h("div", { class: "row" }, pinBtn, logoutBtn),
  );
  body.append(row);
}

// Export ----------------------------------------------------------------------

function renderExport(body: HTMLElement): void {
  clear(body);
  body.append(h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Data export")));
  const fy = fyBounds();
  const link = (label: string, from?: string, to?: string) => {
    const a = h("a", { class: "btn outline", download: true }, `↓ ${label}`);
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    a.setAttribute("href", `/api/export/logbook.csv?${q}`);
    return a;
  };
  body.append(
    h("p", { class: "text-dim", style: "font-size:0.85rem;margin-bottom:10px" },
      "Full logbook as CSV — date, client, vehicle, readings, km, rate and amount. Keep these records for your tax files."),
    h("div", { class: "row" },
      link("Current FY", fy.from, fy.to),
      link("All time"),
    ),
  );
}

// Page -------------------------------------------------------------------------

export async function renderSettings(root: HTMLElement): Promise<void> {
  await refresh();
  clear(root);

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("h1", {}, "Settings"),
      h("p", { class: "sub" }, "Vehicles, calendar, security and export."),
    ),
  );
  root.append(head);

  const cal = h("div", { class: "card" });
  const home = h("div", { class: "card" });
  const veh = h("div", { class: "card" });
  const sec = h("div", { class: "card" });
  const exp = h("div", { class: "card" });
  root.append(cal, home, veh, sec, exp);

  renderCalendar(cal);
  renderHomeBase(home);
  renderVehicles(veh);
  renderSecurity(sec);
  renderExport(exp);
}

async function rerender(): Promise<void> {
  const main = document.querySelector("main");
  if (main) await renderSettings(main as HTMLElement);
}
