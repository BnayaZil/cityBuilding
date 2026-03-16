import express, { type Request, type Response } from "express";
import type { CityBlueprint, CitySummary, ChecksStatus, WorldResponse } from "@city-building/shared";

type Role = "owner" | "admin" | "member";

interface User {
  id: string;
  username: string;
  email?: string;
  password: string;
}

interface TeamInvite {
  code: string;
  teamId: string;
  role: Role;
  uses: number;
  maxUses: number | null;
  expiresAt: number | null;
}

interface ApiKeyRecord {
  id: string;
  key: string;
  teamId: string;
  cityIds: string[];
  revoked: boolean;
  lastUsed: number | null;
}

interface Team {
  id: string;
  name: string;
  members: Record<string, Role>;
  invites: Record<string, TeamInvite>;
  apiKeys: Record<string, ApiKeyRecord>;
}

interface EventRecord {
  seq: number;
  sha: string;
  blueprint_hash: string;
  source_type: string;
  blueprint: CityBlueprint;
  created_at: string;
}

interface Snapshot {
  seq: number;
  blueprint_hash: string;
  checks_status: ChecksStatus;
  files_count: number;
  symbols_count: number;
  blueprint: CityBlueprint;
}

interface CityRecord {
  id: string;
  world_id: string;
  team_id: string;
  repo: string;
  name: string;
  events: EventRecord[];
  snapshot: Snapshot | null;
}

interface WorldRecord {
  id: string;
  name: string;
  description?: string;
  is_public: boolean;
}

interface ConnectionRecord {
  id: string;
  world_id: string;
  from_city_id: string;
  to_city_id: string;
  label?: string;
}

interface FederationLink {
  id: string;
  remote_server_url: string;
  remote_world_id?: string;
  remote_world_name?: string;
  status: "pending" | "active" | "rejected";
}

interface MemoryState {
  users: Record<string, User>;
  teams: Record<string, Team>;
  worlds: Record<string, WorldRecord>;
  cities: Record<string, CityRecord>;
  connections: Record<string, ConnectionRecord>;
  federationLinks: Record<string, FederationLink>;
}

let idCounter = 1;
function nextId(prefix: string): string {
  const value = `${prefix}-${idCounter}`;
  idCounter += 1;
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newState(): MemoryState {
  const defaultWorld: WorldRecord = {
    id: "default",
    name: "Default World",
    is_public: true,
  };
  return {
    users: {},
    teams: {},
    worlds: { [defaultWorld.id]: defaultWorld },
    cities: {},
    connections: {},
    federationLinks: {},
  };
}

function userFromToken(req: Request, state: MemoryState): User | null {
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

function citySummary(city: CityRecord): CitySummary {
  if (!city.snapshot) {
    return {
      id: city.id,
      name: city.name,
      repo: city.repo,
      seq: 0,
      blueprint_hash: "sha256:empty",
      checks_status: "unknown",
      files_count: 0,
      symbols_count: 0,
    };
  }
  return {
    id: city.id,
    name: city.name,
    repo: city.repo,
    seq: city.snapshot.seq,
    blueprint_hash: city.snapshot.blueprint_hash,
    checks_status: city.snapshot.checks_status,
    files_count: city.snapshot.files_count,
    symbols_count: city.snapshot.symbols_count,
  };
}

function inferChecksStatus(blueprint: CityBlueprint): ChecksStatus {
  return blueprint.checks?.status ?? "unknown";
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

export function createApp(state: MemoryState = newState()) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/api/v1/auth/register", (req, res) => {
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
    const id = nextId("user");
    state.users[id] = { id, username, email, password };
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

  app.post("/api/v1/teams", (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const { name } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ error: "validation_error" });
    }
    const id = nextId("team");
    state.teams[id] = {
      id,
      name,
      members: { [user.id]: "owner" },
      invites: {},
      apiKeys: {},
    };
    return res.status(201).json({ id, name });
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

  app.post("/api/v1/teams/:id/invites", (req, res) => {
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
    const code = `invite-${nextId("code")}`;
    const invite: TeamInvite = {
      code,
      teamId: team.id,
      role: (req.body?.role as Role | undefined) ?? "member",
      uses: 0,
      maxUses: typeof req.body?.max_uses === "number" ? req.body.max_uses : null,
      expiresAt: req.body?.expires_at ? Date.parse(req.body.expires_at) : null,
    };
    team.invites[code] = invite;
    return res.status(201).json({ code });
  });

  app.post("/api/v1/teams/join/:code", (req, res) => {
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
    return res.status(200).json({ ok: true, team_id: team.id, role: invite.role });
  });

  app.post("/api/v1/teams/:id/api-keys", (req, res) => {
    const user = userFromToken(req, state);
    if (!user) {
      return unauthorized(res);
    }
    const team = state.teams[req.params.id];
    if (!team) {
      return res.status(404).json({ error: "not_found" });
    }
    const memberRole = team.members[user.id];
    if (!memberRole) {
      return forbidden(res);
    }
    const keyId = nextId("key");
    const keyValue = `city_pk_${nextId("token")}`;
    team.apiKeys[keyId] = {
      id: keyId,
      key: keyValue,
      teamId: team.id,
      cityIds: Array.isArray(req.body?.city_ids) ? req.body.city_ids : [],
      revoked: false,
      lastUsed: null,
    };
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

  app.post("/api/v1/api-keys/:id/revoke", (req, res) => {
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

  app.post("/api/v1/worlds", (req, res) => {
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
    const id = nextId("world");
    state.worlds[id] = { id, name, description, is_public: is_public !== false };
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

  app.post("/api/v1/cities", (req, res) => {
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
    const id = nextId("city");
    state.cities[id] = {
      id,
      world_id,
      team_id,
      repo,
      name: name ?? repo.split("/").pop() ?? repo,
      events: [],
      snapshot: null,
    };
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

  app.post("/api/v1/cities/:id/push", (req, res) => {
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

    const blueprint: CityBlueprint = req.body;
    if (!blueprint || typeof blueprint !== "object" || !blueprint.v || !blueprint.stats || !blueprint.hash) {
      return res.status(400).json({ error: "schema_validation_error" });
    }

    apiKey.lastUsed = Date.now();

    const seq = city.events.length + 1;
    const event: EventRecord = {
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

  app.post("/api/v1/connections", (req, res) => {
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
    const id = nextId("conn");
    state.connections[id] = {
      id,
      world_id: from.world_id,
      from_city_id,
      to_city_id,
      label,
    };
    return res.status(201).json(state.connections[id]);
  });

  app.get("/api/v1/worlds/:id/connections", (req, res) => {
    const connections = Object.values(state.connections).filter((c) => c.world_id === req.params.id);
    return res.status(200).json(connections);
  });

  app.post("/api/v1/federation/links", (req, res) => {
    const { remote_server_url, remote_world_id, remote_world_name } = req.body ?? {};
    if (!remote_server_url) {
      return res.status(400).json({ error: "validation_error" });
    }
    const id = nextId("federation");
    state.federationLinks[id] = {
      id,
      remote_server_url,
      remote_world_id,
      remote_world_name,
      status: "pending",
    };
    return res.status(201).json(state.federationLinks[id]);
  });

  app.get("/api/v1/federation/links", (_req, res) => {
    return res.status(200).json(Object.values(state.federationLinks));
  });

  return app;
}

export function startServer(port = 3000) {
  const app = createApp();
  return app.listen(port);
}
