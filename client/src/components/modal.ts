import { clear, h } from "../dom.ts";

export interface ModalHandle {
  close: () => void;
}

export function showModal(opts: {
  title: string;
  body: HTMLElement;
  wide?: boolean;
  onClose?: () => void;
}): ModalHandle {
  const backdrop = h("div", { class: "modal-overlay" });
  const panel = h("div", { class: opts.wide ? "modal-panel wide" : "modal-panel" });
  const head = h(
    "div",
    { class: "modal-head" },
    h("h2", {}, opts.title),
    h("button", { class: "icon-btn", onclick: close, title: "Close", "aria-label": "Close" }, "✕"),
  );
  const body = h("div", { class: "modal-body" });
  body.append(opts.body);
  panel.append(head, body);
  backdrop.append(panel);

  function close(): void {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    opts.onClose?.();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  return { close };
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const body = h("div", { class: "col" });
    body.append(h("p", { style: "white-space:pre-wrap;color:var(--fg-dim);font-size:0.92rem" }, opts.message));
    // The action button must settle the promise BEFORE closing the modal:
    // modal.close() fires onClose, which resolves false - order matters here.
    const modal = showModal({ title: opts.title, body, onClose: () => resolve(false) });
    const row = h("div", { class: "row", style: "justify-content:flex-end;margin-top:6px" });
    const no = h("button", { class: "btn", onclick: () => modal.close() }, opts.cancelLabel ?? "Cancel");
    const yes = h(
      "button",
      {
        class: opts.danger ? "btn danger" : "btn primary",
        onclick: () => {
          resolve(true);
          modal.close();
        },
      },
      opts.confirmLabel ?? "Confirm",
    );
    row.append(no, yes);
    body.append(row);
  });
}
