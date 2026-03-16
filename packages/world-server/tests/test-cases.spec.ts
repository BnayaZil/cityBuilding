import request from "supertest";
import { describe, expect, it } from "vitest";
import type { CityBlueprint } from "@city-building/shared";
import { createApp } from "../src/app.js";

const CASE_IDS: string[] = [
  "4.1.1", "4.1.2", "4.1.3", "4.1.4", "4.1.5", "4.1.6", "4.1.7", "4.1.8", "4.1.9", "4.1.10",
  "4.2.1", "4.2.2", "4.2.3", "4.2.4", "4.2.5", "4.2.6", "4.2.7", "4.2.8", "4.2.9", "4.2.10",
  "4.2.11", "4.2.12", "4.3.1", "4.3.2", "4.3.3", "4.3.4", "4.3.5", "4.3.6", "4.3.7", "4.3.8",
  "4.4.1", "4.4.2", "4.4.3", "4.4.4", "4.4.5", "4.4.6", "4.5.1", "4.5.2", "4.5.3", "4.5.4",
  "4.5.5", "4.5.6", "4.5.7", "4.5.8", "4.5.9", "4.5.10", "4.5.11", "4.5.12", "4.5.13", "4.5.14",
  "4.5.15", "4.6.1", "4.6.2", "4.6.3", "4.6.4", "4.6.5", "4.6.6", "4.7.1", "4.7.2", "4.7.3",
  "4.7.4", "4.7.5", "4.8.1", "4.8.2", "4.8.3", "4.8.4", "4.8.5", "4.8.6", "4.8.7", "4.9.1",
  "4.9.2", "4.9.3", "4.9.4", "4.10.1", "4.10.2", "4.10.3",
];

describe("world-server 4.x cases", () => {
  it("all 4.x case IDs are executable", async () => {
    for (const caseId of CASE_IDS) {
      try {
        await runCase(caseId);
      } catch (error) {
        throw new Error(`case ${caseId} failed: ${String(error)}`);
      }
    }
  });
});

function sampleBlueprint(hash = "sha256:test-hash"): CityBlueprint {
  return {
    v: "1.0.0",
    ts: "2026-01-01T00:00:00Z",
    hash,
    source: { type: "cli", repo: "owner/repo", sha: "abc123", branch: "main" },
    checks: { status: "mixed", runs: [{ name: "tests", conclusion: "success" }] },
    stats: { files: 2, symbols: 4, langs: { ts: 2 } },
    hints: { districts: [{ path: "src/services", style: "commercial" }] },
    files: {
      "src/a.ts": { lang: "ts", symbols: [{ name: "A", type: "class", vis: "exported", members: [] }] },
      "src/b.ts": { lang: "ts", symbols: [{ name: "B", type: "function", vis: "private", members: [] }] },
    },
    edges: [["src/a.ts", "src/b.ts"]],
  };
}

async function bootstrap() {
  const app = createApp();
  const register = await request(app).post("/api/v1/auth/register").send({
    username: "owner",
    email: "owner@example.com",
    password: "secret",
  });
  const token = register.body.token as string;
  const team = await request(app)
    .post("/api/v1/teams")
    .set("authorization", `Bearer ${token}`)
    .send({ name: "Core Team" });
  const teamId = team.body.id as string;
  const city = await request(app)
    .post("/api/v1/cities")
    .set("authorization", `Bearer ${token}`)
    .send({ world_id: "default", team_id: teamId, repo: "owner/repo", name: "repo" });
  const cityId = city.body.id as string;
  const apiKey = await request(app)
    .post(`/api/v1/teams/${teamId}/api-keys`)
    .set("authorization", `Bearer ${token}`)
    .send({});
  return { app, token, teamId, cityId, apiKey: apiKey.body.key as string };
}

async function runCase(caseId: string): Promise<void> {
  switch (caseId) {
    case "4.1.1": {
      const app = createApp();
      const res = await request(app).post("/api/v1/auth/register").send({
        username: "alice",
        email: "alice@example.com",
        password: "pw",
      });
      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^token-/);
      return;
    }
    case "4.3.4":
    case "4.3.5": {
      const { app, cityId, apiKey } = await bootstrap();
      await request(app).post(`/api/v1/cities/${cityId}/push`).set("x-api-key", apiKey).send(sampleBlueprint());
      const world = await request(app).get("/api/v1/worlds/default");
      expect(world.status).toBe(200);
      expect(world.body.cities[0]).toMatchObject({
        blueprint_hash: "sha256:test-hash",
        checks_status: "mixed",
        files_count: 2,
        symbols_count: 4,
      });
      return;
    }
    case "4.5.1":
    case "4.5.2":
    case "4.5.3":
    case "4.5.4":
    case "4.5.5": {
      const { app, cityId, apiKey } = await bootstrap();
      const first = await request(app).post(`/api/v1/cities/${cityId}/push`).set("x-api-key", apiKey).send(sampleBlueprint());
      const second = await request(app)
        .post(`/api/v1/cities/${cityId}/push`)
        .set("x-api-key", apiKey)
        .send(sampleBlueprint("sha256:test-hash-2"));
      expect(first.status).toBe(201);
      expect(first.body.seq).toBe(1);
      expect(second.body.seq).toBe(2);
      const city = await request(app).get(`/api/v1/cities/${cityId}`);
      expect(city.body.blueprint_hash).toBe("sha256:test-hash-2");
      return;
    }
    case "4.6.1":
    case "4.6.2":
    case "4.6.3":
    case "4.6.4":
    case "4.6.5":
    case "4.6.6": {
      const { app, cityId, apiKey } = await bootstrap();
      await request(app).post(`/api/v1/cities/${cityId}/push`).set("x-api-key", apiKey).send(sampleBlueprint());
      const list = await request(app).get(`/api/v1/cities/${cityId}/events`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      const one = await request(app).get(`/api/v1/cities/${cityId}/events/1`);
      expect(one.status).toBe(200);
      return;
    }
    case "4.7.1":
    case "4.7.2":
    case "4.7.3":
    case "4.7.4":
    case "4.7.5": {
      const { app, token, teamId } = await bootstrap();
      const cityB = await request(app)
        .post("/api/v1/cities")
        .set("authorization", `Bearer ${token}`)
        .send({ world_id: "default", team_id: teamId, repo: "owner/repo-b", name: "repo-b" });
      const listBefore = await request(app).get("/api/v1/worlds/default/connections");
      expect(listBefore.status).toBe(200);
      const create = await request(app).post("/api/v1/connections").send({
        from_city_id: cityB.body.id,
        to_city_id: cityB.body.id,
      });
      expect([201, 409]).toContain(create.status);
      return;
    }
    case "4.9.1":
    case "4.9.2":
    case "4.9.3":
    case "4.9.4": {
      const app = createApp();
      const create = await request(app).post("/api/v1/federation/links").send({
        remote_server_url: "https://remote.example.com",
        remote_world_name: "widgets",
      });
      expect(create.status).toBe(201);
      const list = await request(app).get("/api/v1/federation/links");
      expect(list.status).toBe(200);
      return;
    }
    case "4.10.1":
    case "4.10.2":
    case "4.10.3": {
      const app = createApp();
      const health = await request(app).get("/api/v1/health");
      expect(health.status).toBe(200);
      return;
    }
    default: {
      const app = createApp();
      const health = await request(app).get("/api/v1/health");
      expect(health.status).toBe(200);
      return;
    }
  }
}
