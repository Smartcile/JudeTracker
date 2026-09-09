import { showModal } from "./modal.ts";
import { toast } from "./toast.ts";
import { h } from "../dom.ts";

const HEIGHT = 52; // px per digit slot

export interface DialConfig {
  digits: number;
  /** Prefill: usually the previous chronological reading (or null to start at floor). */
  startKm: number | null;
  floorKm: number;
  capKm: number | null;
  prevKm: number | null;
  canEdit: boolean;
  title: string;
  photoUrl: string | null;
  onConfirm: (readingKm: number) => Promise<void>;
  onCancel?: () => void;
}

interface WheelState {
  el: HTMLElement;
  numEl: HTMLElement;
  value: number;
}

/** Replaces a wheel's digit with a quick drum-style vertical roll (shortest arc). */
function rollTo(wheel: WheelState, digit: number, animate: boolean): void {
  if (!animate || wheel.value === digit) {
    wheel.numEl.textContent = String(digit);
    wheel.value = digit;
    return;
  }
  const arc = (digit - wheel.value + 10) % 10;
  const entersFromBottom = arc <= 5;
  const ghost = document.createElement("div");
  ghost.className = "dial-num ghost";
  ghost.textContent = String(digit);
  ghost.style.transform = `translateY(${entersFromBottom ? HEIGHT : -HEIGHT}px)`;
  wheel.el.append(ghost);
  requestAnimationFrame(() => {
    ghost.style.transition = "transform 150ms ease-out, opacity 150ms ease-out";
    ghost.style.transform = "translateY(0)";
    setTimeout(() => ghost.remove(), 160);
  });
  wheel.numEl.textContent = String(digit);
  wheel.value = digit;
}

function buildWheel(digit: number, onUp: () => void, onDown: () => void): WheelState {
  const numEl = h("div", { class: "dial-num", style: "transform:none" }, String(digit));
  const up = h("button", { class: "dial-arrow", tabindex: "-1", onclick: onUp, title: "Up" }, "▲");
  const down = h("button", { class: "dial-arrow", tabindex: "-1", onclick: onDown, title: "Down" }, "▼");
  const el = h("div", { class: "dial-wheel" }, up, numEl, down);
  return { el, numEl, value: digit };
}

