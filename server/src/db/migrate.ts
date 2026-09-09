import { existsSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index.ts";

function findMigrationsFolder(): string {
  const candidates = [
    path.join(process.cwd(), "server", "drizzle"),
    path.join(process.cwd(), "drizzle"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("drizzle migrations folder not found (run `npm run db:generate`)");
}

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: findMigrationsFolder() });
}
