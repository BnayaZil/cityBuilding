import path from "node:path";
import { PostgresStateStore } from "./postgres-state-store.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  const migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "packages/world-server/migrations");
  const store = new PostgresStateStore(databaseUrl, migrationsDir);
  try {
    await store.runMigrations();
    console.log("Migrations applied.");
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
