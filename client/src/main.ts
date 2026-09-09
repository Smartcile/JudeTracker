import "./styles/theme.css";
import { api } from "./api.ts";
import { renderPinPad } from "./components/pinpad.ts";
import { clear, el, h } from "./dom.ts";
import { renderAuthPage } from "./pages/auth.ts";
import { renderCalendarPage } from "./pages/calendar.ts";
import { renderDashboard } from "./pages/dashboard.ts";
import { renderFaq } from "./pages/faq.ts";
import { renderReview } from "./pages/review.ts";
import { renderSettings } from "./pages/settings.ts";

const IDLE_LOCK_MS = 15 * 60 * 1000;

type View = "dashboard" | "review" | "settings" | "calendar" | "faq";

let appRoot: HTMLElement;
let lastActivity = Date.now();
let lockVisible = false;

const pageViews: Record<View, (root: HTMLElement) => void | Promise<void>> = {
  dashboard: renderDashboard,
  review: renderReview,
  settings: renderSettings,
  calendar: renderCalendarPage,
  faq: renderFaq,
};

function currentHash(): View {
  const hash = location.hash.replace(/^#\/?/, "");
  return (["dashboard", "review", "settings", "calendar", "faq"] as const).find((v) => v === hash) ?? "dashboard";
}

function navLink(view: View, label: string): HTMLElement {
  const link = h("button", { class: "nav-link", onclick: () => navigate(view) }, label);
  if (currentHash() === view) link.classList.add("active");
  return link;
}

function renderShell(): void {
  clear(appRoot);
  const top = h(
    "header",
    { class: "topnav" },
    h("span", { class: "brand" }, h("span", { class: "mark" }, "J"), "JudeTracker"),
    navLink("dashboard", "Log"),
    navLink("review", "Review"),
    navLink("calendar", "Calendar"),
    navLink("settings", "Settings"),
    navLink("faq", "FAQ"),
  );
  const page = h("main");
  const bottom = h(
    "nav",
    { class: "bottomnav" },
    navLink("dashboard", "Log"),
    navLink("review", "Review"),
    navLink("calendar", "Calendar"),
    navLink("settings", "Settings"),
    navLink("faq", "FAQ"),
  );
  appRoot.append(top, page, bottom);
  void pageViews[currentHash()](page);
}

export function navigate(view: View): void {
  location.hash = `#/${view}`;
}

function showLock(): void {
  if (lockVisible) return;
  lockVisible = true;
  const overlay = document.createElement("div");
  overlay.className = "lock-overlay";
  const pinBox = document.createElement("div");
  overlay.append(pinBox);
  document.body.append(overlay);
  api.logout().catch(() => undefined);
  renderPinPad(pinBox, {
    title: "LOCKED",
    subtitle: "Auto-locked after inactivity",
    onDone: async (pin) => {
      await api.login(pin);
      overlay.remove();
      lockVisible = false;
      lastActivity = Date.now();
      renderShell();
    },
  });
}

function startIdleWatchdog(): void {
  for (const ev of ["pointerdown", "keydown", "pointermove", "touchstart"]) {
    window.addEventListener(ev, () => {
      lastActivity = Date.now();
    }, { passive: true });
  }
  setInterval(() => {
    if (lockVisible) return;
    if (Date.now() - lastActivity > IDLE_LOCK_MS) showLock();
  }, 15_000);
}

async function boot(): Promise<void> {
  appRoot = el("app") as HTMLElement;
  startIdleWatchdog();
  window.addEventListener("jt:session-expired", () => {
    lockVisible = false;
    document.querySelector(".lock-overlay")?.remove();
    location.reload();
  });

  const state = await api.authState();
  if (!state.authed) {
    renderAuthPage(appRoot, state.needsSetup);
    return;
  }
  renderShell();
  window.addEventListener("hashchange", () => renderShell());
}

boot().catch((err) => {
  const root = el("app") as HTMLElement;
  clear(root);
  root.append(h("p", { class: "text-danger mono" }, `Failed to start: ${err instanceof Error ? err.message : err}`));
});
