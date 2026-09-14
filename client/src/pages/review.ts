import { api } from "../api.ts";
import { clear, h } from "../dom.ts";
import { formatKm, formatNzd, fyWindow } from "../../../shared/claims.ts";
import { openTripModal } from "../components/tripModal.ts";
import { useSplit } from "../components/useSplit.ts";
import type { ClaimSummaryDto, JobDto } from "../../../shared/types.ts";

const pad = (km: number | null, digits: number) => (km == null ? "······" : String(km).padStart(digits, "0"));

function fyBounds(): { from: string; to: string } {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return fyWindow(today);
}

let fromVal = "";
let toVal = "";
let initialized = false;

function rangeOk(date: string): boolean {
  if (fromVal && date < fromVal) return false;
  if (toVal && date > toVal) return false;
  return true;
}

function statusChip(status: JobDto["status"]): HTMLElement {
  return h("span", { class: `chip ${status}` }, status);
}

// Totals / KPI -------------------------------------------------------------------

async function renderKpis(box: HTMLElement): Promise<void> {
  clear(box);
  let s: ClaimSummaryDto;
  try {
    s = await api.claimSummary(fromVal || undefined, toVal || undefined);
  } catch {
    box.append(h("p", { class: "text-danger" }, "Could not load totals"));
    return;
  }
  const kpi = (label: string, value: string, sub: string, color: string) =>
    h("div", { class: "metric" },
      h("div", { class: "metric-label" }, label),
      h("div", { class: "metric-value", style: `color:${color}` }, value),
      h("div", { class: "metric-sub" }, sub),
    );

  let useValue = "—";
  let useSub = "work vs personal km";
  const useBox = h("div", { style: "margin-top:16px" });
  try {
    const jobs = (await api.jobs()).filter((j) => rangeOk(j.jobDate));
    const rows = useSplit(jobs);
    const overall = rows.find((r) => r.label === "All vehicles");
    if (overall && overall.totalKm > 0) {
      useValue = overall.pct != null ? `${overall.pct}%` : "—";
      useSub = `${formatKm(overall.workKm)} km work • ${formatKm(overall.personalKm)} km personal`;

      const panel = h("div", { class: "card", style: "padding:14px 16px" });
      const head = h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" },
        h("span", { class: "text-dim", style: "font-size:0.78rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase" }, "Business use"),
        h("span", { class: "mono", style: "font-size:1rem;color:var(--accent);font-weight:700" }, `${overall.pct}%`),
        h("span", { class: "text-dim", style: "font-size:0.82rem" }, `${formatKm(overall.workKm)} km work / ${formatKm(overall.personalKm)} km personal`),
      );
      const perVehicle = h("div", { class: "row", style: "gap:10px;margin-top:8px;flex-wrap:wrap" });
      for (const row of rows) {
        if (row.label === "All vehicles") continue;
        perVehicle.append(h("span", { class: "badge", style: "font-weight:400;letter-spacing:0.02em;font-family:var(--font-ui);padding:4px 10px" },
          `${row.label}: ${row.pct != null ? `${row.pct}%` : "—"} business (${formatKm(row.workKm)}/${formatKm(row.personalKm)} km)`));
      }
      panel.append(head, perVehicle);
      panel.append(h("p", { class: "text-faint", style: "font-size:0.75rem;margin-top:8px" },
        "Personal-use baseline: odometer distance between consecutive trip photos that no job covers, plus trips logged as personal. Recalculated whenever a log or reading changes. For the IRD actual-costs method a 90-day logbook keeps its % for up to 3 years."));
      useBox.append(panel);
    }
  } catch {
    /* totals still shown above */
  }

  const grid = h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(180px,1fr))" },
    kpi("Total distance", formatKm(s.totals.km), "kilometres in range", "var(--fg)"),
    kpi("Total claim value", formatNzd(s.totals.amountCents), `${s.totals.count} trips`, "var(--accent)"),
    kpi("Average / trip", s.totals.count > 0 ? formatNzd(Math.round(s.totals.amountCents / s.totals.count)) : formatNzd(0), "value per trip", "var(--sky)"),
    kpi("Business use", useValue, useSub, "var(--accent)"),
  );
  box.append(grid, useBox);
}

// Trip table --------------------------------------------------------------------

function tripRow(job: JobDto, onOpen: (job: JobDto) => void): HTMLElement {
  const tr = h("tr", {
    class: "row-click",
    title: "Click to view & edit trip",
    style: "cursor:pointer",
    onclick: () => onOpen(job),
  });
  if (job.tripKind === "personal") tr.classList.add("tbl-row-personal");
  else if (job.status === "open" || job.status === "ready") tr.classList.add("tbl-row-open");

  const clientCell = h("td");
  clientCell.append(h("div", {}, job.client));
  if (job.location) clientCell.append(h("div", { class: "text-dim", style: "font-size:0.75rem" }, job.location));

  const readings = h("td", { class: "mono", style: "font-size:0.8rem;color:var(--fg-dim)" },
    job.returnLog
      ? `${pad(job.startLog?.readingKm ?? null, 6)} → ${pad(job.endLog?.readingKm ?? null, 6)} → ${pad(job.returnLog.readingKm, 6)}`
      : `${pad(job.startLog?.readingKm ?? null, 6)} → ${pad(job.endLog?.readingKm ?? null, 6)}`);

  const details = h("button", {
    class: "btn sm ghost",
    title: "View & edit trip",
    style: "white-space:nowrap",
  }, "Details");
  details.onclick = (e: Event) => {
    e.stopPropagation();
    onOpen(job);
  };

  tr.append(
    h("td", { style: "white-space:nowrap" }, job.jobDate),
    clientCell,
    h("td", {}, job.vehiclePlate ? h("span", { class: "badge" }, job.vehiclePlate) : h("span", { class: "text-dim" }, "—")),
    readings,
    h("td", { class: "num" }, job.km != null ? formatKm(job.km) : "—"),
    h("td", { class: "num" }, job.effectiveRateCents != null ? (job.effectiveRateCents / 100).toFixed(2) : "—"),
    h("td", { class: "num", style: job.tripKind === "personal" ? "" : "color:var(--accent);font-weight:600" },
      job.amountCents != null ? formatNzd(job.amountCents) : "—"),
    h("td", {}, job.tripKind === "personal" ? h("span", { class: "chip personal" }, "Personal") : statusChip(job.status)),
    h("td", {}, details),
  );
  return tr;
}

