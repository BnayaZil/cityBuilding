import { execFileSync } from "node:child_process";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { CityBlueprint } from "@city-building/shared";
import { createAppFromEnv } from "../src/app.js";

const databaseUrl = process.env.DATABASE_URL;

function sampleBlueprint(hash = "sha256:pg-hash"): CityBlueprint {
  return {
    v: "1.0.0",
    ts: "2026-01-01T00:00:00Z",
    hash,
    source: { type: "cli", repo: "owner/repo", sha: "abc123", branch: "main" },
    checks: { status: "success", runs: [{ name: "tests", conclusion: "success" }] },
    stats: { files: 1, symbols: 1, langs: { ts: 1 } },
    files: {
      "src/index.ts": {
        lang: "ts",
        symbols: [{ name: "Main", type: "class", vis: "exported", members: [] }],
      },
    },
    edges: [],
  };
}

describe.skipIf(!databaseUrl)("world-server postgres integration", () => {
  it("persists state across app restarts", async () => {
    process.env.MIGRATIONS_DIR = path.resolve(process.cwd(), "packages/world-server/migrations");
    process.env.DATABASE_URL = databaseUrl;

    execFileSync("psql", [databaseUrl as string, "-v", "ON_ERROR_STOP=1", "-c", "DROP TABLE IF EXISTS app_state CASCADE"], {
      stdio: "inherit",
    });
    execFileSync(
      "psql",
      [databaseUrl as string, "-v", "ON_ERROR_STOP=1", "-c", "DROP TABLE IF EXISTS schema_migrations CASCADE"],
      { stdio: "inherit" },
    );

    const { app: appOne, persistence: persistenceOne } = await createAppFromEnv();
    const register = await request(appOne).post("/api/v1/auth/register").send({
      username: "db-owner",
      password: "secret",
    });
    const token = register.body.token as string;
    const team = await request(appOne).post("/api/v1/teams").set("authorization", `Bearer ${token}`).send({ name: "DB Team" });
    const teamId = team.body.id as string;
    const city = await request(appOne)
      .post("/api/v1/cities")
      .set("authorization", `Bearer ${token}`)
      .send({ world_id: "default", team_id: teamId, repo: "owner/repo", name: "repo" });
    const cityId = city.body.id as string;
    const apiKey = await request(appOne)
      .post(`/api/v1/teams/${teamId}/api-keys`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    const key = apiKey.body.key as string;
    const push = await request(appOne).post(`/api/v1/cities/${cityId}/push`).set("x-api-key", key).send(sampleBlueprint());
    expect(push.status).toBe(201);
    await persistenceOne.close();

    const { app: appTwo, persistence: persistenceTwo } = await createAppFromEnv();
    const world = await request(appTwo).get("/api/v1/worlds/default");
    expect(world.status).toBe(200);
    expect(world.body.cities.length).toBe(1);
    expect(world.body.cities[0].repo).toBe("owner/repo");
    expect(world.body.cities[0].blueprint_hash).toBe("sha256:pg-hash");
    await persistenceTwo.close();
  });
});
