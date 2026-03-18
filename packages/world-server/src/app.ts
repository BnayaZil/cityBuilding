import express, { type Request, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import type { CityBlueprint, ChecksStatus, WorldResponse } from "@city-building/shared";
import { NoopPersistence, type StatePersistence } from "./persistence.js";
import { validateBlueprintPayload } from "./blueprint-validator.js";
import {
  citySummary,
  createInitialState,
  nextId,
  type ApiKeyRecord,
  type MemoryState,
  type Role,
} from "./state.js";

export interface AppOptions {
  state?: MemoryState;
  persistence?: StatePersistence;
  staticRoot?: string;
  enableSpaFallback?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function inferChecksStatus(blueprint: CityBlueprint): ChecksStatus {
  return blueprint.checks?.status ?? "unknown";
}

function userFromToken(req: Request, state: MemoryState) {
  const auth = req.header("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = auth.slice("bearer ".length);
  const userId = token.replace("token-", "");
  return state.users[userId] ?? null;
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: "unauthorized" });
}

function forbidden(res: Response): void {
  res.status(403).json({ error: "forbidden" });
}

function apiKeyFromRequest(req: Request, state: MemoryState): ApiKeyRecord | null {
  const key = req.header("x-api-key");
  if (!key) {
    return null;
  }
  for (const team of Object.values(state.teams)) {
    for (const apiKey of Object.values(team.apiKeys)) {
      if (!apiKey.revoked && apiKey.key === key) {
        return apiKey;
      }
    }
  }
  return null;
}

export function createApp(options: AppOptions = {}) {
  const persistence = options.persistence ?? new NoopPersistence();
  const state = options.state ?? createInitialState();
  const staticRoot = options.staticRoot;

  const app = express();
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: "5mb" }));

  const persistState = async () => {
    await persistence.saveState(state);
  };

  app.get("/api/v1/health", async (_req, res) => {
    const healthy = await persistence.healthCheck();
    if (!healthy) {
      return res.status(503).json({ status: "unhealthy", reason: "database" });
    }
    return res.status(200).json({ status: "ok" });
  });

  app.post("/api/v1/auth/register", async (req, res) => {
    const { username, email, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: "validation_error" });
    }
    if (Object.values(state.users).some((u) => u.username === username)) {
      return res.status(409).json({ error: "username_exists" });
    }
    if (email && Object.values(state.users).some((u) => u.email === email)) {
      return res.status(409).json({ error: "email_exists" });
    }
    const id = nextId(state, "user");
    state.users[id] = { id, username, email, password };
    await persistState();
    return res.status(201).json({ token: `token-${id}`, user: { id, username, email } });
  });

  app.post("/api/v1/auth/login", (req, res) => {
    const { username, password } = req.body ?? {};
    const user = Object.values(state.users).find((u) => u.username === username);
    if (!user || user.password !== password) {
      return unauthorized(res);
    }
    return res.status(200).json({ token: `token-${user.id}`, user: { id: user.id, username: user.username } });
  });

  app.post("/api/v1/teams", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const { name } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ error: "validation_error" });
    }
    const id = nextId(state, "team");
    state.teams[id] = {
      id,
      name,
      members: { [user.id]: "owner" },
      invites: {},
      apiKeys: {},
    };
    await persistState();
    return res.status(201).json({ id, name });
  });

  app.get("/api/v1/teams", (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const teams = Object.values(state.teams)
      .filter((team) => team.members[user.id])
      .map((team) => ({ id: team.id, name: team.name, role: team.members[user.id] }));
    return res.status(200).json(teams);
  });

  app.get("/api/v1/teams/:id", (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const team = state.teams[req.params.id];
    if (!team) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!team.members[user.id]) {
      return forbidden(res);
    }
    return res.status(200).json({
      id: team.id,
      name: team.name,
      members: Object.entries(team.members).map(([userId, role]) => ({ user_id: userId, role })),
    });
  });

  app.post("/api/v1/teams/:id/invites", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const team = state.teams[req.params.id];
    if (!team) {
      return res.status(404).json({ error: "not_found" });
    }
    const role = team.members[user.id];
    if (!role || (role !== "owner" && role !== "admin")) {
      return forbidden(res);
    }
    const code = `invite-${nextId(state, "code")}`;
    const invite = {
      code,
      teamId: team.id,
      role: (req.body?.role as Role | undefined) ?? "member",
      uses: 0,
      maxUses: typeof req.body?.max_uses === "number" ? req.body.max_uses : null,
      expiresAt: req.body?.expires_at ? Date.parse(req.body.expires_at) : null,
    };
    team.invites[code] = invite;
    await persistState();
    return res.status(201).json({ code });
  });

  app.get("/api/v1/teams/:id/invites", (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const team = state.teams[req.params.id];
    if (!team) {
      return res.status(404).json({ error: "not_found" });
    }
    const role = team.members[user.id];
    if (!role || (role !== "owner" && role !== "admin")) {
      return forbidden(res);
    }
    return res.status(200).json(Object.values(team.invites));
  });

  app.post("/api/v1/teams/join/:code", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const code = req.params.code;
    const team = Object.values(state.teams).find((t) => t.invites[code]);
    if (!team) {
      return res.status(404).json({ error: "invite_not_found" });
    }
    const invite = team.invites[code];
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      return res.status(410).json({ error: "invite_expired" });
    }
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      return res.status(410).json({ error: "invite_exhausted" });
    }
    if (team.members[user.id]) {
      return res.status(409).json({ error: "already_member" });
    }
    team.members[user.id] = invite.role;
    invite.uses += 1;
    await persistState();
    return res.status(200).json({ ok: true, team_id: team.id, role: invite.role });
  });

  app.post("/api/v1/teams/:id/api-keys", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const team = state.teams[req.params.id];
    if (!team) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!team.members[user.id]) {
      return forbidden(res);
    }
    const keyId = nextId(state, "key");
    const keyValue = `city_pk_${nextId(state, "token")}`;
    team.apiKeys[keyId] = {
      id: keyId,
      key: keyValue,
      teamId: team.id,
      cityIds: Array.isArray(req.body?.city_ids) ? req.body.city_ids : [],
      revoked: false,
      lastUsed: null,
    };
    await persistState();
    return res.status(201).json({ id: keyId, key: keyValue, city_ids: team.apiKeys[keyId].cityIds });
  });

  app.get("/api/v1/teams/:id/api-keys", (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const team = state.teams[req.params.id];
    if (!team) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!team.members[user.id]) {
      return forbidden(res);
    }
    const keys = Object.values(team.apiKeys).map((k) => ({
      id: k.id,
      city_ids: k.cityIds,
      revoked: k.revoked,
      last_used: k.lastUsed ? new Date(k.lastUsed).toISOString() : null,
    }));
    return res.status(200).json(keys);
  });

  app.post("/api/v1/api-keys/:id/revoke", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    for (const team of Object.values(state.teams)) {
      if (team.apiKeys[req.params.id]) {
        if (!team.members[user.id]) {
          return forbidden(res);
        }
        team.apiKeys[req.params.id].revoked = true;
        await persistState();
        return res.status(200).json({ ok: true });
      }
    }
    return res.status(404).json({ error: "not_found" });
  });

  app.get("/api/v1/worlds", (_req, res) => {
    const worlds = Object.values(state.worlds)
      .filter((w) => w.is_public)
      .map((w) => ({ id: w.id, name: w.name, description: w.description, is_public: w.is_public }));
    return res.status(200).json(worlds);
  });

  app.post("/api/v1/worlds", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const { name, description, is_public } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ error: "validation_error" });
    }
    if (Object.values(state.worlds).some((w) => w.name === name)) {
      return res.status(409).json({ error: "world_exists" });
    }
    const id = nextId(state, "world");
    state.worlds[id] = { id, name, description, is_public: is_public !== false };
    await persistState();
    return res.status(201).json(state.worlds[id]);
  });

  app.get("/api/v1/worlds/:id", (req, res) => {
    const world = state.worlds[req.params.id];
    if (!world) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!world.is_public && !userFromToken(req, state)) {
      return unauthorized(res);
    }
    const cities = Object.values(state.cities)
      .filter((city) => city.world_id === world.id)
      .map(citySummary);
    const response: WorldResponse = { id: world.id, name: world.name, cities };
    return res.status(200).json(response);
  });

  app.post("/api/v1/cities", async (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const { world_id, team_id, repo, name } = req.body ?? {};
    if (!world_id || !team_id || !repo) {
      return res.status(400).json({ error: "validation_error" });
    }
    const world = state.worlds[world_id];
    const team = state.teams[team_id];
    if (!world || !team) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!team.members[user.id]) {
      return forbidden(res);
    }
    const duplicate = Object.values(state.cities).find((c) => c.world_id === world_id && c.repo === repo);
    if (duplicate) {
      return res.status(409).json({ error: "city_exists" });
    }
    const id = nextId(state, "city");
    state.cities[id] = {
      id,
      world_id,
      team_id,
      repo,
      name: name ?? repo.split("/").pop() ?? repo,
      events: [],
      snapshot: null,
    };
    await persistState();
    return res.status(201).json(state.cities[id]);
  });

  app.get("/api/v1/cities/:id", (req, res) => {
    const city = state.cities[req.params.id];
    if (!city) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.status(200).json({
      id: city.id,
      name: city.name,
      repo: city.repo,
      blueprint_hash: city.snapshot?.blueprint_hash ?? null,
      blueprint: city.snapshot?.blueprint ?? null,
    });
  });

  app.post("/api/v1/cities/:id/push", async (req, res) => {
    const city = state.cities[req.params.id];
    if (!city) {
      return res.status(404).json({ error: "city_not_found" });
    }
    const team = state.teams[city.team_id];
    const apiKey = apiKeyFromRequest(req, state);
    if (!apiKey || apiKey.teamId !== team.id || apiKey.revoked) {
      return unauthorized(res);
    }
    if (apiKey.cityIds.length > 0 && !apiKey.cityIds.includes(city.id)) {
      return forbidden(res);
    }
    const candidate = req.body;
    const validationIssues = validateBlueprintPayload(candidate);
    if (validationIssues.length > 0) {
      return res.status(400).json({ error: "schema_validation_error", details: validationIssues });
    }
    const blueprint = candidate as CityBlueprint;
    apiKey.lastUsed = Date.now();

    const seq = city.events.length + 1;
    const event = {
      seq,
      sha: blueprint.source?.sha ?? "unknown",
      blueprint_hash: blueprint.hash,
      source_type: blueprint.source?.type ?? "cli",
      blueprint,
      created_at: nowIso(),
    };
    city.events.push(event);
    city.snapshot = {
      seq,
      blueprint_hash: blueprint.hash,
      checks_status: inferChecksStatus(blueprint),
      files_count: blueprint.stats.files,
      symbols_count: blueprint.stats.symbols,
      blueprint,
    };
    await persistState();
    return res.status(201).json({ ok: true, seq, blueprint_hash: blueprint.hash });
  });

  app.get("/api/v1/cities/:id/events", (req, res) => {
    const city = state.cities[req.params.id];
    if (!city) {
      return res.status(404).json({ error: "not_found" });
    }
    const fromSeq = req.query.from_seq ? Number(req.query.from_seq) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    let events = [...city.events].reverse();
    if (fromSeq !== null) {
      events = events.filter((e) => e.seq >= fromSeq);
    }
    return res.status(200).json(events.slice(0, limit));
  });

  app.get("/api/v1/cities/:id/events/:seq", (req, res) => {
    const city = state.cities[req.params.id];
    if (!city) {
      return res.status(404).json({ error: "not_found" });
    }
    const seq = Number(req.params.seq);
    const event = city.events.find((e) => e.seq === seq);
    if (!event) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.status(200).json(event);
  });

  app.post("/api/v1/connections", async (req, res) => {
    const { from_city_id, to_city_id, label } = req.body ?? {};
    const from = state.cities[from_city_id];
    const to = state.cities[to_city_id];
    if (!from || !to) {
      return res.status(404).json({ error: "city_not_found" });
    }
    if (from.world_id !== to.world_id) {
      return res.status(400).json({ error: "cross_world_connection_not_allowed" });
    }
    const dup = Object.values(state.connections).find(
      (c) => c.world_id === from.world_id && c.from_city_id === from_city_id && c.to_city_id === to_city_id,
    );
    if (dup) {
      return res.status(409).json({ error: "connection_exists" });
    }
    const id = nextId(state, "conn");
    state.connections[id] = {
      id,
      world_id: from.world_id,
      from_city_id,
      to_city_id,
      label,
    };
    await persistState();
    return res.status(201).json(state.connections[id]);
  });

  app.get("/api/v1/worlds/:id/connections", (req, res) => {
    const connections = Object.values(state.connections).filter((c) => c.world_id === req.params.id);
    return res.status(200).json(connections);
  });

  app.post("/api/v1/federation/links", async (req, res) => {
    const { remote_server_url, remote_world_id, remote_world_name } = req.body ?? {};
    if (!remote_server_url) {
      return res.status(400).json({ error: "validation_error" });
    }
    const id = nextId(state, "federation");
    state.federationLinks[id] = {
      id,
      remote_server_url,
      remote_world_id,
      remote_world_name,
      status: "pending",
    };
    await persistState();
    return res.status(201).json(state.federationLinks[id]);
  });

  app.get("/api/v1/federation/links", (_req, res) => {
    return res.status(200).json(Object.values(state.federationLinks));
  });

  if (staticRoot) {
    app.use(express.static(staticRoot));
    if (options.enableSpaFallback) {
      app.get(/^\/(?!api\/).*/, (_req, res) => {
        const indexPath = path.join(staticRoot, "index.html");
        if (existsSync(indexPath)) {
          return res.sendFile(indexPath);
        }
        return res.status(404).send("index.html not found");
      });
    }
  }

  return app;
}

export async function createAppFromEnv() {
  const databaseUrl = process.env.DATABASE_URL;
  const migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "packages/world-server/migrations");
  let persistence: StatePersistence = new NoopPersistence();
  let state = createInitialState();

  if (databaseUrl) {
    const { PostgresStateStore } = await import("./db/postgres-state-store.js");
    const pgStore = new PostgresStateStore(databaseUrl, migrationsDir);
    await pgStore.runMigrations();
    const loaded = await pgStore.loadState();
    if (loaded) {
      state = loaded;
    }
    persistence = pgStore;
  }

  const staticRootCandidate = process.env.WEB_DIST_DIR ?? path.resolve(process.cwd(), "packages/web/dist");
  const staticRoot = existsSync(staticRootCandidate) ? staticRootCandidate : undefined;
  const app = createApp({
    state,
    persistence,
    staticRoot,
    enableSpaFallback: true,
  });
  return { app, persistence };
}

export async function startServer(port = 3000) {
  const { app, persistence } = await createAppFromEnv();
  const server = app.listen(port);
  server.on("close", () => {
    void persistence.close();
  });
  return server;
}
