import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runSqlMigrations } from "./migrate.js";
import type { MemoryState } from "../state.js";
import type { StatePersistence } from "../persistence.js";

const execFileAsync = promisify(execFile);

export class PostgresStateStore implements StatePersistence {
  private readonly connectionString: string;
  private readonly migrationsDir: string;

  constructor(connectionString: string, migrationsDir: string) {
    this.connectionString = connectionString;
    this.migrationsDir = migrationsDir;
  }

  private async runPsql(sql: string): Promise<string> {
    const { stdout } = await execFileAsync(
      "psql",
      [this.connectionString, "--no-psqlrc", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
      {
        env: process.env,
      },
    );
    return stdout.toString();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.runPsql("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async runMigrations(): Promise<void> {
    await runSqlMigrations(this.connectionString, this.migrationsDir);
  }

  async loadState(): Promise<MemoryState | null> {
    const row = await this.runPsql("SELECT encode(convert_to(state::text, 'UTF8'), 'base64') FROM app_state WHERE id = 1");
    const encoded = row.trim();
    if (!encoded) {
      return null;
    }
    const json = Buffer.from(encoded, "base64").toString("utf8");
    return JSON.parse(json) as MemoryState;
  }

  async saveState(state: MemoryState): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(state), "utf8").toString("base64");
    await this.runPsql(
      `
      INSERT INTO app_state (id, state, updated_at)
      VALUES (1, convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
      `
    );
  }

  async close(): Promise<void> {}
}
