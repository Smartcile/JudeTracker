export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: Array<Node | string | number | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = String(value);
      else if (key === "dataset" && typeof value === "object") {
        Object.assign(node.dataset, value);
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2), value as EventListener);
      } else if (key === "value" || key === "checked") {
        (node as HTMLInputElement)[key as "value"] = value as never;
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === "number" ? String(child) : child);
  }
  return node;
}

export function btn(
  label: string,
  onClick?: () => void,
  attrs: Record<string, unknown> = {},
): HTMLButtonElement {
  return h("button", { class: "neon-btn", ...attrs, onclick: onClick }, label) as HTMLButtonElement;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function el<K extends keyof HTMLElementTagNameMap>(id: string): HTMLElementTagNameMap[K] | null {
  return document.getElementById(id) as HTMLElementTagNameMap[K] | null;
}

export function on<K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  type: K,
  fn: (ev: HTMLElementEventMap[K]) => void,
): void {
  node.addEventListener(type, fn);
}
