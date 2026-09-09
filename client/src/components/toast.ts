import { h } from "../dom.ts";

export function toast(message: string, kind: "ok" | "err" = "ok"): void {
  const el = h(
    "div",
    {
      class: "toast",
      style: kind === "err" ? "border-color:rgba(239,68,68,0.55);color:#fca5a5" : "border-color:var(--line)",
    },
    message,
  );
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
}
