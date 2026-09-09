import { clear, h } from "../dom.ts";
import { CLAIM_LABELS, FAQ_CATEGORIES, FAQ_META } from "../data/faq.ts";

/** Tiny markdown-lite: **bold**, bullet lines ("* ") and numbers become paragraphs. */
function md(text: string): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const strong = (s: string) => {
    const parts = s.split(/\*\*(.+?)\*\*/g);
    const out: Array<Node | string> = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!part) continue;
      if (i % 2 === 1) {
        const b = document.createElement("strong");
        b.textContent = part;
        out.push(b);
      } else {
        out.push(part);
      }
    }
    return out;
  };
  const isBullet = (line: string) => line.trimStart().startsWith("* ") || line.trimStart().startsWith("- ");
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    if (isBullet(raw)) {
      const li = document.createElement("li");
      li.style.marginBottom = "4px";
      li.append(...strong(raw.trim().replace(/^[*\-] /, "")));
      let last = nodes[nodes.length - 1];
      if (!(last instanceof HTMLUListElement)) {
        last = h("ul", { style: "margin:4px 0 10px;padding-left:20px" });
        nodes.push(last);
      }
      last.append(li);
    } else if (/^\d+\.\s/.test(raw.trim())) {
      const p = document.createElement("p");
      p.style.margin = "4px 0";
      p.append(...strong(raw.trim().replace(/^\d+\.\s/, "")));
      nodes.push(p);
    } else {
      const p = document.createElement("p");
      p.style.margin = "6px 0";
      p.append(...strong(raw.trim()));
      nodes.push(p);
    }
  }
  return nodes;
}

function statusBadge(status: keyof typeof CLAIM_LABELS): HTMLElement {
  const meta = CLAIM_LABELS[status];
  return h("span", { class: meta.cls === "muted" ? "badge muted" : `badge ${meta.cls}` }, meta.text);
}

function faqItem(item: { question: string; summary: string; answer: string; status: keyof typeof CLAIM_LABELS; tags?: string[] }): HTMLElement {
  const summaryLine = h("summary", { class: "row spread", style: "cursor:pointer;list-style:none;gap:10px" },
    h("span", { class: "faq-caret", style: "order:2" }, "›"),
    h("span", { style: "flex:1;min-width:0;font-weight:600" }, item.question),
    statusBadge(item.status),
  );
  const details = h("details", { class: "faq-item" }, summaryLine);
  const body = h("div", { style: "padding:2px 4px 10px" });
  body.append(h("p", { class: "text-dim", style: "font-size:0.85rem;font-style:italic;margin-bottom:8px" }, item.summary));
  body.append(...md(item.answer));
  if (item.tags?.length) {
    body.append(h("div", { class: "row", style: "gap:6px;margin-top:8px" },
      ...item.tags.map((t) => h("span", { class: "badge muted" }, t))));
  }
  details.append(body);
  return details;
}

export function renderFaq(root: HTMLElement): void {
  clear(root);
  root.append(h("div", { class: "page-head" },
    h("div", {},
      h("h1", {}, FAQ_META.title),
      h("p", { class: "sub" }, `${FAQ_META.jurisdiction} — updated ${FAQ_META.lastUpdated}`),
    ),
  ));

  const note = h("div", { class: "card", style: "padding:12px 16px;margin-bottom:16px" },
    h("p", { class: "text-dim", style: "font-size:0.85rem" },
      "Practical guide for logging trips in JudeTracker. The travel-type presets on the Log page map to these scenarios — pick the closest one and JudeTracker records the purpose. Guidance only, not tax advice."));
  root.append(note);

  for (const category of FAQ_CATEGORIES) {
    const card = h("div", { class: "card" });
    card.append(
      h("div", { class: "card-head" },
        h("div", { class: "col", style: "gap:2px" },
          h("div", { class: "card-title" }, category.title),
          h("p", { class: "text-dim", style: "font-size:0.82rem" }, category.description),
        ),
      ),
    );

    if (category.scenarios) {
      const table = h("div", { class: "table-wrap", style: "margin-top:8px" });
      const tbl = h("table", { class: "tbl" });
      const head = h("thead", {}, h("tr", {},
        h("th", {}, "Route"),
        h("th", {}, "Claimable"),
        h("th", {}, "Why"),
      ));
      const body = h("tbody");
      for (const row of category.scenarios) {
        body.append(h("tr", {},
          h("td", {}, row.route),
          h("td", {}, statusBadge(row.claimable)),
          h("td", { class: "text-dim", style: "font-size:0.82rem" }, row.reason),
        ));
      }
      tbl.append(head, body);
      table.append(tbl);
      card.append(table);
    }

    for (const item of category.items) card.append(faqItem(item));
    root.append(card);
  }
}
