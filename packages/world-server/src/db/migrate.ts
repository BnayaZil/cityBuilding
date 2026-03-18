import { readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runPsql(databaseUrl: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "psql",
    [databaseUrl, "--no-psqlrc", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: process.env,
    },
  );
  return stdout.toString();
}

export async function runSqlMigrations(databaseUrl: string, migrationsDir: string): Promise<void> {
  await runPsql(
    databaseUrl,
    `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  );

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const exists = await runPsql(
      databaseUrl,
      `SELECT 1 FROM schema_migrations WHERE name = '${file.replace(/'/g, "''")}' LIMIT 1`,
    );
    if (exists.trim() === "1") {
      continue;
    }
    const migrationPath = path.join(migrationsDir, file);
    await execFileAsync("psql", [databaseUrl, "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1", "-f", migrationPath], {
      env: process.env,
    });
    await runPsql(
      databaseUrl,
      `INSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}') ON CONFLICT DO NOTHING`,
    );
  }
}
