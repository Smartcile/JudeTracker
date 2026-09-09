import type {
  AuthStateDto,
  CalEventDto,
  ClaimSummaryDto,
  JobDto,
  SettingsDto,
  VehicleDto,
} from "../../shared/types.ts";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, raw = false): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new CustomEvent("jt:session-expired"));
  }
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* no json body */
    }
    throw new ApiError(res.status, message);
  }
  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const api = {
  authState: () => request<AuthStateDto>("/api/auth/state"),
  login: (pin: string) => request<{ ok: boolean }>("/api/auth/login", json("POST", { pin })),
  setup: (pin: string) => request<{ ok: boolean }>("/api/auth/setup", json("POST", { pin })),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", json("POST")),

  settings: () => request<SettingsDto>("/api/settings"),
  saveSettings: (s: Partial<SettingsDto>) =>
    request<SettingsDto>("/api/settings", json("PUT", { ...s, calendarUrl: s.calendarUrl || null })),
  changePin: (currentPin: string, newPin: string) =>
    request<{ ok: boolean }>("/api/settings/pin", json("POST", { currentPin, newPin })),

  vehicles: () => request<VehicleDto[]>("/api/vehicles"),
  createVehicle: (v: Omit<VehicleDto, "id">) => request<VehicleDto>("/api/vehicles", json("POST", v)),
  updateVehicle: (v: VehicleDto) => request<VehicleDto>(`/api/vehicles/${v.id}`, json("PUT", v)),
  deleteVehicle: (id: number) => request<{ ok: boolean }>(`/api/vehicles/${id}`, json("DELETE")),

  syncCalendar: () =>
    request<{ ok: boolean; added: number; updated: number; removed: number; total: number }>("/api/calendar/sync", json("POST")),
  upcomingEvents: (days = 14) => request<CalEventDto[]>(`/api/calendar/upcoming?days=${days}`),
  calendarEvents: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return request<CalEventDto[]>(`/api/calendar/events?${q}`);
  },
  calendarEventByUid: (uid: string) =>
    request<CalEventDto[]>(`/api/calendar/events?${new URLSearchParams({ uid })}`).then((rows) => rows[0] ?? null),

  jobs: () => request<JobDto[]>("/api/jobs"),
  createJob: (body: { eventUid?: string; client?: string; location?: string; jobDate?: string; kind?: "business" | "personal"; notes?: string }) =>
    request<JobDto>("/api/jobs", json("POST", body)),
  patchJob: (id: number, body: { client?: string; location?: string; notes?: string; eventUid?: string | null }) =>
    request<JobDto>(`/api/jobs/${id}`, json("PATCH", body)),
  claim: (id: number, status: "claimed" | "submitted" | "paid") =>
    request<JobDto>(`/api/jobs/${id}/claim`, json("POST", { status })),
  reopen: (id: number) => request<JobDto>(`/api/jobs/${id}/reopen`, json("POST")),
  deleteJob: (id: number) => request<{ ok: boolean }>(`/api/jobs/${id}`, json("DELETE")),

  /** Upload a photo log for a job. photo may be null for a manual ("Later on") log. */
  uploadLog: (jobId: number, file: File | null, fields: Record<string, string | number>) => {
    const form = new FormData();
    if (file) form.append("photo", file);
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    return request<JobDto>(`/api/jobs/${jobId}/logs`, { method: "POST", body: form });
  },
  readingInfo: (logId: number) =>
    request<{
      log: JobDto["startLog"] & { vehiclePlate: string | null };
      jobId: number | null;
      jobStatus: string | null;
      role: "start" | "end" | null;
      vehicleDigits: number | null;
      floorKm: number;
      capKm: number | null;
      prevReadingKm: number | null;
      canEdit: boolean;
    }>(`/api/logs/${logId}/reading-info`),
  setReading: (logId: number, readingKm: number) =>
    request<{ log: JobDto["startLog"]; floorKm: number; prevReadingKm: number }>(
      `/api/logs/${logId}/reading`,
      json("PUT", { readingKm }),
    ),
  /** Attach a photo to a manual log that was saved without one. */
  addLogPhoto: (logId: number, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<{ ok: boolean; log: JobDto["startLog"] }>(`/api/logs/${logId}/photo`, { method: "PUT", body: form });
  },
  deleteLog: (logId: number) => request<{ ok: boolean }>(`/api/logs/${logId}`, json("DELETE")),

  claimSummary: (from?: string, to?: string) =>
    request<ClaimSummaryDto>(
      `/api/claims/summary${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}` : ""}`,
    ),

  logbookUrl: (from?: string, to?: string) => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    return `/api/export/logbook.csv${q ? `?${q}` : ""}`;
  },

  photoUrl: (logId: number, size: "thumb" | "full" | "orig" = "thumb") =>
    `/api/photos/${logId}?size=${size}`,
};