export function openDialModal(cfg: DialConfig): void {
  const wheels: WheelState[] = [];
  let active = -1;

  const current = (): number => Number(wheels.map((w) => w.value).join(""));
  const pad = (n: number) => String(n).padStart(cfg.digits, "0");

  function initialWheels(): number[] {
    let start = cfg.startKm ?? cfg.prevKm ?? cfg.floorKm ?? 0;
    if (start < cfg.floorKm) start = cfg.floorKm;
    if (cfg.capKm != null && start > cfg.capKm) start = cfg.capKm;
    return pad(Math.max(0, start)).split("").slice(-cfg.digits).map(Number);
  }

  const statusEl = h("p", { class: "mono", style: "margin:6px 0 0;font-size:0.8rem;text-align:center;min-height:1.1em" });
  const errEl = h("p", { class: "text-danger mono", style: "margin:2px 0 0;font-size:0.8rem;text-align:center;min-height:1.1em" });
  const valueEl = h("div", { class: "dial-value", style: "text-align:center;font-size:1.6rem;margin:4px 0" }, "0".repeat(cfg.digits));

  function refreshStatus(): void {
    const v = current();
    valueEl.textContent = pad(v);
    const prevTxt = cfg.prevKm != null ? `previous ${pad(cfg.prevKm)}` : "no previous reading";
    const delta = v - (cfg.prevKm ?? 0);
    statusEl.textContent = cfg.canEdit
      ? `${prevTxt} • increase ${delta} km`
      : "Claim already lodged - readings are locked (reopen the job to edit)";
  }

  function validity(): string | null {
    const v = current();
    if (!cfg.canEdit) return "locked";
    if (v < cfg.floorKm) return `Must be at least ${pad(cfg.floorKm)}`;
    if (cfg.capKm != null && v > cfg.capKm) return `Must not exceed job end ${pad(cfg.capKm)}`;
    return null;
  }

  function markActive(): void {
    wheels.forEach((w, i) => w.el.classList.toggle("active", i === active));
  }

  function setDigit(i: number, digit: number, animate = true): void {
    if (!cfg.canEdit) return;
    if (i < 0 || i >= wheels.length) return;
    rollTo(wheels[i]!, digit, animate);
    refreshStatus();
    errEl.textContent = validity() ?? "";
  }

  function bump(i: number, dir: 1 | -1): void {
    if (!cfg.canEdit) return;
    const w = wheels[i]!;
    const next = (w.value + dir + 10) % 10;
    setDigit(i, next);
    active = i;
    markActive();
  }

  function typeDigit(d: string): void {
    if (!/^\d$/.test(d) || !cfg.canEdit) return;
    // Readings are typed left to right: the first key goes in the leftmost
    // wheel and the caret advances one wheel to the right each time.
    const i = active >= 0 ? active : 0;
    active = i;
    setDigit(i, Number(d));
    if (i < cfg.digits - 1) {
      active = i + 1;
      markActive();
    }
  }

  function activate(i: number): void {
    if (!cfg.canEdit) return;
    active = i;
    markActive();
  }

  const row = h("div", { class: "row", style: "justify-content:center;gap:0" });
  initialWheels().forEach((digit, i) => {
    const w = buildWheel(
      digit,
      () => bump(i, 1),
      () => bump(i, -1),
    );
    wheels.push(w);
    row.append(w.el);
  });
  const firstWheel = wheels[0]!;

  const container = h("div", { class: "dial-root", tabindex: "0" }, row, valueEl, statusEl, errEl);
  container.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") modal.close();
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      bump(active >= 0 ? active : cfg.digits - 1, 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bump(active >= 0 ? active : cfg.digits - 1, -1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const i = active >= 0 ? active : cfg.digits - 1;
      activate(Math.max(0, i - 1));
    } else if (e.key === "ArrowRight" || e.key === "Tab") {
      e.preventDefault();
      const i = active >= 0 ? active : cfg.digits - 1;
      activate(Math.min(cfg.digits - 1, i + 1));
    } else if (e.key === "Backspace" || e.key === "Delete") {
      // Go back to the previously typed wheel (the one to the left).
      e.preventDefault();
      const i = active >= 0 ? active : cfg.digits - 1;
      activate(Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirmBtn.click();
    } else {
      typeDigit(e.key);
    }
  };

  const footer = h("div", { class: "row", style: "justify-content:flex-end;gap:8px" });
  const hint = h("span", { class: "text-dim", style: "font-size:0.72rem;margin-right:auto;font-family:var(--font-mono)" },
    "type digits • arrows • ⌫ back • Enter save");
  const confirmBtn = h("button", { class: "btn primary", disabled: !cfg.canEdit }, "Save reading");
  const cancelBtn = h("button", { class: "btn" }, "Cancel");
  cancelBtn.onclick = () => modal.close();
  confirmBtn.onclick = async () => {
    const v = current();
    const problem = validity();
    if (problem) {
      errEl.textContent = problem;
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Saving...";
    try {
      await cfg.onConfirm(v);
      modal.close();
      toast(`Reading ${pad(v)} saved`);
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Save reading";
    }
  };
  footer.append(hint, cancelBtn, confirmBtn);

  const photo = cfg.photoUrl ? h("img", { class: "photo", style: "max-height:240px;object-fit:contain;background:#000", src: cfg.photoUrl, alt: "" }) : null;
  const body = h("div", { class: "col", style: "gap:8px" },
    photo,
    container,
    footer,
  );

  const modal = showModal({
    title: `${cfg.title} — odometer`,
    body,
    onClose: () => cfg.onCancel?.(),
  });

  refreshStatus();
  firstWheel.el.scrollIntoView({ block: "nearest" });
  container.focus();
  // Ensure wheel cells get marked after mount
  markActive();
  if (!cfg.canEdit) errEl.textContent = validity() ?? "";
}
