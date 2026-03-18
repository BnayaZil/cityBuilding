#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const worldServerUrl = process.env.WORLD_SERVER_URL ?? "http://localhost:3000";
const worldId = process.env.WORLD_ID ?? "default";
const username = process.env.CITY_BOOTSTRAP_USER ?? "local-bot";
const password = process.env.CITY_BOOTSTRAP_PASSWORD ?? "local-bot-secret";
const email = process.env.CITY_BOOTSTRAP_EMAIL ?? "local-bot@example.com";
const teamName = process.env.CITY_BOOTSTRAP_TEAM ?? "Local Team";
const repo = process.env.CITY_BOOTSTRAP_REPO ?? "local/cityBuilding";

async function requestJson(route, options = {}) {
  const extraHeaders = options.headers ?? {};
  const response = await fetch(`${worldServerUrl}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, body };
}

function runScan(outPath) {
  execFileSync(
    "cargo",
    ["run", "-q", "-p", "city-building-cli", "--", "scan", "--path", process.cwd(), "--out", outPath],
    { stdio: "inherit" },
  );
}

async function main() {
  const health = await requestJson("/api/v1/health", { method: "GET" });
  if (!health.ok) {
    throw new Error(`world server is not healthy: ${health.status}`);
  }

  let auth = await requestJson("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
  if (!auth.ok) {
    auth = await requestJson("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }
  if (!auth.ok) {
    throw new Error(`auth failed (${auth.status})`);
  }
  const token = auth.body.token;

  const team = await requestJson("/api/v1/teams", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: teamName }),
  });
  if (!team.ok) {
    throw new Error(`team create failed (${team.status})`);
  }
  const teamId = team.body.id;

  let city = await requestJson("/api/v1/cities", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      world_id: worldId,
      team_id: teamId,
      repo,
      name: "cityBuilding",
    }),
  });
  if (!city.ok && city.status === 409) {
    const world = await requestJson(`/api/v1/worlds/${worldId}`, { method: "GET" });
    const existing = world.body.cities?.find((entry) => entry.repo === repo);
    if (!existing) {
      throw new Error("city already exists but cannot be resolved from world payload");
    }
    city = { ok: true, status: 200, body: { id: existing.id, repo } };
  }
  if (!city.ok) {
    throw new Error(`city create failed (${city.status})`);
  }
  const cityId = city.body.id;

  const apiKeyResult = await requestJson(`/api/v1/teams/${teamId}/api-keys`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ city_ids: [cityId] }),
  });
  if (!apiKeyResult.ok) {
    throw new Error(`api key create failed (${apiKeyResult.status})`);
  }
  const apiKey = apiKeyResult.body.key;

  const outPath = path.resolve(process.cwd(), ".city-bootstrap-blueprint.json");
  runScan(outPath);
  const blueprint = JSON.parse(readFileSync(outPath, "utf8"));

  const push = await requestJson(`/api/v1/cities/${cityId}/push`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
    },
    body: JSON.stringify(blueprint),
  });
  if (!push.ok) {
    throw new Error(`push failed (${push.status})`);
  }

  const bootstrapState = {
    worldServerUrl,
    worldId,
    teamId,
    cityId,
    apiKey,
    token,
  };
  writeFileSync(path.resolve(process.cwd(), ".city.local.json"), JSON.stringify(bootstrapState, null, 2));

  console.log("Bootstrap complete.");
  console.log(`World URL: ${worldServerUrl}/`);
  console.log(`City URL: ${worldServerUrl}/cities/${cityId}`);
  console.log(`City ID: ${cityId}`);
  console.log(`Team ID: ${teamId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
