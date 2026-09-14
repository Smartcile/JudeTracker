import { api } from "../api.ts";
import { h } from "../dom.ts";
import type { GeocodeResultDto, SettingsDto } from "../../../shared/types.ts";

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
  const latI = h("input", { class: "neon-input", type: "number", step: "any", min: "-90", max: "90", placeholder: "Latitude" }) as HTMLInputElement;
  const lngI = h("input", { class: "neon-input", type: "number", step: "any", min: "-180", max: "180", placeholder: "Longitude" }) as HTMLInputElement;
  const manualBox = h("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:6px;display:none" }, latI, lngI);
  const manualBtn = h("button", { class: "btn sm ghost", style: "align-self:flex-start;font-size:0.72rem;padding:3px 8px" }, "⌨ Enter coordinates instead");

  function renderPicked(): void {
    while (picked.firstChild) picked.removeChild(picked.firstChild);
    if (!current) {
      picked.append(h("span", { class: "text-faint" }, "No location pinned"));
      return;
    }
    const text = current.label ? `${current.label} (${fmtCoords(current.lat, current.lng)})` : fmtCoords(current.lat, current.lng);
    const clear = h("button", { class: "icon-btn danger", title: "Clear location", "aria-label": "Clear location", style: "padding:2px 7px" }, "✕");
    clear.onclick = () => {
      current = null;
      touchedFlag = true;
      latI.value = "";
      lngI.value = "";
      renderPicked();
    };
    picked.append(
      h("span", { style: "color:var(--sky);font-weight:700;flex:none" }, "📍"),
      h("span", { style: "flex:1;min-width:0;word-break:break-word" }, text),
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

  function renderHomeRow(): void {
    const hb = home;
    if (!hb) return;
    results.append(
      resultRow(
        `🏠 Home base${hb.homeBaseAddress ? ` — ${hb.homeBaseAddress}` : ""}`,
        fmtCoords(hb.homeBaseLat!, hb.homeBaseLng!),
        () => {
          setPlace({ lat: hb.homeBaseLat!, lng: hb.homeBaseLng!, label: hb.homeBaseAddress || "Home base" });
          search.value = "";
          hideResults();
        },
      ),
    );
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
      renderHomeRow();
      if (found.length === 0) {
        results.append(h("div", { class: "text-dim", style: "padding:8px;font-size:0.8rem" }, "No NZ addresses matched."));
      } else {
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
    const query = search.value.trim();
    if (!query && home) {
      while (results.firstChild) results.removeChild(results.firstChild);
      renderHomeRow();
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
