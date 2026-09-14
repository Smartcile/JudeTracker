import { api } from "../api.ts";
import { showModal } from "../components/modal.ts";
import { toast } from "../components/toast.ts";
import { openTripModal } from "../components/tripModal.ts";
import { clear, h } from "../dom.ts";
import type { CalEventDto, JobDto } from "../../../shared/types.ts";

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function localDayOf(date: Date): string {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function fmtDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export async function renderCalendarPage(root: HTMLElement): Promise<void> {
  clear(root);
  const now = new Date();
  let view = { year: now.getFullYear(), month: now.getMonth() }; // month 0-11

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("h1", {}, "Calendar"),
      h("p", { class: "sub" }, "Client bookings from your iCloud calendar — click an event to open its trip."),
    ),
  );
  root.append(head);

  const monthLabel = h("h2", { style: "flex:1" });
  const prevBtn = h("button", { class: "btn", title: "Previous month" }, "‹");
  const nextBtn = h("button", { class: "btn", title: "Next month" }, "›");
  const todayBtn = h("button", { class: "btn outline" }, "Today");
  const newTripBtn = h("button", { class: "btn primary" }, "＋ New trip (manual)");
  const syncBtn = h("button", { class: "btn", title: "Sync calendar" }, "↻ Sync");

  const legend = h("div", { class: "row", style: "gap:12px;font-size:0.75rem;color:var(--fg-dim)" },
    h("span", {}, h("span", { class: "dot teal", style: "margin-right:5px" }), "trip exists"),
    h("span", {}, h("span", { class: "dot", style: "background:var(--line);margin-right:5px" }), "no trip yet"),
  );

  const toolbar = h("div", { class: "row", style: "margin:12px 0 10px;gap:6px;flex-wrap:wrap" },
    prevBtn, nextBtn, todayBtn, monthLabel, legend, h("div", { style: "flex:1" }), newTripBtn, syncBtn,
  );
  root.append(toolbar);

  const grid = h("div", {
    class: "grid cal-grid",
    style:
      "grid-template-columns:repeat(7,1fr);gap:1px;background:var(--line-dim);border:1px solid var(--line-dim);border-radius:var(--r-md);overflow:hidden",
  });
  root.append(grid);

  function dayRange(): { from: Date; to: Date } {
    const from = new Date(view.year, view.month, 1, 0, 0, 0, 0);
    const to = new Date(view.year, view.month + 1, 1, 0, 0, 0, 0);
    from.setDate(from.getDate() - 14);
    to.setDate(to.getDate() + 14);
    return { from, to };
  }

  async function render(): Promise<void> {
    clear(grid);
    monthLabel.textContent = new Date(view.year, view.month, 1).toLocaleString("en-NZ", { month: "long", year: "numeric" });

    const { from, to } = dayRange();
    let events: CalEventDto[];
    let jobs: JobDto[];
    try {
      [events, jobs] = await Promise.all([
        api.calendarEvents(from.toISOString(), to.toISOString()),
        api.jobs(),
      ]);
    } catch (err) {
      grid.append(h("div", { class: "empty", style: "grid-column:1/-1;margin:8px" },
        h("div", { class: "empty-title" }, "Could not load calendar"),
        h("p", {}, err instanceof Error ? err.message : "Unknown error"),
      ));
      return;
    }

    const jobByEvent = new Map<string, JobDto>();
    for (const j of jobs) if (j.eventUid) jobByEvent.set(j.eventUid, j);

    const eventsByDay = new Map<string, CalEventDto[]>();
    for (const e of events) {
      const day = fmtDay(e.startAt) || localDayOf(new Date());
      const list = eventsByDay.get(day) ?? [];
      list.push(e);
      eventsByDay.set(day, list);
    }

    for (const wd of WEEKDAYS) {
      grid.append(h("div", { style: "background:var(--bg-raised);color:var(--fg-faint);font-size:0.68rem;font-weight:700;text-align:center;padding:6px 2px;letter-spacing:0.08em" }, wd));
    }

    // Monday-first offset
    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(view.year, view.month, 1 - offset);
    const todayStr = localDayOf(new Date());

    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = localDayOf(day);
      const inMonth = day.getMonth() === view.month;
      const dayEvents = (eventsByDay.get(key) ?? []).slice().sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1));

      const cell = h("div", { class: `cal-cell${inMonth ? "" : " out"}${dayEvents.length ? " has-events" : ""}` });
      const num = h("span", {
        style:
          key === todayStr
            ? "font-size:0.72rem;color:#04211c;background:var(--accent);border-radius:999px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-weight:700"
            : `font-size:0.72rem;${inMonth ? "color:var(--fg)" : "color:var(--fg-faint)"}`,
      }, String(day.getDate()));
      cell.append(h("div", { style: "display:flex;justify-content:flex-end" }, num));

      const visible = dayEvents.slice(0, 3);
      for (const e of visible) {
        const job = jobByEvent.get(e.uid);
        const chip = h("button", {
          class: "btn sm cal-chip",
          style: `justify-content:flex-start;width:100%;padding:2px 6px;font-size:0.66rem;font-weight:600;border-radius:var(--r-xs);${job ? "background:var(--accent-soft);border-color:rgba(20,184,166,0.4);color:var(--accent)" : "border-color:var(--line);color:var(--fg-dim)"}`,
        }, e.summary || "Event");
        chip.onclick = (ev: Event) => {
          ev.stopPropagation();
          openEventModal(e, jobByEvent.get(e.uid) ?? null);
        };
        cell.append(chip);
      }
      if (dayEvents.length > 3) {
        const more = h("span", { style: "font-size:0.66rem;color:var(--fg-faint);text-align:center;cursor:pointer" }, `+${dayEvents.length - 3} more`);
        more.onclick = (ev: Event) => {
          ev.stopPropagation();
          openDayModal(key, dayEvents, jobByEvent);
        };
        cell.append(more);
      }

      cell.onclick = () => {
        if (dayEvents.length > 0) openDayModal(key, dayEvents, jobByEvent);
      };
      grid.append(cell);
    }
  }

  function openEventModal(e: CalEventDto, job: JobDto | null | undefined): void {
    const linkedJob = job ?? null;
    const time = e.allDay ? "All day" : e.startAt ? new Date(e.startAt).toLocaleString("en-NZ") : "—";
    const body = h("div", { class: "col" },
      h("p", { style: "font-weight:600" }, e.summary || "Event"),
      h("p", { class: "text-dim", style: "font-size:0.88rem" }, [time, e.location].filter(Boolean).join(" • ")),
      linkedJob
        ? h("div", { class: "row", style: "gap:6px" },
          h("span", { class: "chip ready" }, "Trip exists"),
          h("button", { class: "btn sm primary", onclick: () => { modal.close(); openTripModal(linkedJob, () => rerender()); } }, "Open trip"),
        )
        : h("div", { class: "col", style: "gap:6px" },
          h("p", { class: "text-dim", style: "font-size:0.85rem" }, "No trip for this event yet."),
          h("div", { class: "row", style: "gap:6px" },
            h("button", { class: "btn sm primary", onclick: createFromEvent }, "Create trip from this event"),
            h("button", { class: "btn sm", onclick: () => void openManualTrip() }, "Manual trip instead"),
          ),
        ),
    );

    async function createFromEvent(): Promise<void> {
      try {
        const job = await api.createJob({ eventUid: e.uid });
        modal.close();
        toast("Trip created from calendar event");
        await rerender();
        openTripModal(job, () => rerender());
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "err");
      }
    }

    const modal = showModal({ title: "Calendar event", body });
  }

  /** Manual trip entry: create a bare job, then open the details popup to fill it in. */
  async function openManualTrip(eventUid?: string): Promise<void> {
    const client = h("input", { class: "neon-input", placeholder: "Client / purpose (optional for now)" }) as HTMLInputElement;
    const date = h("input", { class: "neon-input", type: "date", value: localDayOf(new Date()) }) as HTMLInputElement;
    const loc = h("input", { class: "neon-input", placeholder: "Location (optional)" }) as HTMLInputElement;
    const notes = h("textarea", { class: "neon-input", rows: 2, style: "resize:vertical;min-height:52px", placeholder: "Notes (optional)" }) as HTMLTextAreaElement;
    const business = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
    const errEl = h("p", { class: "text-danger", style: "min-height:1em;font-size:0.85rem" });

    const kindRow = h("label", { class: "check-row" }, business, "Claimable (business) — untick for a personal trip");
    const save = h("button", { class: "btn primary" }, "Create trip");
    const cancel = h("button", { class: "btn", onclick: () => modal.close() }, "Cancel");

    const modal = showModal({
      title: eventUid ? "New trip from event" : "New trip (manual)",
      body: h("div", { class: "col" },
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Client / purpose"), client),
        h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px" },
          h("div", { class: "field", style: "margin:0" }, h("label", {}, "Date"), date),
          h("div", { class: "field", style: "margin:0" }, h("label", {}, "Location"), loc),
        ),
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Notes"), notes),
        kindRow,
        errEl,
        h("div", { class: "row", style: "justify-content:flex-end" }, cancel, save),
      ),
    });

    save.onclick = async () => {
      try {
        const name = client.value.trim();
        const job = await api.createJob({
          client: name || undefined,
          location: loc.value.trim() || undefined,
          jobDate: date.value || undefined,
          kind: business.checked ? "business" : "personal",
          notes: notes.value.trim() || undefined,
          ...(eventUid ? { eventUid } : {}),
        });
        modal.close();
        toast("Trip created — add photos and readings from the details popup");
        await rerender();
        openTripModal(job, () => rerender());
      } catch (err) {
        errEl.textContent = err instanceof Error ? err.message : String(err);
      }
    };
  }
  newTripBtn.onclick = () => void openManualTrip();

  function openDayModal(day: string, dayEvents: CalEventDto[], jobByEvent: Map<string, JobDto>): void {
    const list = h("div", { class: "col" });
    for (const e of [...dayEvents].sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1))) {
      const job = jobByEvent.get(e.uid);
      const row = h("button", {
        class: "btn",
        style: `justify-content:space-between;width:100%;text-align:left;${job ? "border-color:rgba(20,184,166,0.4)" : ""}`,
      },
        h("span", {}, e.summary || "Event"),
        h("span", { class: "text-dim", style: "font-size:0.72rem" }, e.location || "no address"),
      );
      row.onclick = () => {
        modal.close();
        openEventModal(e, job);
      };
      list.append(row);
    }
    const modal = showModal({ title: `${day} — ${dayEvents.length} event(s)`, body: list });
  }

  async function rerender(): Promise<void> {
    await render();
  }

  function shift(delta: number): void {
    const d = new Date(view.year, view.month + delta, 1);
    view = { year: d.getFullYear(), month: d.getMonth() };
    void render();
  }
  prevBtn.onclick = () => shift(-1);
  nextBtn.onclick = () => shift(1);
  todayBtn.onclick = () => {
    const d = new Date();
    view = { year: d.getFullYear(), month: d.getMonth() };
    void render();
  };
  syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    try {
      const r = await api.syncCalendar();
      toast(`Synced: ${r.added} new, ${r.updated} updated${r.removed ? `, ${r.removed} removed` : ""}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      syncBtn.disabled = false;
    }
    void render();
  };

  await render();
}
