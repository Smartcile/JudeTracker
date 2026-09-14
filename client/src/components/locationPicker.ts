import { api } from "../api.ts";
import { h } from "../dom.ts";
import { toast } from "./toast.ts";
import type { GeocodeResultDto, PlaceDto, SettingsDto } from "../../../shared/types.ts";

export interface PickedPlace {
  lat: number;
  lng: number;
  label: string;
}

export interface LocationPickerHandle {
  el: HTMLElement;
  /** The picked place (including live manual-coordinate input), or null when none is set. */
  get(): PickedPlace | null;
  /** Validation message when the manual coordinate inputs are half-filled or invalid. */
  error(): string | null;
  /** True once the user has picked, typed or cleared a location (initial values don't count). */
  touched(): boolean;
  /** Put a known address into the search box (e.g. the calendar event's location). */
  prefill(text: string): void;
  /** Replace the picked place (e.g. reset the editor back to the stored coordinates). */
  set(place: PickedPlace | null): void;
  /** Attach the home base once settings load (the quick-pick row appears then). */
  setHomeBase(home: Pick<SettingsDto, "homeBaseAddress" | "homeBaseLat" | "homeBaseLng"> | null): void;
}

const fmtCoords = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/**
 * NZ address search that resolves to coordinates, with a one-tap home base and
 * a typed-coordinate fallback. Results are cached server-side, so previously
 * searched addresses keep working when the internet is down.
 */
