import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";
import { maybeAutoSync } from "./services/calendarSync.ts";

async function main(): Promise<void> {
  await fs.mkdir(path.join(config.dataDir, "photos"), { recursive: true });
  await runMigrations();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`JudeTracker listening on http://localhost:${config.port}`);
  });

  maybeAutoSync().catch(() => undefined);
  setInterval(() => maybeAutoSync().catch(() => undefined), 15 * 60_000).unref();
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