// Page --------------------------------------------------------------------------

export async function renderReview(root: HTMLElement): Promise<void> {
  clear(root);

  if (!initialized) {
    const fy = fyBounds();
    fromVal = fy.from;
    toVal = fy.to;
    initialized = true;
  }

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("h1", {}, "Review logs"),
      h("p", { class: "sub" }, "Click any trip to view and edit it — photos, readings, details and claims."),
    ),
  );
  root.append(head);

  const fromInput = h("input", { class: "neon-input date-input", type: "date", value: fromVal, style: "width:auto" }) as HTMLInputElement;
  const toInput = h("input", { class: "neon-input date-input", type: "date", value: toVal, style: "width:auto" }) as HTMLInputElement;
  const exportBtn = h("button", { class: "btn outline" }, "↓ Export CSV");
  const exportLink = document.createElement("a");

  function buildExportHref(): void {
    const q = new URLSearchParams();
    if (fromVal) q.set("from", fromVal);
    if (toVal) q.set("to", toVal);
    exportLink.href = `/api/export/logbook.csv?${q}`;
  }

  function applyPeriod(): void {
    fromVal = fromInput.value;
    toVal = toInput.value;
    buildExportHref();
    void renderKpis(kpisBox);
    void renderTable(tbody);
  }

  const quick = (label: string, from: string, to: string) => {
    const b = h("button", { class: "btn ghost sm" }, label);
    b.onclick = () => {
      fromInput.value = from;
      toInput.value = to;
      applyPeriod();
    };
    return b;
  };

  const fy = fyBounds();
  const now = new Date();
  const monthFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const toolbar = h("div", { class: "card", style: "padding:12px 14px;margin-bottom:16px" },
    h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" },
      h("span", { class: "text-dim", style: "font-size:0.8rem;font-weight:600" }, "Period"),
      fromInput,
      h("span", { class: "text-dim" }, "→"),
      toInput,
      quick("This FY", fy.from, fy.to),
      quick("This month", monthFrom, ""),
      quick("All time", "", ""),
      h("div", { style: "flex:1" }),
      exportBtn,
    ),
  );
  exportBtn.onclick = () => {
    buildExportHref();
    exportLink.download = "logbook.csv";
    exportLink.click();
  };

  const kpisBox = h("div");
  const tableHead = h("thead");
  const tbody = h("tbody");
  const tbl = h("table", { class: "tbl" }, tableHead, tbody);
  tableHead.append(h("tr", {},
    h("th", {}, "Date"),
    h("th", {}, "Client / purpose"),
    h("th", {}, "Vehicle"),
    h("th", {}, "Readings"),
    h("th", { class: "num" }, "Km"),
    h("th", { class: "num" }, "Rate"),
    h("th", { class: "num" }, "Total"),
    h("th", {}, "Status"),
    h("th", { style: "width:90px" }, ""),
  ));
  const tableBox = h("div", { class: "table-wrap" }, tbl);

  async function renderTable(body: HTMLElement): Promise<void> {
    let jobs: JobDto[];
    try {
      jobs = (await api.jobs()).filter((j) => rangeOk(j.jobDate));
    } catch (err) {
      body.append(h("tr", {}, h("td", { colspan: "9", class: "text-danger" }, err instanceof Error ? err.message : "Failed to load jobs")));
      return;
    }
    clear(body);
    if (jobs.length === 0) {
      const tr = h("tr");
      const td = h("td", { colspan: "9", style: "padding:0" });
      td.append(h("div", { class: "empty", style: "margin:14px" },
        h("div", { class: "empty-title" }, "No trips in this period"),
        h("p", {}, "Log a trip from the Log page — it will appear here once it has a start or end photo."),
      ));
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const job of jobs) body.append(tripRow(job, (j) => openTripModal(j, rerender)));
  }

  const totalsNote = h("p", { class: "text-dim", style: "font-size:0.78rem;margin-top:8px" },
    "Totals above count claimable trips with readings in the selected period; rows show all jobs incl. personal and incomplete ones.");
  root.append(toolbar, kpisBox, tableBox, totalsNote);
  await renderKpis(kpisBox);
  await renderTable(tbody);
}

async function rerender(): Promise<void> {
  const main = document.querySelector("main");
  if (main) await renderReview(main as HTMLElement);
}