export function locationPicker(opts: {
  lat: number | null;
  lng: number | null;
  label?: string;
  homeBase: Pick<SettingsDto, "homeBaseAddress" | "homeBaseLat" | "homeBaseLng"> | null;
  placeholder?: string;
}): LocationPickerHandle {
  let current: PickedPlace | null =
    opts.lat != null && opts.lng != null ? { lat: opts.lat, lng: opts.lng, label: opts.label ?? "" } : null;
  let touchedFlag = false;

  let home = opts.homeBase && opts.homeBase.homeBaseLat != null && opts.homeBase.homeBaseLng != null ? opts.homeBase : null;
  let savedPlaces: PlaceDto[] = [];
  let placesRequested = false;

  const errEl = h("p", { class: "text-danger", style: "font-size:0.76rem;min-height:1em;margin:0" });
  const search = h("input", {
    class: "neon-input",
    placeholder: opts.placeholder ?? "Search a NZ address…",
    autocomplete: "off",
  }) as HTMLInputElement;
  const results = h("div", {
    style:
      "display:none;max-height:190px;overflow-y:auto;border:1px solid var(--line-dim);border-radius:var(--r-sm);background:var(--bg-input)",
  });
  const picked = h("div", { class: "row", style: "gap:6px;align-items:center;flex-wrap:nowrap;font-size:0.8rem" });
  const saveHolder = h("div", { class: "col", style: "gap:4px" });
  const latI = h("input", { class: "neon-input", type: "number", step: "any", min: "-90", max: "90", placeholder: "Latitude" }) as HTMLInputElement;
  const lngI = h("input", { class: "neon-input", type: "number", step: "any", min: "-180", max: "180", placeholder: "Longitude" }) as HTMLInputElement;
  const manualBox = h("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:6px;display:none" }, latI, lngI);
  const manualBtn = h("button", { class: "btn sm ghost", style: "align-self:flex-start;font-size:0.72rem;padding:3px 8px" }, "⌨ Enter coordinates instead");

  function placeIsSaved(place: PickedPlace): boolean {
    return savedPlaces.some((p) => p.lat === place.lat && p.lng === place.lng && (p.address || "") === (place.label || ""));
  }

  function closeSaveForm(): void {
    while (saveHolder.firstChild) saveHolder.removeChild(saveHolder.firstChild);
  }

  function openSaveForm(place: PickedPlace): void {
    closeSaveForm();
    const suggested = place.label ? place.label.split(",")[0]!.trim() : "";
    const nameI = h("input", { class: "neon-input", placeholder: "Name e.g. Sarah's place", value: suggested }) as HTMLInputElement;
    const errEl2 = h("p", { class: "text-danger", style: "font-size:0.76rem;min-height:1em;margin:0" });
    const save = h("button", { class: "btn sm primary" }, "Save place");
    const cancel = h("button", { class: "btn sm ghost", onclick: closeSaveForm }, "Cancel");
    save.onclick = async () => {
      const name = nameI.value.trim();
      if (!name) {
        errEl2.textContent = "Give the place a name.";
        return;
      }
      save.disabled = true;
      try {
        const created = await api.createPlace({ name, address: place.label, lat: place.lat, lng: place.lng });
        savedPlaces = [...savedPlaces, created].sort((a, b) => a.name.localeCompare(b.name));
        closeSaveForm();
        renderPicked();
        toast(`“${created.name}” saved as a place`);
      } catch (err) {
        errEl2.textContent = err instanceof Error ? err.message : String(err);
        save.disabled = false;
      }
    };
    saveHolder.append(
      h("div", { class: "col", style: "gap:6px;border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:8px;background:rgba(15,23,42,0.35)" },
        h("span", { class: "text-dim", style: "font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em" }, "Save this place"),
        nameI,
        h("div", { class: "row", style: "gap:6px" }, save, cancel),
        errEl2,
      ),
    );
    nameI.focus();
  }

  function renderPicked(): void {
    while (picked.firstChild) picked.removeChild(picked.firstChild);
    if (!current) {
      picked.append(h("span", { class: "text-faint" }, "No location pinned"));
      return;
    }
    const place = current;
    const text = place.label ? `${place.label} (${fmtCoords(place.lat, place.lng)})` : fmtCoords(place.lat, place.lng);
    const clear = h("button", { class: "icon-btn danger", title: "Clear location", "aria-label": "Clear location", style: "padding:2px 7px" }, "✕");
    clear.onclick = () => {
      current = null;
      touchedFlag = true;
      latI.value = "";
      lngI.value = "";
      closeSaveForm();
      renderPicked();
    };
    picked.append(
      h("span", { style: "color:var(--sky);font-weight:700;flex:none" }, "📍"),
      h("span", { style: "flex:1;min-width:0;word-break:break-word" }, text),
      placeIsSaved(place)
        ? h("span", { class: "text-faint", style: "font-size:0.72rem;white-space:nowrap" }, "saved")
        : h("button", {
            class: "btn sm ghost",
            title: "Save this address as a place",
            style: "white-space:nowrap;font-size:0.72rem;padding:3px 8px",
            onclick: () => openSaveForm(place),
          }, "☆ Save place"),
      clear,
    );
  }

  function setPlace(place: PickedPlace): void {
    current = place;
    touchedFlag = true;
    errEl.textContent = "";
    renderPicked();
  }

  function hideResults(): void {
    results.style.display = "none";
    while (results.firstChild) results.removeChild(results.firstChild);
  }

  function resultRow(label: string, sub: string, onPick: () => void): HTMLElement {
    const row = h("button", {
      class: "btn",
      style: "justify-content:flex-start;width:100%;border-radius:0;border-left:none;border-right:none;border-top:none;text-align:left",
    },
      h("div", { class: "col", style: "gap:1px;min-width:0" },
        h("span", { style: "font-weight:600;white-space:normal" }, label),
        h("span", { class: "text-dim", style: "font-size:0.72rem;white-space:normal" }, sub),
      ),
    );
    row.onmousedown = (e) => e.preventDefault(); // keep the input focused so onblur doesn't eat the click
    row.onclick = onPick;
    return row;
  }

  function quickPickRow(label: string, sub: string, place: PickedPlace): HTMLElement {
    return resultRow(label, sub, () => {
      setPlace(place);
      search.value = "";
      hideResults();
    });
  }

  function renderQuickPicks(filter: string): void {
    const q = filter.trim().toLowerCase();
    if (home) {
      results.append(
        quickPickRow(
          `🏠 Home base${home.homeBaseAddress ? ` — ${home.homeBaseAddress}` : ""}`,
          fmtCoords(home.homeBaseLat!, home.homeBaseLng!),
          { lat: home.homeBaseLat!, lng: home.homeBaseLng!, label: home.homeBaseAddress || "Home base" },
        ),
      );
    }
    for (const p of savedPlaces) {
      if (q && !`${p.name} ${p.address}`.toLowerCase().includes(q)) continue;
      results.append(
        quickPickRow(`⭐ ${p.name}`, `${p.address ? `${p.address} • ` : ""}${fmtCoords(p.lat, p.lng)}`, {
          lat: p.lat,
          lng: p.lng,
          label: p.address || p.name,
        }),
      );
    }
  }

  async function loadPlaces(): Promise<void> {
    if (placesRequested) return;
    placesRequested = true;
    try {
      savedPlaces = await api.places();
    } catch {
      savedPlaces = [];
    }
    if (results.style.display === "block" && search.value.trim().length < 3) {
      while (results.firstChild) results.removeChild(results.firstChild);
      renderQuickPicks("");
    }
  }

  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runSearch(query: string): Promise<void> {
    const mine = ++seq;
    errEl.textContent = "";
    while (results.firstChild) results.removeChild(results.firstChild);
    results.style.display = "block";
    results.append(h("div", { class: "text-dim", style: "padding:8px;font-size:0.8rem" }, "Searching…"));
    try {
      const { results: found } = await api.geocode(query);
      if (mine !== seq) return;
      hideResults();
      renderQuickPicks(query);
      if (found.length === 0) {
        results.append(h("div", { class: "text-dim", style: "padding:8px;font-size:0.8rem" }, "No NZ addresses matched."));
      } else {
        results.append(h("div", { class: "text-faint", style: "padding:4px 8px 2px;font-size:0.7rem" }, "Address matches"));
        for (const r of found) {
          results.append(resultRow(r.label, fmtCoords(r.lat, r.lng), () => {
            setPlace({ lat: r.lat, lng: r.lng, label: r.label });
            search.value = "";
            hideResults();
          }));
        }
      }
      results.style.display = "block";
    } catch {
      if (mine !== seq) return;
      hideResults();
      errEl.textContent = "Address lookup unavailable — check the internet, or enter coordinates instead.";
    }
  }

  search.oninput = () => {
    void loadPlaces();
    if (timer) clearTimeout(timer);
    const query = search.value.trim();
    if (query.length < 3) {
      seq++;
      hideResults();
      return;
    }
    timer = setTimeout(() => void runSearch(query), 350);
  };
  search.onfocus = () => {
    void loadPlaces();
    const query = search.value.trim();
    if (!query) {
      while (results.firstChild) results.removeChild(results.firstChild);
      renderQuickPicks("");
      results.style.display = "block";
    } else if (query.length >= 3 && results.style.display === "none") {
      void runSearch(query);
    }
  };
  search.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      search.blur();
      hideResults();
    }
  };
  search.onblur = () => {
    // Let a result click land first (iOS blurs the input before mousedown).
    setTimeout(() => {
      if (document.activeElement !== search) hideResults();
    }, 200);
  };

  manualBtn.onclick = () => {
    const open = manualBox.style.display === "none";
    manualBox.style.display = open ? "grid" : "none";
    manualBtn.textContent = open ? "⌨ Hide coordinates" : "⌨ Enter coordinates instead";
    if (open) {
      if (current) {
        latI.value = current.lat.toFixed(6);
        lngI.value = current.lng.toFixed(6);
      }
      latI.focus();
    } else {
      errEl.textContent = "";
    }
  };

  function manualValue(): { place: PickedPlace | null; error: string | null } {
    if (manualBox.style.display === "none") return { place: null, error: null };
    const latRaw = latI.value.trim();
    const lngRaw = lngI.value.trim();
    if (latRaw === "" && lngRaw === "") return { place: null, error: null };
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (latRaw === "" || lngRaw === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { place: null, error: "Enter both latitude and longitude as valid numbers." };
    }
    return { place: { lat, lng, label: "" }, error: null };
  }

  renderPicked();
  const el = h("div", { class: "col", style: "gap:6px" },
    search,
    results,
    picked,
    saveHolder,
    manualBtn,
    manualBox,
    errEl,
  );

  return {
    el,
    get(): PickedPlace | null {
      const manual = manualValue();
      return manual.place ?? current;
    },
    error(): string | null {
      return manualValue().error;
    },
    touched(): boolean {
      if (touchedFlag) return true;
      return manualBox.style.display !== "none" && (latI.value.trim() !== "" || lngI.value.trim() !== "");
    },
    prefill(text: string): void {
      if (!search.value) search.value = text;
    },
    set(place: PickedPlace | null): void {
      current = place;
      touchedFlag = false;
      latI.value = "";
      lngI.value = "";
      manualBox.style.display = "none";
      manualBtn.textContent = "⌨ Enter coordinates instead";
      errEl.textContent = "";
      renderPicked();
    },
    setHomeBase(next): void {
      home = next && next.homeBaseLat != null && next.homeBaseLng != null ? next : null;
    },
  };
}
