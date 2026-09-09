import { clear, h } from "../dom.ts";

export interface PinPadOptions {
  title: string;
  subtitle?: string;
  error?: string;
  onDone: (pin: string) => Promise<void> | void;
}

/** Numeric PIN pad. Collects 4-6 digits, calls onDone from the OK key. */
export function renderPinPad(container: HTMLElement, opts: PinPadOptions): void {
  clear(container);
  let pin = "";
  let busy = false;

  const wrap = h("div", { style: "max-width:360px;margin:0 auto" });
  const heading = h("h1", { style: "text-align:center" }, opts.title);
  const subtitle = opts.subtitle ? h("p", { class: "text-dim", style: "text-align:center;font-size:0.9rem;margin-top:6px" }, opts.subtitle) : null;
  const errEl = h("p", { style: "min-height:1.2em;text-align:center;color:var(--danger);font-size:0.85rem;font-family:var(--font-mono)" }, opts.error ?? "");
  const dots = h("div", { class: "pin-dots" });

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const grid = h("div", { class: "pin-grid" });
  for (const k of keys) {
    const b = h("button", { class: "btn", onclick: () => press(k), tabindex: "-1" }, k);
    grid.append(b);
  }
  const backBtn = h("button", { class: "btn", style: "font-size:1rem", onclick: back, tabindex: "-1", title: "Delete" }, "⌫");
  const zero = h("button", { class: "btn", onclick: () => press("0"), tabindex: "-1" }, "0");
  const okBtn = h("button", { class: "btn primary", onclick: submit, tabindex: "-1" }, "OK");
  grid.append(zero, backBtn, okBtn);

  function paintDots(): void {
    clear(dots);
    for (let i = 0; i < 6; i++) {
      dots.append(h("span", { class: i < pin.length ? "pin-dot filled" : "pin-dot" }));
    }
  }

  function press(digit: string): void {
    if (pin.length >= 6) return;
    pin += digit;
    paintDots();
  }

  function back(): void {
    pin = pin.slice(0, -1);
    paintDots();
  }

  async function submit(): Promise<void> {
    if (busy || pin.length < 4) return;
    busy = true;
    errEl.textContent = "";
    try {
      await opts.onDone(pin);
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      pin = "";
      paintDots();
    } finally {
      busy = false;
    }
  }

  paintDots();
  const kids: Array<Node | null> = [heading, subtitle, dots, errEl, grid];
  for (const kid of kids) {
    if (kid != null) wrap.append(kid);
  }
  container.append(h("div", { style: "padding-top:6vh" }, wrap));
}
