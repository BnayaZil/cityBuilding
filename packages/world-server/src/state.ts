import type { CityBlueprint, CitySummary, ChecksStatus } from "@city-building/shared";

export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  username: string;
  email?: string;
  password: string;
}

export interface TeamInvite {
  code: string;
  teamId: string;
  role: Role;
  uses: number;
  maxUses: number | null;
  expiresAt: number | null;
}

export interface ApiKeyRecord {
  id: string;
  key: string;
  teamId: string;
  cityIds: string[];
  revoked: boolean;
  lastUsed: number | null;
}

export interface Team {
  id: string;
  name: string;
  members: Record<string, Role>;
  invites: Record<string, TeamInvite>;
  apiKeys: Record<string, ApiKeyRecord>;
}

export interface EventRecord {
  seq: number;
  sha: string;
  blueprint_hash: string;
  source_type: string;
  blueprint: CityBlueprint;
  created_at: string;
}

export interface Snapshot {
  seq: number;
  blueprint_hash: string;
  checks_status: ChecksStatus;
  files_count: number;
  symbols_count: number;
  blueprint: CityBlueprint;
}

export interface CityRecord {
  id: string;
  world_id: string;
  team_id: string;
  repo: string;
  name: string;
  events: EventRecord[];
  snapshot: Snapshot | null;
}

export interface WorldRecord {
  id: string;
  name: string;
  description?: string;
  is_public: boolean;
}

export interface ConnectionRecord {
  id: string;
  world_id: string;
  from_city_id: string;
  to_city_id: string;
  label?: string;
}

export interface FederationLink {
  id: string;
  remote_server_url: string;
  remote_world_id?: string;
  remote_world_name?: string;
  status: "pending" | "active" | "rejected";
}

export interface MemoryState {
  users: Record<string, User>;
  teams: Record<string, Team>;
  worlds: Record<string, WorldRecord>;
  cities: Record<string, CityRecord>;
  connections: Record<string, ConnectionRecord>;
  federationLinks: Record<string, FederationLink>;
  meta: {
    next_id: number;
  };
}

export function createInitialState(): MemoryState {
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
    meta: {
      next_id: 1,
    },
  };
}

export function nextId(state: MemoryState, prefix: string): string {
  const value = `${prefix}-${state.meta.next_id}`;
  state.meta.next_id += 1;
  return value;
}

export function citySummary(city: CityRecord): CitySummary {
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
