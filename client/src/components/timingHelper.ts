import { h } from "../dom.ts";
import { shiftIsoMinutes } from "../../../shared/time.ts";

const LAST_TRAVEL_KEY = "jt:lastTravelMinutes";
const LAST_DISTANCE_KEY = "jt:lastDistanceKm";
const CUSTOM = "custom";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function lastTravelMinutes(): number | null {
  const raw = localStorage.getItem(LAST_TRAVEL_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 5-minute travel-time picker with a custom minutes fallback. */
export function travelTimeSelect(initial: number | null): { el: HTMLElement; value(): number | null } {
  const select = h("select", { class: "neon-input" }) as HTMLSelectElement;
  select.append(h("option", { value: "" }, "— none —") as HTMLOptionElement);
  for (let m = 5; m <= 180; m += 5) {
    const opt = h("option", { value: String(m) }, `${m} min`) as HTMLOptionElement;
    select.append(opt);
  }
  select.append(h("option", { value: CUSTOM }, "Custom…") as HTMLOptionElement);

  const custom = h("input", {
    class: "neon-input",
    type: "number",
    min: "1",
    max: "600",
    step: "1",
    placeholder: "Minutes",
    style: "display:none",
  }) as HTMLInputElement;

  if (initial != null) {
    if (initial % 5 === 0 && initial >= 5 && initial <= 180) {
      select.value = String(initial);
    } else {
      select.value = CUSTOM;
      custom.value = String(initial);
      custom.style.display = "block";
    }
  }

  function sync(): void {
    const isCustom = select.value === CUSTOM;
    custom.style.display = isCustom ? "block" : "none";
    const value = readValue();
    if (value != null) localStorage.setItem(LAST_TRAVEL_KEY, String(value));
  }

  function readValue(): number | null {
    if (select.value === "") return null;
    if (select.value === CUSTOM) {
      const n = Math.round(Number(custom.value));
      return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : null;
    }
    return Number(select.value);
  }

  select.onchange = sync;
  custom.oninput = () => {
    const value = readValue();
    if (value != null) localStorage.setItem(LAST_TRAVEL_KEY, String(value));
  };

  const el = h("div", { class: "col", style: "gap:4px" }, select, custom);
  return { el, value: readValue };
}

export function lastDistanceKm(): number | null {
  const raw = localStorage.getItem(LAST_DISTANCE_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 5-km distance picker with a custom km fallback (mirrors the travel-time picker). */
export function distanceSelect(initial: number | null): { el: HTMLElement; value(): number | null } {
  const select = h("select", { class: "neon-input" }) as HTMLSelectElement;
  select.append(h("option", { value: "" }, "— none —") as HTMLOptionElement);
  for (let km = 5; km <= 300; km += 5) {
    const opt = h("option", { value: String(km) }, `${km} km`) as HTMLOptionElement;
    select.append(opt);
  }
  select.append(h("option", { value: CUSTOM }, "Custom…") as HTMLOptionElement);

  const custom = h("input", {
    class: "neon-input",
    type: "number",
    min: "1",
    max: "2000",
    step: "1",
    placeholder: "Kilometres",
    style: "display:none",
  }) as HTMLInputElement;

  if (initial != null) {
    if (initial % 5 === 0 && initial >= 5 && initial <= 300) {
      select.value = String(initial);
    } else {
      select.value = CUSTOM;
      custom.value = String(initial);
      custom.style.display = "block";
    }
  }

  function sync(): void {
    const isCustom = select.value === CUSTOM;
    custom.style.display = isCustom ? "block" : "none";
    const value = readValue();
    if (value != null) localStorage.setItem(LAST_DISTANCE_KEY, String(value));
  }

  function readValue(): number | null {
    if (select.value === "") return null;
    if (select.value === CUSTOM) {
      const n = Math.round(Number(custom.value));
      return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : null;
    }
    return Number(select.value);
  }

  select.onchange = sync;
  custom.oninput = () => {
    const value = readValue();
    if (value != null) localStorage.setItem(LAST_DISTANCE_KEY, String(value));
  };

  const el = h("div", { class: "col", style: "gap:4px" }, select, custom);
  return { el, value: readValue };
}

/**
 * Arrival + travel-time helper for manual trips. For a start log the saved
 * timestamp is the departure (arrival − travel); for an end log it is the
 * arrival itself. In "apply" mode the caller writes the result into its own
 * fields; in "value" mode the result is used directly on save.
 */
export function timingHelper(opts: {
  role: "start" | "end";
  arrivalIso: string;
  /** null = no travel time; undefined = reuse the last picked duration. */
  durationMinutes?: number | null;
}): { el: HTMLElement; iso(): string; setArrival(iso: string): void; prefillArrival(iso: string): void } {
  let touched = false;
  const arrival = h("input", { class: "neon-input", type: "datetime-local", value: toLocalInput(opts.arrivalIso) }) as HTMLInputElement;

  const travel = opts.role === "start" ? travelTimeSelect(opts.durationMinutes === undefined ? lastTravelMinutes() : opts.durationMinutes) : null;
  const result = h("p", { class: "text-dim", style: "font-size:0.8rem;margin:0" });

  function currentIso(): string {
    const iso = fromLocalInput(arrival.value) ?? new Date().toISOString();
    if (opts.role !== "start" || !travel) return iso;
    const mins = travel.value();
    return mins == null ? iso : shiftIsoMinutes(iso, -mins);
  }

  function refresh(): void {
    const iso = currentIso();
    const time = new Date(iso).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
    if (opts.role === "start") {
      result.textContent = travel?.value() == null ? "No travel time set — this becomes the start time" : `Leave at ${time}`;
    } else {
      result.textContent = `Arrival at ${time}`;
    }
  }

  arrival.oninput = () => {
    touched = true;
    refresh();
  };
  if (travel) {
    travel.el.addEventListener("input", refresh);
    travel.el.addEventListener("change", refresh);
  }

  const el = h("div", { class: "col", style: "gap:6px" },
    h("div", { class: "field", style: "margin:0" },
      h("label", {}, opts.role === "start" ? "Arrival at destination" : "Arrival / log time"),
      arrival,
    ),
    travel ? h("div", { class: "field", style: "margin:0" }, h("label", {}, "Travel time from home base"), travel.el) : null,
    result,
  );

  refresh();

  return {
    el,
    iso: currentIso,
    setArrival(iso: string): void {
      arrival.value = toLocalInput(iso);
      refresh();
    },
    prefillArrival(iso: string): void {
      if (touched) return;
      arrival.value = toLocalInput(iso);
      refresh();
    },
  };
}
