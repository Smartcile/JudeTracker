import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import { config } from "./config.ts";
import { errorHandler } from "./lib/http.ts";
import { requireAuth } from "./lib/auth.ts";
import { authRouter } from "./routes/auth.ts";
import { settingsRouter } from "./routes/settings.ts";
import { vehiclesRouter } from "./routes/vehicles.ts";
import { calendarRouter } from "./routes/calendar.ts";
import { jobsRouter } from "./routes/jobs.ts";
import { jobsLogsRouter, logsRouter } from "./routes/logs.ts";
import { claimsRouter } from "./routes/claims.ts";
import { summaryRouter } from "./routes/summary.ts";
import { exportRouter } from "./routes/export.ts";
import { photosRouter } from "./routes/photos.ts";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth);
  app.use("/api/settings", settingsRouter);
  app.use("/api/vehicles", vehiclesRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api", jobsLogsRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/logs", logsRouter);
  app.use("/api", claimsRouter);
  app.use("/api", summaryRouter);
  app.use("/api", exportRouter);
  app.use("/api/photos", photosRouter);

  const staticDir = path.resolve(process.cwd(), config.staticDir);
  if (existsSync(staticDir)) {
    // Hashed assets are immutable; index.html must never be cached so new
    // deployments reach the browser on the next reload.
    app.use(express.static(staticDir, { maxAge: "1y", immutable: true, index: false }));
    const sendIndex = (res: express.Response) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(staticDir, "index.html"));
    };
    app.get("/", (_req, res) => sendIndex(res));
    app.get(/^(?!\/api\/).*/, (_req, res) => sendIndex(res));
  }

  app.use(errorHandler);
  return app;
}
