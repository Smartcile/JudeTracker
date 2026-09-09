const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8090),
  databaseUrl:
    env.DATABASE_URL ?? "postgres://judetracker:judetracker@localhost:5433/judetracker",
  dataDir: env.DATA_DIR ?? "./data",
  cookieSecure: env.COOKIE_SECURE === "true",
  sessionTtlMs: Number(env.SESSION_TTL_MINUTES ?? 60 * 24 * 14) * 60_000,
  idleMs: Number(env.SESSION_IDLE_MINUTES ?? 15) * 60_000,
  staticDir: env.STATIC_DIR ?? "./client/dist",
  maxUploadBytes: 25 * 1024 * 1024,
};
