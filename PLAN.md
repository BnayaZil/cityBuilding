# City Building — High-Level Technical Plan

> Turn any codebase into a living city. Services become buildings, features become floors,
> repos become cities, and the world is open for everyone to host.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Components](#3-components)
4. [Data Model](#4-data-model)
5. [Integrations](#5-integrations)
6. [Security](#6-security)
7. [Technical Decisions](#7-technical-decisions)
8. [Open-Source & Self-Hosting](#8-open-source--self-hosting)
9. [Phasing](#9-phasing)

---

## 1. Overview

### What It Is

A system that scans a codebase's structure (via AST), produces a deterministic
structural snapshot (CityBlueprint), and feeds it to a world server that any game
client can connect to and render as a city.

### Core Principles

| Principle | Meaning |
|---|---|
| **Deterministic data** | Same commit always produces the same blueprint. No heuristics in the data layer. |
| **Data ≠ rendering** | The scan output is a neutral, faithful representation. All visual/game decisions live in the client. |
| **No source code in transit** | Only structural metadata (file paths, symbol names, counts) ever leaves the repo. Never raw code. |
| **Minimal setup** | A single file (GitHub Action) or a single CLI command to get started. |
| **Open source / self-hostable** | Anyone can run their own world server. No vendor lock-in. |
| **Event sourced** | Every blueprint push is an immutable event. The city's history is preserved, enabling transitions and time-lapse. |

### Data Flow

```
Codebase ──► Scanner ──► CityBlueprint (JSON) ──► World Server ──► Game Client
                │                                       │               │
          (Rust binary,                          (stores events,   (polls for
           runs in CI                             serves latest     updates)
           or locally)                            + history)
```

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SOURCES                                    │
│                                                                     │
│  ┌──────────────────┐             ┌──────────────────┐              │
│  │  GitHub Action    │             │       CLI        │              │
│  │  (CI, automated)  │             │  (local, manual) │              │
│  └────────┬─────────┘             └────────┬─────────┘              │
│           │                                │                        │
│           └────────────┬───────────────────┘                        │
│                        │                                            │
│               ┌────────▼────────┐                                   │
│               │  Scanner Core   │                                   │
│               │    (Rust lib)   │                                   │
│               └────────┬────────┘                                   │
│                        │                                            │
│                CityBlueprint JSON                                   │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │  HTTPS POST
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│                       WORLD SERVER  (TypeScript)                    │
│                                                                     │
│  ┌───────────┐  ┌──────────┐  ┌───────────────┐  ┌─────────────┐  │
│  │  REST API  │  │   Auth   │  │  Event Store  │  │  Snapshots  │  │
│  │  (ingest   │  │ (API key │  │  (append-only │  │ (latest per │  │
│  │   + query) │  │  based)  │  │   blueprint   │  │   city)     │  │
│  │           │  │          │  │   history)    │  │             │  │
│  └───────────┘  └──────────┘  └───────────────┘  └─────────────┘  │
│                                                                     │
│  ┌────────────────┐  ┌──────────────────┐                          │
│  │  World / City   │  │  Federation      │                          │
│  │  Management     │  │  (world links)   │                          │
│  └────────────────┘  └──────────────────┘                          │
│                                                                     │
│                        PostgreSQL                                   │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         │  HTTPS (polling)
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│                       GAME CLIENT  (PixiJS)                         │
│                                                                     │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐     │
│  │  World Map   │  │ City Renderer │  │  Navigation / Search │     │
│  │  (all cities)│  │ (single city) │  │  (zoom, fly-to)      │     │
│  └──────────────┘  └───────────────┘  └──────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Scanner Core (Rust library)

**Responsibility:** Parse a codebase at a given path and produce a deterministic
`CityBlueprint` JSON.

**What it does:**
- Walk the file tree (respecting `.city.yml` ignore rules)
- Parse each file's AST using tree-sitter (native Rust bindings, zero-cost)
- Extract structural symbols: classes, functions, methods, interfaces, enums
- Extract import/dependency edges between files
- Collect aggregate stats: file counts per language, total symbol counts
- Output a single `CityBlueprint` JSON document

**What it does NOT do:**
- Read or transmit source code, string literals, or comments
- Make any visual/grouping/clustering decisions
- Diff against previous scans (stateless, full re-scan every time)

**Language:** Rust. tree-sitter is natively Rust — bindings are zero-cost.
Produces a single static binary with no runtime dependencies.

**Blueprint schema:** Defined in Rust using serde. TypeScript types are generated
from the Rust types (via `ts-rs` or a JSON Schema intermediary) for use in the
world server and game client.

**Supported languages (Phase 1):** TypeScript, JavaScript, Python, Java, Go, Rust, C#.
Adding a language = adding a tree-sitter grammar + a symbol extraction query file.

---

### 3.2 CLI

**Responsibility:** Scan codebases, manage accounts, configure world server
connectivity, and push blueprints. Designed to be fully operable by AI agents
(non-interactive mode for every command).

**Language:** Rust (wraps scanner core directly, single binary distribution).

**Commands:**

```
# Account management
city register --username <name> --email <email> --password <pass>
city login --username <name> --password <pass>
city logout
city whoami

# Setup & configuration
city init                               # create .city.yml in cwd
city config set server <url>            # set world server URL (has default)
city config set world <world-id>        # set active world
city config show                        # print current config

# Team management
city team create --name <name>          # create a team
city team list                          # list teams you belong to
city team invite create --team <id>     # generate a shareable invite link
city team invite list --team <id>       # list active invites
city team join <invite-code>            # join a team via invite code
city team members --team <id>           # list team members

# City management
city create --repo <owner/repo> --team <team-id>  # register a city (owned by team)
city api-key create --team <team-id>    # generate an API key (team-scoped)
city api-key list --team <team-id>      # list API keys
city api-key revoke <key-id>            # revoke an API key

# Scanning & pushing
city scan                               # scan cwd, output blueprint to stdout
city scan --out blueprint.json          # scan cwd, write to file
city push                               # scan + push to configured world server
city push --server <url>                # scan + push to a specific server

# Querying
city status                             # current city status on server
city worlds                             # list available worlds
city cities --world <world-id>          # list cities in a world
city history --city <city-id> --limit 5 # list recent blueprint events

# All commands support:
#   --json           JSON output for programmatic/AI-agent use
#   --server <url>   override world server URL
#   --non-interactive  never prompt, fail if input is missing
```

**Configuration file:** `~/.config/city-building/config.toml`

```toml
[server]
url = "https://world.city-building.dev"  # default public world server

[auth]
token = "..."  # stored after `city login`

[defaults]
world = "default"
```

---

### 3.3 GitHub Action

**Responsibility:** Run the scanner in CI on push to main and submit the result
to a world server.

**Setup cost:** One workflow file + one secret (`CITY_API_KEY`). No other
configuration required.

**Behavior:**
1. Triggers on `push` to the default branch (configurable).
2. Checks out the repo.
3. Downloads the pre-built scanner binary (from GitHub Releases).
4. Runs the scanner against the checkout.
5. Fetches GitHub Checks status for the current commit via the built-in `GITHUB_TOKEN`.
6. POSTs the `CityBlueprint` to the world server.

**Environment variables:**

| Variable | Required | Description |
|---|---|---|
| `CITY_API_KEY` | Yes | API key for authenticating with the world server |
| `WORLD_SERVER_URL` | No | Defaults to `https://world.city-building.dev` |

**No code leaves the runner.** The action produces metadata-only output and sends
only the blueprint JSON.

---

### 3.4 World Server

**Responsibility:** Receive, store (as events), and serve city blueprints.
Central hub that game clients poll for world state.

**Language:** TypeScript (Node.js). The server is CRUD + event store — not
performance-critical. TypeScript maximizes contributor accessibility for an open
source project.

**API surface:**

| Endpoint | Method | Purpose |
|---|---|---|
| **Auth** | | |
| `POST /api/v1/auth/register` | POST | Create a new account |
| `POST /api/v1/auth/login` | POST | Authenticate, receive token |
| **Worlds** | | |
| `GET /api/v1/worlds` | GET | List worlds on this server |
| `POST /api/v1/worlds` | POST | Create a new world |
| `GET /api/v1/worlds/:id` | GET | Get world metadata + city summaries for world rendering |
| **Cities** | | |
| `POST /api/v1/cities` | POST | Register a new city in a world |
| `GET /api/v1/cities/:id` | GET | Get city metadata + latest blueprint |
| `GET /api/v1/cities/:id/events` | GET | Get blueprint event history (paginated) |
| `GET /api/v1/cities/:id/events/:seq` | GET | Get a specific event by sequence number |
| **Blueprint push** | | |
| `POST /api/v1/cities/:id/push` | POST | Push a new CityBlueprint (creates an event) |
| **Connections** | | |
| `GET /api/v1/worlds/:id/connections` | GET | List inter-city connections in a world |
| `POST /api/v1/connections` | POST | Declare a connection between two cities |
| **Federation** | | |
| `GET /api/v1/federation/links` | GET | List linked remote worlds |
| `POST /api/v1/federation/links` | POST | Request a link to a remote world |
| **Teams** | | |
| `POST /api/v1/teams` | POST | Create a new team |
| `GET /api/v1/teams/:id` | GET | Get team info + members |
| `POST /api/v1/teams/:id/invites` | POST | Create an invite link |
| `POST /api/v1/teams/join/:code` | POST | Accept an invite |
| **Ops** | | |
| `GET /api/v1/health` | GET | Health check |

`GET /api/v1/worlds/:id` returns lightweight city summaries (not full blueprints)
so the world map can render scale/weather without per-city overfetch:

```json
{
  "id": "default",
  "name": "Default World",
  "cities": [
    {
      "id": "c1",
      "name": "payments",
      "repo": "acme/payments",
      "seq": 42,
      "blueprint_hash": "sha256:ab12...",
      "checks_status": "mixed",
      "files_count": 342,
      "symbols_count": 1580
    }
  ]
}
```

**Polling strategy:** There is no dedicated polling endpoint. Instead, regular GET
endpoints include `blueprint_hash` per city, plus lightweight render metadata
(`checks_status`, `files_count`, `symbols_count`, `seq`) in world responses.
The client polls whichever endpoint matches its current view, compares hashes with
its local cache, and fetches full blueprints only for cities whose hash has changed.

---

### 3.5 Game Client

**Responsibility:** Connect to a world server and render cities visually.

**Technology:** PixiJS (isometric 2D). The client is a web-based SPA. PixiJS
handles the canvas rendering. UI chrome (menus, search, info panels) is built
with React for UI chrome.

**Zoom levels:**

| Level | Shows | Triggered by |
|---|---|---|
| **World** | All cities as named icons on a map, sized by scale, weather overlay | Default view |
| **City** | Districts (top-level dirs) as neighborhoods with building clusters | Click a city |
| **District** | Individual buildings (files) with street layout (import edges) | Click a district |
| **Building** | Floors/rooms (symbols within a file) | Click a building |

**Rendering decisions (client-only, not in data):**
- Building appearance derived from language, symbol count, visibility distribution
- Road/street placement derived from import edges
- District layout algorithm (force-directed, grid, or organic)
- Density clustering when too many buildings are visible
- LOD (level of detail) at different zoom levels
- Weather effects from CI checks status
- Transition animations between blueprint events

**Deployment:** Served by the world server at `/`. The SPA is bundled into the
world server's Docker image.

---

## 4. Data Model

### 4.1 CityBlueprint (scanner output)

Compact, flat structure. Directories are implicit from file paths — no tree nesting.
Symbol depth is limited to two levels (top-level symbol + its members).

```jsonc
{
  "v": "1.0.0",
  "ts": "2026-03-11T14:30:00Z",
  "hash": "sha256:a3f2b8c1...",     // SHA-256 of the deterministic content (files + edges + stats)

  "source": {
    "type": "github-action",          // or "cli"
    "repo": "owner/repo-name",
    "sha": "a1b2c3d4e5f6",
    "branch": "main"
  },

  "checks": {                         // null if unavailable
    "status": "mixed",                // "success" | "failure" | "pending" | "mixed" | "unknown"
    "runs": [
      { "name": "tests", "conclusion": "success" },
      { "name": "lint", "conclusion": "failure" }
    ]
  },

  "stats": {
    "files": 342,
    "symbols": 1580,
    "langs": {
      "ts": 280,
      "py": 62
    }
  },

  "hints": {                           // validated rendering hints + optional extra keys
    "districts": [
      { "path": "src/services", "label": "Services District", "style": "commercial" }
    ]
  },

  "files": {
    "src/services/auth.service.ts": {
      "lang": "ts",
      "symbols": [
        {
          "name": "AuthService",
          "type": "class",
          "vis": "exported",
          "loc": { "startLine": 1, "endLine": 42 },
          "members": [
            { "name": "login", "type": "method", "vis": "public", "loc": { "startLine": 6, "endLine": 14 } },
            { "name": "logout", "type": "method", "vis": "public", "loc": { "startLine": 16, "endLine": 21 } },
            { "name": "hashPassword", "type": "method", "vis": "private", "loc": { "startLine": 23, "endLine": 31 } }
          ]
        }
      ]
    },
    "src/models/user.model.ts": {
      "lang": "ts",
      "symbols": [
        {
          "name": "UserModel",
          "type": "class",
          "vis": "exported",
          "members": [
            { "name": "id", "type": "variable", "vis": "public" },
            { "name": "email", "type": "variable", "vis": "public" }
          ]
        }
      ]
    },
    "src/utils/crypto.ts": {
      "lang": "ts",
      "symbols": [
        { "name": "hash", "type": "function", "vis": "exported", "loc": { "startLine": 3, "endLine": 9 }, "members": [] },
        { "name": "verify", "type": "function", "vis": "exported", "loc": { "startLine": 11, "endLine": 18 }, "members": [] }
      ]
    }
  },

  "edges": [
    ["src/services/auth.service.ts", "src/models/user.model.ts"],
    ["src/services/auth.service.ts", "src/utils/crypto.ts"]
  ]
}
```

### 4.1.1 CitySummary (world-list projection)

`GET /api/v1/worlds/:id` returns a summary per city derived from each city's latest
snapshot. This keeps world view responses small while still carrying everything
needed for world-map rendering.

```jsonc
{
  "id": "c1",
  "name": "payments",
  "repo": "acme/payments",
  "seq": 42,
  "blueprint_hash": "sha256:ab12...",
  "checks_status": "mixed",   // derived from blueprint.checks.status, default "unknown"
  "files_count": 342,         // derived from blueprint.stats.files
  "symbols_count": 1580       // derived from blueprint.stats.symbols
}
```

### 4.2 Symbol Types

| Symbol type | Examples |
|---|---|
| `class` | `class AuthService`, `class UserModel` |
| `function` | `function handleRequest()`, `def process()` |
| `method` | Class methods (always a member of a class) |
| `interface` | `interface User`, `type Props` (TS) |
| `enum` | `enum Status` |
| `variable` | `const config`, `export const API_URL` |

Visibility: `exported`, `public`, `private`, `protected`, `internal`.

Optional source-location metadata can be attached to symbols and members:
`loc.startLine`, `loc.endLine`.

The scanner does NOT interpret what a symbol "means" (service vs. helper).
That is a rendering-layer decision.

### 4.3 .city.yml (optional user config)

```yaml
version: 1

ignore:
  - node_modules
  - dist
  - build
  - coverage
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/__tests__/**"

# Rendering hints copied into the blueprint for the client.
# The scanner validates minimal shape and preserves extra keys.
hints:
  districts:
    - path: src/services
      label: "Services District"
      style: commercial
    - path: src/utils
      label: "Utilities Quarter"
      style: residential
    - path: src/models
      label: "Data Warehouses"
      style: industrial
```

Rendering hint contract (v1):
- `hints.districts[].path` is required and must match a directory prefix.
- `hints.districts[].label` is optional display text.
- `hints.districts[].style` is optional (`commercial` | `residential` | `industrial`).
- Unknown keys are preserved and ignored by the default renderer.

### 4.4 Database Schema (PostgreSQL)

```sql
-- ============================================================
-- WORLDS
-- A world is a container for cities. Each world server can host
-- multiple worlds. A single "default" world is created on first boot.
-- ============================================================

CREATE TABLE worlds (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    is_public   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS & AUTH
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TEAMS
-- Teams own cities. Users belong to teams. API keys are team-scoped.
-- ============================================================

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',  -- "owner" | "admin" | "member"
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE team_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    code        TEXT UNIQUE NOT NULL,            -- shareable invite code
    created_by  UUID NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL DEFAULT 'member',  -- role assigned on accept
    max_uses    INTEGER,                         -- null = unlimited
    uses        INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,                     -- null = never
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- API KEYS (team-scoped)
-- ============================================================

CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id),
    created_by  UUID NOT NULL REFERENCES users(id),
    key_hash    TEXT NOT NULL,
    label       TEXT,
    city_ids    UUID[],         -- scoped to specific cities (empty = all team's cities)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ
);

-- ============================================================
-- CITIES
-- A city represents one repository within a world. Owned by a team.
-- ============================================================

CREATE TABLE cities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id    UUID NOT NULL REFERENCES worlds(id),
    team_id     UUID NOT NULL REFERENCES teams(id),
    repo        TEXT NOT NULL,           -- "owner/repo-name"
    name        TEXT NOT NULL,           -- display name
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(world_id, repo)
);

-- ============================================================
-- BLUEPRINT EVENTS (append-only event store)
-- Every push creates a new immutable event. This is the source
-- of truth. Never updated or deleted.
-- ============================================================

CREATE TABLE blueprint_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id         UUID NOT NULL REFERENCES cities(id),
    seq             BIGINT NOT NULL,         -- monotonic per city, used for ordering
    sha             TEXT NOT NULL,           -- commit sha
    blueprint_hash  TEXT NOT NULL,           -- SHA-256 of blueprint content (for cache invalidation)
    source_type     TEXT NOT NULL,           -- "github-action" | "cli"
    blueprint       JSONB NOT NULL,          -- the full CityBlueprint
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(city_id, seq)
);

CREATE INDEX idx_blueprint_events_city_seq ON blueprint_events(city_id, seq DESC);

-- ============================================================
-- CITY SNAPSHOTS (materialized latest state)
-- Denormalized for fast reads. Updated via trigger or
-- application logic after each event insert.
-- ============================================================

CREATE TABLE city_snapshots (
    city_id         UUID PRIMARY KEY REFERENCES cities(id),
    event_id        UUID NOT NULL REFERENCES blueprint_events(id),
    seq             BIGINT NOT NULL,
    blueprint_hash  TEXT NOT NULL,       -- for polling: client compares hashes to detect changes
    checks_status   TEXT NOT NULL DEFAULT 'unknown', -- derived from blueprint.checks.status
    files_count     INTEGER NOT NULL DEFAULT 0,      -- derived from blueprint.stats.files
    symbols_count   INTEGER NOT NULL DEFAULT 0,      -- derived from blueprint.stats.symbols
    blueprint       JSONB NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INTER-CITY CONNECTIONS
-- Represent cross-repo dependencies (roads/bridges between cities).
-- ============================================================

CREATE TABLE connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id        UUID NOT NULL REFERENCES worlds(id),
    from_city_id    UUID NOT NULL REFERENCES cities(id),
    to_city_id      UUID NOT NULL REFERENCES cities(id),
    label           TEXT,
    declared_by     UUID NOT NULL REFERENCES cities(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(world_id, from_city_id, to_city_id)
);

-- ============================================================
-- WORLD FEDERATION
-- Links between world servers. A world server can link to
-- remote world servers to create a federated network of worlds.
-- ============================================================

CREATE TABLE world_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_world_id      UUID NOT NULL REFERENCES worlds(id),
    remote_server_url   TEXT NOT NULL,       -- base URL of the remote world server
    remote_world_id     UUID,               -- world ID on the remote server
    remote_world_name   TEXT,               -- cached name for display
    status              TEXT NOT NULL DEFAULT 'pending',  -- pending | active | rejected
    linked_at           TIMESTAMPTZ,        -- when the link became active
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    city_id     UUID REFERENCES cities(id),
    world_id    UUID REFERENCES worlds(id),
    action      TEXT NOT NULL,           -- e.g. "blueprint.pushed", "city.created"
    source_type TEXT,
    metadata    JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_city ON audit_log(city_id, created_at DESC);
```

### 4.5 Event Sourcing — How It Works

**On push:**
1. Scanner produces a full `CityBlueprint` snapshot.
2. World server receives it via `POST /api/v1/cities/:id/push`.
3. Server assigns the next `seq` number for this city.
4. Server inserts an immutable row into `blueprint_events`.
5. Server upserts `city_snapshots` with the latest event and derived summary fields
   (`checks_status`, `files_count`, `symbols_count`).

**On read (game client):**
- **Current state:** `GET /api/v1/cities/:id` → reads from `city_snapshots` (fast).
- **History:** `GET /api/v1/cities/:id/events?from_seq=N&limit=10` → reads from `blueprint_events`.
- **Polling:** Client polls whichever GET endpoint matches its current view (e.g.,
  `GET /api/v1/worlds/:id` for the world map). The response includes each city's
  `blueprint_hash` plus lightweight render fields (`checks_status`, `files_count`,
  `symbols_count`, `seq`). Client compares hashes with local cache and only fetches
  full blueprints for cities that changed.

**What this enables:**
- Time-lapse: replay city growth from first event to latest.
- Transitions: client diffs two sequential blueprints to animate what changed.
- Rollback visibility: see what the city looked like at any point.
- Audit: every state change is recorded with timestamp, commit sha, source type.

**Retention:** World server operators can configure retention policies (e.g., keep
last 100 events per city, or events from the last 90 days). The `city_snapshots`
table always holds the latest regardless of retention.

### 4.6 Federation Data Flow

```
┌───────────────────┐              ┌───────────────────┐
│  World Server A    │              │  World Server B    │
│                    │   link       │                    │
│  World: "acme"     │◄────────────►│  World: "widgets"  │
│  Cities: [a,b,c]   │              │  Cities: [x,y,z]   │
└───────────────────┘              └───────────────────┘
         │                                   │
         └──────────────┬────────────────────┘
                        │
                  Game Client sees:
                  "acme" world with cities [a,b,c]
                  linked to "widgets" world [x,y,z]
                  (navigable as connected regions)
```

When a game client connects to World Server A and World A has an active link to
World Server B, the client can:
1. See linked worlds as remote regions on the world map.
2. Fetch city data from World Server B directly (the client talks to both servers).
3. The link is just a pointer — no data is replicated between servers.

---

## 5. Integrations

### 5.1 GitHub Action (Primary)

**User setup:**
1. Run `city register` + `city login` + `city create --repo owner/repo` + `city api-key create`.
   (All via CLI. Can be done non-interactively by an AI agent.)
2. Add `CITY_API_KEY` to the repo's GitHub Actions secrets.
3. Copy the workflow file into `.github/workflows/`.

**Workflow file:**

```yaml
name: City Building Sync
on:
  push:
    branches: [main]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: city-building/sync-action@v1
        with:
          api_key: ${{ secrets.CITY_API_KEY }}
          # server_url: https://world.city-building.dev  (default)
```

**What the action does internally:**
1. Downloads the pre-built scanner binary from GitHub Releases.
2. Runs the scanner against the checked-out code.
3. Fetches GitHub Checks status for the current SHA via the built-in `GITHUB_TOKEN`.
4. Injects the checks data into the blueprint.
5. POSTs the blueprint to the world server, authenticated with the API key.

### 5.2 CLI (Secondary)

Setup is covered in section 3.2. The CLI uses the same scanner binary and produces
the same blueprint format. The only difference is `source.type` = `"cli"` instead
of `"github-action"`.

### 5.3 Inter-City Connections (Phase 2)

Connections between cities are declared explicitly, not auto-detected.
A user or CI process calls:

```
POST /api/v1/connections
{
  "from_city_id": "<this-city>",
  "to_city_id": "<dependency-city>",
  "label": "shared-auth-lib"
}
```

Auto-detection from `package.json`, `go.mod`, etc. is a future enhancement.

---

## 6. Security

### 6.1 Approach

**Data integrity is a social contract, not a technical guarantee.**

There is no way to cryptographically prove that a blueprint accurately represents
a real codebase without the world server scanning the code itself — which would
require source code access and contradict the project's principles.

Therefore:
- **No trust tiers.** No OIDC tokens. No signed payloads.
- **API keys for authorization** — controls who can push to which city.
- **`source_type` is informational** — tells you where the blueprint came from
  (`github-action` vs `cli`), but does not imply higher or lower trust.
- If competitive gamification requires verified data in the future, server-side
  scanning can be introduced as a separate opt-in feature (Phase 3+).

### 6.2 What Is Protected

| Concern | Mitigation |
|---|---|
| **Who can push** | API keys scoped to teams and their cities. Only team members with appropriate roles can push. |
| **Key storage** | Keys are bcrypt-hashed in the database. Plaintext is shown once on creation and never stored. |
| **Key rotation** | Keys can be revoked and regenerated via CLI or API. |
| **Rate limiting** | Per-key rate limits on the push endpoint. |
| **Blueprint size** | Max payload size enforced (configurable, default 5MB). |
| **Unauthorized reads** | Worlds can be set to `is_public: false`. Non-public worlds require authentication to read. |

### 6.3 What Is NOT Sent (explicit guarantees)

The CityBlueprint schema explicitly excludes:
- File contents / source code
- String literals, comments, or documentation
- Environment variables or secrets
- Git history, diffs, or blame data
- Personally identifiable information (no author names/emails)

The only potentially identifying data is **file paths** and **symbol names**
(function/class names). The `.city.yml` ignore list can exclude sensitive paths.

### 6.4 Self-Hosting as a Security Boundary

Users who do not want to send any metadata to a third-party server can run their
own world server. The CLI supports pointing to any server URL. In the extreme case,
a user can scan locally (`city scan`) and never push to any server at all.

---

## 7. Technical Decisions

### 7.1 Language & Runtime

| Component | Language | Rationale |
|---|---|---|
| Scanner Core | Rust | tree-sitter is natively Rust (zero-cost bindings). Single static binary, no runtime deps. Performance and safety for AST parsing of large codebases. |
| CLI | Rust | Wraps scanner core directly. Single binary distribution via `cargo install` or pre-built releases. |
| GitHub Action | Shell + Rust binary | Downloads pre-built scanner binary. Thin shell wrapper around `city push`. |
| World Server | TypeScript (Node.js) | CRUD + event store — not perf-critical. TypeScript maximizes contributor accessibility for open source. Large ecosystem for HTTP, DB, auth. |
| Game Client | TypeScript + PixiJS | Web-based isometric 2D city rendering. PixiJS for canvas, React for UI chrome. |

### 7.2 Schema Sharing

The `CityBlueprint` schema is the canonical contract between components.

- **Defined in Rust** using serde + a schema generation crate.
- **Exported as JSON Schema** from the Rust crate.
- **TypeScript types generated** from the JSON Schema (via `json-schema-to-typescript`
  or similar) for use in the world server and game client.
- Single source of truth — change the Rust struct, regenerate downstream types.

### 7.3 Monorepo Structure

```
city-building/
├── crates/
│   ├── scanner-core/           # Rust library: AST scanning, blueprint generation
│   ├── cli/                    # Rust binary: CLI wrapper around scanner-core
│   └── schema/                 # Rust: CityBlueprint types, serde, JSON Schema export
├── packages/
│   ├── world-server/           # TypeScript: World server application
│   ├── client/                 # TypeScript + PixiJS: Game client SPA
│   ├── github-action/          # GitHub Action wrapper
│   └── shared/                 # TypeScript: generated types, shared utilities
├── .city.yml                   # Dogfood: scan ourselves
├── Cargo.toml                  # Rust workspace root
├── package.json                # Node.js workspace root
└── docker-compose.yml
```

### 7.4 AST Parsing (tree-sitter)

- tree-sitter grammars loaded at runtime from bundled `.so`/`.dylib` files or
  compiled into the binary.
- One query file per language (`queries/typescript.scm`, `queries/python.scm`, etc.)
  defines what symbols to extract.
- Adding a new language:
  1. Add the tree-sitter grammar as a Rust dependency.
  2. Write a `.scm` query file for symbol extraction.
  3. Register the language in the scanner's language registry.

### 7.5 Database

**PostgreSQL** as the sole supported database.

Rationale:
- JSONB for efficient blueprint storage and querying.
- Strong support for append-only event patterns (`BIGSERIAL`, efficient range queries).
- Array types for API key scoping (`UUID[]`).
- Mature, well-understood, good tooling.
- Docker makes it trivial to run for self-hosting.

### 7.6 Game Client — PixiJS Isometric 2D

- **PixiJS** for canvas rendering (sprites, tilemaps, camera, particles for weather).
- **Isometric projection** for the city view — achievable with sprite assets,
  no 3D engine needed.
- **React** for UI chrome (search bar, info panels, toolbar) overlaid on the canvas.
- **Polling interval:** Configurable, default every 30 seconds. Polls the current
  view's GET endpoint and compares `blueprint_hash` values to detect changes.

---

## 8. Open-Source & Self-Hosting

### 8.1 Default Public World Server

A public world server is hosted at `https://world.city-building.dev` (or similar).
This is the default `WORLD_SERVER_URL` for all CLI commands and the GitHub Action.
Users can use it immediately without running their own server.

### 8.2 Self-Hosting

```bash
# Option A: Docker Compose (recommended)
git clone https://github.com/city-building/city-building
cd city-building
docker compose up    # starts PostgreSQL + world server + client

# Option B: Docker (server only, bring your own PostgreSQL)
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/citybuilding \
  city-building/world-server

# Option C: From source
cd packages/world-server
npm install
npm run start
```

### 8.3 World Server Configuration

```yaml
# world-server.config.yml
server:
  port: 3000
  host: 0.0.0.0
  base_url: https://my-world.example.com  # public URL, used for federation

database:
  url: postgres://user:pass@localhost:5432/citybuilding

defaults:
  world_name: "My World"                   # name of the auto-created default world

limits:
  max_blueprint_size_kb: 5120              # 5MB max per push
  rate_limit_per_key: 60                   # pushes per hour per API key
  max_cities_per_world: 1000
  event_retention_days: 365                # how long to keep blueprint events

cors:
  allowed_origins:
    - "*"

federation:
  enabled: true
```

### 8.4 License

**Apache 2.0.** Permissive, patent-grant included, compatible with corporate use.
No barrier to adoption or contribution.

---

## 9. Phasing

### Phase 1 — Core Loop

> Scan a repo, push a blueprint, see a city.

- [ ] `scanner-core` Rust crate: file tree walking + tree-sitter AST extraction
- [ ] `schema` Rust crate: CityBlueprint types + JSON Schema export
- [ ] TypeScript type generation from JSON Schema
- [ ] `.city.yml` config support (ignore rules + hints pass-through)
- [ ] CLI: `city scan`, `city push`, `city config`, `city register`, `city login`,
      `city create`, `city api-key`, `city team` (full setup flow, AI-agent operable)
- [ ] GitHub Action: scan on push to main, include checks status, push to server
- [ ] World Server: REST API, PostgreSQL event store, API key auth, team management
- [ ] Game Client: PixiJS isometric rendering, single city view with zoom levels,
      CI weather display, world map (list of cities), served by world server at `/`
- [ ] Blueprint hashing for cache invalidation and polling
- [ ] Default public world server deployment
- [ ] Docker Compose for self-hosting

### Phase 2 — Multi-City, Connections & VS Code

> Multiple repos in a world, inter-city connections, history, IDE integration.

- [ ] Inter-city connections (explicit declaration via API/CLI)
- [ ] World map rendering (cities as nodes, connections as edges)
- [ ] Blueprint history navigation (time-lapse, event browser)
- [ ] Transition animations between blueprint states
- [ ] VS Code extension (WebView panel embedding the SPA renderer)
- [ ] World federation (linking world servers)
- [ ] Private worlds (authentication required to view)
- [ ] Additional language support for scanner

### Phase 3 — Gamification & Ecosystem

> Make it a game, not just a visualizer.

- [ ] Gamification layer (TBD: Travian-style, achievements, scores, combat)
- [ ] GitLab / Bitbucket CI integration
- [ ] Custom city themes / rendering styles
- [ ] Server-side scanning mode (opt-in, for verified competitive data)

---

*This is a living document. Sections marked TBD will be refined as design decisions are made.*
