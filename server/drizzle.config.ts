import { defineConfig } from "drizzle-kit";

// Run from the repo root (npm run db:generate). Paths are posix + relative:
// drizzle-kit joins `out` onto the cwd, while `schema` needs forward slashes.
export default defineConfig({
  dialect: "postgresql",
  schema: "server/src/db/schema.ts",
  out: "server/drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://judetracker:judetracker@localhost:5433/judetracker",
  },
});
