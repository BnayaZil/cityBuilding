# City Building — Test Cases

> Test cases organized by component. Each case includes a description,
> preconditions where relevant, and expected outcome.

---

## Table of Contents

1. [Scanner Core](#1-scanner-core)
2. [CLI](#2-cli)
3. [GitHub Action](#3-github-action)
4. [World Server](#4-world-server)
5. [Game Client — Renderer](#5-game-client--renderer)
6. [Game Client — SPA Shell](#6-game-client--spa-shell)

---

## 1. Scanner Core

### 1.1 File Tree Walking

| # | Case | Input | Expected |
|---|---|---|---|
| 1.1.1 | Empty directory | Dir with no files | Valid blueprint: `files` is `{}`, `edges` is `[]`, `stats.files` is `0` |
| 1.1.2 | Single file | Dir with one `.ts` file | Blueprint has one entry in `files`, correct `lang`, correct path |
| 1.1.3 | Nested directories | `src/a/b/c/file.ts` | File path in blueprint is `src/a/b/c/file.ts` (relative, no leading slash) |
| 1.1.4 | Multiple languages | `.ts`, `.py`, `.rs` files | Each file has correct `lang`, `stats.langs` counts match |
| 1.1.5 | Ignore rules from .city.yml | `.city.yml` ignores `node_modules` and `**/*.test.*` | Ignored files do not appear in `files` or `edges` |
| 1.1.6 | No .city.yml present | Dir without config | Scanner uses sensible defaults (no ignores), produces valid blueprint |
| 1.1.7 | Binary files skipped | Dir contains `.png`, `.wasm`, `.exe` | Binary files are not in `files` |
| 1.1.8 | Symlinks | Symlink to a file or directory | Symlinks are not followed (avoid infinite loops) |
| 1.1.9 | Hidden files/dirs | `.env`, `.github/` | Hidden files are included unless explicitly ignored in `.city.yml` |
| 1.1.10 | Very deep nesting | 20+ levels of directories | Scanner does not crash, paths are correctly represented |
| 1.1.11 | Empty files | Zero-byte `.ts` file | File appears in `files` with `symbols: []` |
| 1.1.12 | Large directory | Dir with 10,000+ files | Completes within reasonable time, produces valid blueprint |

### 1.2 AST Symbol Extraction

| # | Case | Input | Expected |
|---|---|---|---|
| 1.2.1 | Exported class | `export class Foo {}` | Symbol: `{ name: "Foo", type: "class", vis: "exported", members: [] }` |
| 1.2.2 | Class with methods | `class Foo { bar() {} baz() {} }` | Class symbol with two method members |
| 1.2.3 | Public/private methods | `public login() {} private hash() {}` | Correct `vis` on each member |
| 1.2.4 | Exported function | `export function handle() {}` | `{ name: "handle", type: "function", vis: "exported", members: [] }` |
| 1.2.5 | Non-exported function | `function helper() {}` | `vis` is `"private"` or `"internal"` |
| 1.2.6 | Interface | `export interface User { id: string }` | `{ name: "User", type: "interface", vis: "exported" }` |
| 1.2.7 | Enum | `export enum Status { Active, Inactive }` | `{ name: "Status", type: "enum", vis: "exported" }` |
| 1.2.8 | Exported variable | `export const API_URL = "..."` | `{ name: "API_URL", type: "variable", vis: "exported" }` |
| 1.2.9 | Multiple symbols per file | File with a class, a function, and a variable | All three appear in `symbols` array |
| 1.2.10 | Python class | `class AuthService:` with `def login(self):` | Class with method member, correct types |
| 1.2.11 | Python function | `def process():` at module level | `{ type: "function" }` |
| 1.2.12 | Go exported func | `func HandleRequest()` (uppercase) | `vis: "exported"` |
| 1.2.13 | Go unexported func | `func helperFunc()` (lowercase) | `vis: "private"` |
| 1.2.14 | Rust pub struct | `pub struct Config {}` | `{ type: "class", vis: "exported" }` |
| 1.2.15 | Rust impl methods | `impl Config { pub fn new() {} fn validate() {} }` | Correct vis per method |
| 1.2.16 | Java class | `public class UserService {}` | Correct extraction with visibility |
| 1.2.17 | C# class | `public class PaymentController {}` | Correct extraction with visibility |
| 1.2.18 | Syntax error in file | File with invalid syntax | Scanner does not crash, file is either skipped or has `symbols: []` |
| 1.2.19 | Two-level depth limit | Class → method → inner function | Only class and its direct methods are extracted (no 3rd level) |
| 1.2.20 | Arrow functions (TS) | `export const handler = () => {}` | Extracted as `variable` with `vis: "exported"` |
| 1.2.21 | Symbol location metadata | Valid file with symbols | Symbol/member `loc` is present when enabled and contains valid `startLine` / `endLine` |
| 1.2.22 | Symbol location optional | Parser/location extraction unavailable | Symbol remains valid without `loc`; schema still passes |

### 1.3 Import Edge Extraction

| # | Case | Input | Expected |
|---|---|---|---|
| 1.3.1 | TS named import | `import { Foo } from './bar'` | Edge: `["current.ts", "bar.ts"]` |
| 1.3.2 | TS default import | `import Foo from './bar'` | Edge: `["current.ts", "bar.ts"]` |
| 1.3.3 | TS re-export | `export { Foo } from './bar'` | Edge: `["current.ts", "bar.ts"]` |
| 1.3.4 | Python import | `from services.auth import AuthService` | Edge to resolved file path |
| 1.3.5 | Go import | `import "myproject/pkg/utils"` | Edge to resolved package path |
| 1.3.6 | Rust use | `use crate::models::user;` | Edge to resolved module path |
| 1.3.7 | Circular import | A imports B, B imports A | Both edges present, no crash |
| 1.3.8 | External package import | `import React from 'react'` | No edge (external packages are not in `files`) |
| 1.3.9 | Self-import | File imports from itself | No edge created (or self-edge is filtered) |
| 1.3.10 | Multiple imports same file | Two import statements from same target | Single edge (deduplicated) |
| 1.3.11 | Dynamic import | `const m = await import('./lazy')` | Edge extracted (best-effort for dynamic imports) |
| 1.3.12 | Ignored file as target | Import points to an ignored file | No edge (target not in `files`) |

### 1.4 Blueprint Integrity

| # | Case | Input | Expected |
|---|---|---|---|
| 1.4.1 | Deterministic output | Same directory scanned twice | Byte-identical JSON output both times |
| 1.4.2 | Deterministic hash | Same directory scanned twice | Identical `hash` field |
| 1.4.3 | Hash changes on content change | Add a function, re-scan | `hash` is different |
| 1.4.4 | Hash ignores non-deterministic fields | Different `ts` (timestamp) | `hash` is computed from `files` + `edges` + `stats` only, not `ts` or `source` |
| 1.4.5 | Version field present | Any scan | `v` is `"1.0.0"` |
| 1.4.6 | Timestamp field present | Any scan | `ts` is a valid ISO 8601 timestamp |
| 1.4.7 | Stats are accurate | 5 `.ts` files, 3 `.py` files | `stats.files` is `8`, `stats.langs.ts` is `5`, `stats.langs.py` is `3` |
| 1.4.8 | Stats symbol count | 10 total symbols across all files | `stats.symbols` is `10` |
| 1.4.9 | Hints contract + passthrough | `.city.yml` has `hints.districts` and extra keys | Required hint fields are validated (`path`), known fields preserved, unknown keys preserved |
| 1.4.10 | No source code in output | Any scan | No field in the JSON contains raw source code, string literals, or comments |
| 1.4.11 | Valid JSON output | Any scan | Output parses as valid JSON |
| 1.4.12 | Schema compliance | Any scan | Output validates against the CityBlueprint JSON Schema |
| 1.4.13 | Invalid district hint rejected | `.city.yml` has `hints.districts` entry without `path` | Scanner fails with a clear validation error |

---

## 2. CLI

### 2.1 Scanning

| # | Case | Precondition | Command | Expected |
|---|---|---|---|---|
| 2.1.1 | Scan to stdout | In a project dir | `city scan` | Valid blueprint JSON printed to stdout |
| 2.1.2 | Scan to file | In a project dir | `city scan --out bp.json` | File `bp.json` created with valid blueprint |
| 2.1.3 | Scan empty dir | In an empty dir | `city scan` | Valid blueprint with zero files |
| 2.1.4 | Scan with .city.yml | `.city.yml` exists | `city scan` | Ignore rules and hints are respected |
| 2.1.5 | Scan non-existent dir | N/A | `city scan --path /nonexistent` | Clear error message, non-zero exit code |

### 2.2 Authentication

| # | Case | Precondition | Command | Expected |
|---|---|---|---|---|
| 2.2.1 | Register | Server running | `city register --username u --email e --password p` | Account created, success message |
| 2.2.2 | Register duplicate username | Username taken | `city register --username existing ...` | Error: username already taken |
| 2.2.3 | Login | Account exists | `city login --username u --password p` | Token stored in config, success message |
| 2.2.4 | Login wrong password | Account exists | `city login --username u --password wrong` | Error: invalid credentials |
| 2.2.5 | Logout | Logged in | `city logout` | Token removed from config |
| 2.2.6 | Whoami | Logged in | `city whoami` | Prints username and email |
| 2.2.7 | Whoami not logged in | No token | `city whoami` | Error: not logged in |

### 2.3 Team Management

| # | Case | Precondition | Command | Expected |
|---|---|---|---|---|
| 2.3.1 | Create team | Logged in | `city team create --name "My Team"` | Team created, ID returned |
| 2.3.2 | List teams | Member of 2 teams | `city team list` | Both teams listed |
| 2.3.3 | Create invite | Team owner | `city team invite create --team <id>` | Invite code returned |
| 2.3.4 | Create invite not owner | Team member (not owner/admin) | `city team invite create --team <id>` | Error: insufficient permissions |
| 2.3.5 | Join via invite | Valid invite code | `city team join <code>` | User added as member |
| 2.3.6 | Join expired invite | Expired invite code | `city team join <code>` | Error: invite expired |
| 2.3.7 | Join maxed-out invite | Invite with `max_uses` reached | `city team join <code>` | Error: invite has no remaining uses |
| 2.3.8 | List members | Team member | `city team members --team <id>` | All members listed with roles |

### 2.4 City Management

| # | Case | Precondition | Command | Expected |
|---|---|---|---|---|
| 2.4.1 | Create city | Team exists | `city create --repo owner/repo --team <id>` | City created, ID returned |
| 2.4.2 | Create duplicate city | Same repo in same world | `city create --repo owner/repo --team <id>` | Error: city already exists for this repo |
| 2.4.3 | Create API key | City exists, team member | `city api-key create --team <id>` | Key plaintext shown once |
| 2.4.4 | List API keys | Keys exist | `city api-key list --team <id>` | Keys listed (no plaintext, only labels and IDs) |
| 2.4.5 | Revoke API key | Key exists | `city api-key revoke <key-id>` | Key revoked, no longer usable |

### 2.5 Push

| # | Case | Precondition | Command | Expected |
|---|---|---|---|---|
| 2.5.1 | Push to server | Logged in, city configured | `city push` | Scans, pushes, success message with seq number |
| 2.5.2 | Push with custom server | N/A | `city push --server https://other.server` | Push goes to specified server |
| 2.5.3 | Push without API key | No key configured | `city push` | Error: no API key configured |
| 2.5.4 | Push to non-existent city | Wrong city config | `city push` | Error: city not found |
| 2.5.5 | Push with invalid API key | Revoked key | `city push` | Error: unauthorized |

### 2.6 Output Modes

| # | Case | Command | Expected |
|---|---|---|---|
| 2.6.1 | JSON output | `city team list --json` | Machine-parseable JSON array |
| 2.6.2 | JSON output on error | `city login --username bad --password bad --json` | JSON error object with code and message |
| 2.6.3 | Non-interactive mode | `city register --non-interactive` (missing params) | Fails with error, does not prompt |
| 2.6.4 | Default human output | `city team list` | Formatted table or list for terminal |

### 2.7 Configuration

| # | Case | Command | Expected |
|---|---|---|---|
| 2.7.1 | Set server URL | `city config set server https://custom.url` | Config file updated |
| 2.7.2 | Set world | `city config set world my-world` | Config file updated |
| 2.7.3 | Show config | `city config show` | Prints current server, world, auth status |
| 2.7.4 | Init .city.yml | `city init` | Creates `.city.yml` with sensible defaults |
| 2.7.5 | Init when exists | `.city.yml` already exists | Error or prompt to overwrite |

---

## 3. GitHub Action

### 3.1 Workflow Execution

| # | Case | Precondition | Expected |
|---|---|---|---|
| 3.1.1 | Successful sync | Push to main, secrets configured | Action runs, scans, pushes to server, step succeeds |
| 3.1.2 | Branch filter | Push to non-main branch | Action does not trigger |
| 3.1.3 | Custom branch config | Workflow configured for `develop` | Triggers on push to `develop` only |

### 3.2 Scanner Binary

| # | Case | Precondition | Expected |
|---|---|---|---|
| 3.2.1 | Binary download | GitHub Releases has binary | Downloads correct binary for `ubuntu-latest` runner |
| 3.2.2 | Binary not found | Release missing | Action fails with clear error |
| 3.2.3 | Binary runs | Downloaded binary | Scanner executes and produces valid blueprint |

### 3.3 Checks Status

| # | Case | Precondition | Expected |
|---|---|---|---|
| 3.3.1 | All checks passing | Other workflows succeeded | Blueprint `checks.status` is `"success"` |
| 3.3.2 | Some checks failing | Mixed results | Blueprint `checks.status` is `"mixed"`, runs list is accurate |
| 3.3.3 | No other checks | Only this workflow exists | Blueprint `checks` is `null` or `"unknown"` |
| 3.3.4 | Checks still running | Concurrent workflows in progress | Blueprint `checks.status` is `"pending"` |

### 3.4 Server Communication

| # | Case | Precondition | Expected |
|---|---|---|---|
| 3.4.1 | Push succeeds | Server is up, valid API key | Blueprint posted, action succeeds |
| 3.4.2 | Missing CITY_API_KEY | Secret not set | Action fails with clear error about missing secret |
| 3.4.3 | Invalid API key | Wrong key in secret | Action fails with auth error |
| 3.4.4 | Server unreachable | Server is down | Action fails with connection error |
| 3.4.5 | Default server URL | `WORLD_SERVER_URL` not set | Uses default `https://world.city-building.dev` |
| 3.4.6 | Custom server URL | `WORLD_SERVER_URL` set to custom | Uses the custom URL |

---

## 4. World Server

### 4.1 Auth

| # | Case | Request | Expected |
|---|---|---|---|
| 4.1.1 | Register | `POST /auth/register` with valid body | 201, user created, token returned |
| 4.1.2 | Register duplicate email | Same email twice | 409, conflict error |
| 4.1.3 | Register duplicate username | Same username twice | 409, conflict error |
| 4.1.4 | Register missing fields | Missing `username` | 400, validation error |
| 4.1.5 | Login | `POST /auth/login` with valid credentials | 200, token returned |
| 4.1.6 | Login wrong password | Invalid password | 401, unauthorized |
| 4.1.7 | Login non-existent user | Unknown username | 401, unauthorized (no user enumeration) |
| 4.1.8 | Auth token validation | Valid token in `Authorization` header | Request proceeds |
| 4.1.9 | Expired token | Expired JWT | 401, unauthorized |
| 4.1.10 | Missing token on protected route | No `Authorization` header | 401, unauthorized |

### 4.2 Teams

| # | Case | Request | Expected |
|---|---|---|---|
| 4.2.1 | Create team | `POST /teams` with name | 201, team created, creator is owner |
| 4.2.2 | Get team | `GET /teams/:id` by member | 200, team info + member list |
| 4.2.3 | Get team by non-member | `GET /teams/:id` by outsider | 403, forbidden |
| 4.2.4 | Create invite (owner) | `POST /teams/:id/invites` by owner | 201, invite code returned |
| 4.2.5 | Create invite (admin) | `POST /teams/:id/invites` by admin | 201, invite code returned |
| 4.2.6 | Create invite (member) | `POST /teams/:id/invites` by member | 403, insufficient role |
| 4.2.7 | Join team | `POST /teams/join/:code` with valid code | 200, user added as member |
| 4.2.8 | Join already member | Same user joins again | 409, already a member |
| 4.2.9 | Join expired invite | Invite past `expires_at` | 410, invite expired |
| 4.2.10 | Join maxed invite | `uses >= max_uses` | 410, invite exhausted |
| 4.2.11 | Join increments uses | Valid join | `uses` incremented by 1 |
| 4.2.12 | Join assigns role | Invite has `role: "admin"` | New member gets admin role |

### 4.3 Worlds

| # | Case | Request | Expected |
|---|---|---|---|
| 4.3.1 | List worlds | `GET /worlds` | 200, list of public worlds |
| 4.3.2 | Create world | `POST /worlds` with name | 201, world created |
| 4.3.3 | Create duplicate name | Same world name | 409, conflict |
| 4.3.4 | Get world | `GET /worlds/:id` | 200, world metadata + city summaries |
| 4.3.5 | Get world includes render summary | World has 3 cities | Each city summary includes `seq`, `blueprint_hash`, `checks_status`, `files_count`, `symbols_count` |
| 4.3.6 | Default world exists | Fresh server boot | A "default" world is auto-created |
| 4.3.7 | Private world hidden | `is_public: false` | Not listed in `GET /worlds` for unauthenticated users |
| 4.3.8 | Private world accessible | Authenticated team member | `GET /worlds/:id` returns data |

### 4.4 Cities

| # | Case | Request | Expected |
|---|---|---|---|
| 4.4.1 | Create city | `POST /cities` with world_id, team_id, repo | 201, city created |
| 4.4.2 | Create duplicate repo | Same repo in same world | 409, conflict |
| 4.4.3 | Create city wrong team | User not in the specified team | 403, forbidden |
| 4.4.4 | Get city | `GET /cities/:id` | 200, city metadata + latest blueprint from snapshot |
| 4.4.5 | Get city no blueprint | City just created, no pushes | 200, city metadata, blueprint is `null` |
| 4.4.6 | Get city includes hash | City has blueprint | Response includes `blueprint_hash` |

### 4.5 Blueprint Push

| # | Case | Request | Expected |
|---|---|---|---|
| 4.5.1 | Push valid blueprint | `POST /cities/:id/push` with valid JSON | 201, event created, seq returned |
| 4.5.2 | Sequential seq numbers | Two pushes to same city | First gets seq=1, second gets seq=2 |
| 4.5.3 | Snapshot updated | Push blueprint | `city_snapshots` row upserted with latest |
| 4.5.4 | Hash stored | Push blueprint with hash | `blueprint_hash` in event and snapshot matches |
| 4.5.5 | Snapshot summary fields derived | Push blueprint with `checks` + `stats` | `city_snapshots.checks_status`, `files_count`, `symbols_count` are updated from blueprint |
| 4.5.6 | Events are immutable | After push | `blueprint_events` row cannot be updated or deleted via API |
| 4.5.7 | Push with invalid API key | Wrong key | 401, unauthorized |
| 4.5.8 | Push with scoped key | Key scoped to city A, push to city B | 403, forbidden |
| 4.5.9 | Push with team key | Key for the city's team | 201, accepted |
| 4.5.10 | Push oversized payload | >5MB blueprint | 413, payload too large |
| 4.5.11 | Push rate limited | Exceed rate limit | 429, too many requests |
| 4.5.12 | Push invalid JSON | Malformed body | 400, validation error |
| 4.5.13 | Push schema mismatch | JSON doesn't match CityBlueprint schema | 400, schema validation error |
| 4.5.14 | Duplicate hash push | Same blueprint content pushed again | 201, new event created (same hash, different seq — push is always accepted) |
| 4.5.15 | Audit log entry | Successful push | `audit_log` row created with action `"blueprint.pushed"` |

### 4.6 Blueprint Events (History)

| # | Case | Request | Expected |
|---|---|---|---|
| 4.6.1 | List events | `GET /cities/:id/events` | 200, paginated list of events (newest first) |
| 4.6.2 | List events from_seq | `GET /cities/:id/events?from_seq=5` | Only events with seq >= 5 |
| 4.6.3 | List events with limit | `GET /cities/:id/events?limit=3` | At most 3 events returned |
| 4.6.4 | Get specific event | `GET /cities/:id/events/7` | 200, the event with seq=7 |
| 4.6.5 | Get non-existent event | `GET /cities/:id/events/999` | 404, not found |
| 4.6.6 | Events for empty city | No pushes yet | 200, empty array |

### 4.7 Connections

| # | Case | Request | Expected |
|---|---|---|---|
| 4.7.1 | Create connection | `POST /connections` between two cities | 201, connection created |
| 4.7.2 | Duplicate connection | Same from/to pair | 409, conflict |
| 4.7.3 | List connections | `GET /worlds/:id/connections` | 200, list of connections in that world |
| 4.7.4 | Cross-world connection | Cities in different worlds | 400, must be in the same world |
| 4.7.5 | Non-existent city | Reference a city that doesn't exist | 404, city not found |

### 4.8 API Keys

| # | Case | Request | Expected |
|---|---|---|---|
| 4.8.1 | Create key | Via API with team_id | 201, plaintext key returned (only time it's shown) |
| 4.8.2 | Key hash stored | After creation | DB contains bcrypt hash, not plaintext |
| 4.8.3 | Valid key authenticates | `X-API-Key` header with valid key | Request proceeds |
| 4.8.4 | Revoked key rejected | Use a revoked key | 401, unauthorized |
| 4.8.5 | Key scope enforced | Key scoped to city A, used for city B | 403, forbidden |
| 4.8.6 | Unscoped key works for all team cities | Key with empty `city_ids` | Accepted for any city owned by the team |
| 4.8.7 | Last used updated | Key used for a push | `last_used` timestamp updated |

### 4.9 Federation

| # | Case | Request | Expected |
|---|---|---|---|
| 4.9.1 | Create link | `POST /federation/links` with remote URL | 201, link created with status `"pending"` |
| 4.9.2 | List links | `GET /federation/links` | 200, list of links with status |
| 4.9.3 | Link activation | Remote server confirms | Status changes to `"active"`, `linked_at` set |
| 4.9.4 | Invalid remote URL | URL doesn't point to a world server | 400, remote server not reachable or not valid |

### 4.10 Health & Ops

| # | Case | Request | Expected |
|---|---|---|---|
| 4.10.1 | Health check | `GET /health` | 200, `{ status: "ok" }` |
| 4.10.2 | Health with DB down | PostgreSQL unreachable | 503, `{ status: "unhealthy", reason: "database" }` |
| 4.10.3 | CORS preflight | `OPTIONS` request with origin | Correct CORS headers returned |

---

## 5. Game Client — Renderer

### 5.1 Lifecycle

| # | Case | Action | Expected |
|---|---|---|---|
| 5.1.1 | Mount | `renderer.mount(container, config)` | PixiJS canvas attached to container, renderer visible |
| 5.1.2 | Destroy | `renderer.destroy()` | Canvas removed, polling stopped, event listeners cleaned up |
| 5.1.3 | Mount with worldId | Config includes `worldId` | Opens directly on the specified world |
| 5.1.4 | Mount with cityId | Config includes `cityId` | Opens directly on the specified city view |
| 5.1.5 | Container resize | Browser window resized | Canvas resizes to fill container, no stretching |

### 5.2 Data Loading

| # | Case | Action | Expected |
|---|---|---|---|
| 5.2.1 | Fetch world | Mount with worldId | Calls `GET /worlds/:id`, populates store with `CitySummary` list |
| 5.2.2 | Fetch city blueprint | Navigate to a city | Calls `GET /cities/:id`, stores blueprint in `blueprints` map |
| 5.2.3 | Blueprint cached | Navigate away and back to same city | Second load uses cached blueprint, no HTTP request |
| 5.2.4 | Cache invalidated by hash | Poll detects new `blueprint_hash` | Cache evicted, fresh blueprint fetched |
| 5.2.5 | City summaries include render fields | World response | `cities` in store include `seq`, `blueprint_hash`, `checks_status`, `files_count`, `symbols_count` |
| 5.2.6 | Fetch error handling | Server returns 500 | Error displayed in UI, renderer doesn't crash |
| 5.2.7 | Network offline | No connectivity | Cached data still displayed, error indicator shown |
| 5.2.8 | No over-fetch on world view | `GET /worlds/:id` returns unchanged `blueprint_hash` values | Client updates world summary fields and skips `GET /cities/:id` fetches |

### 5.3 Navigation

| # | Case | Action | Expected |
|---|---|---|---|
| 5.3.1 | Navigate to city | `renderer.navigateToCity(id)` | Camera transitions to city view, districts visible |
| 5.3.2 | Navigate to district | `renderer.navigateToDistrict(id, path)` | Camera zooms into district, buildings visible |
| 5.3.3 | Navigate to building | `renderer.navigateToBuilding(id, path)` | Camera zooms into building, symbols visible |
| 5.3.4 | Zoom in via scroll | Scroll wheel on a city | Progressive zoom: world → city → district |
| 5.3.5 | Zoom out via scroll | Scroll wheel out from district | Progressive zoom out: district → city → world |
| 5.3.6 | Pan | Click-drag on canvas | Camera pans in the drag direction |
| 5.3.7 | Fly-to on search result | Click a search result | Camera smoothly animates to the target |
| 5.3.8 | Breadcrumb navigation | Click a breadcrumb segment | Camera navigates to that level |
| 5.3.9 | View changed event | Navigate to a city | `viewChanged` event fires with `{ level: 'city', cityId: ... }` |

### 5.4 Highlighting

| # | Case | Action | Expected |
|---|---|---|---|
| 5.4.1 | Highlight building | `renderer.highlightBuilding(cityId, filePath)` | Building has a visual glow/outline |
| 5.4.2 | Clear highlight | `renderer.clearHighlight()` | Glow removed |
| 5.4.3 | Highlight off-screen building | Building not in current viewport | Directional indicator points toward it |
| 5.4.4 | Highlight in different city | Currently viewing city A, highlight in city B | Navigates to city B and highlights |

### 5.5 Rendering — World View

| # | Case | Input | Expected |
|---|---|---|---|
| 5.5.1 | Cities as nodes | World with 5 cities | 5 labeled icons on the map |
| 5.5.2 | City size reflects scale | City A `files_count`=500, City B `files_count`=50 | City A icon is notably larger |
| 5.5.3 | Weather per city | City A `checks_status`=`success`, City B `checks_status`=`failure` | City A has clear sky, City B has storm |
| 5.5.4 | Connection lines | Connection between city A and B | Visible line/road between them |
| 5.5.5 | Click city | Click a city icon | Navigates to city view |
| 5.5.6 | Empty world | World with 0 cities | Empty map with a message |

### 5.6 Rendering — City View

| # | Case | Input | Expected |
|---|---|---|---|
| 5.6.1 | Districts as zones | Blueprint with 3 top-level dirs | 3 bounded neighborhood zones |
| 5.6.2 | Buildings in districts | Files within each dir | Small building blocks inside each zone |
| 5.6.3 | District labels | Top-level dir names | Visible labels on each district |
| 5.6.4 | Cross-district roads | Import edges between dirs | Road lines between district zones |
| 5.6.5 | Hints applied | `.city.yml` hint: `style: commercial` | District rendered with commercial style |
| 5.6.6 | Click district | Click a district zone | Navigates to district view |

### 5.7 Rendering — District View

| # | Case | Input | Expected |
|---|---|---|---|
| 5.7.1 | Files as buildings | 10 files in directory | 10 individual building sprites |
| 5.7.2 | Building height | File with 20 symbols vs file with 2 | Taller building for 20-symbol file |
| 5.7.3 | Building language color | `.ts` file vs `.py` file | Different color palettes |
| 5.7.4 | Import roads | Edges between files in the district | Road lines between buildings |
| 5.7.5 | Building labels | File names | Visible labels on each building |
| 5.7.6 | Click building | Click a building | Navigates to building view |
| 5.7.7 | Subdirectories | Nested dirs within the district | Rendered as sub-blocks or grouped buildings |

### 5.8 Rendering — Building View

| # | Case | Input | Expected |
|---|---|---|---|
| 5.8.1 | Symbols as floors | Class with 5 methods | 5 floor/room entries visible |
| 5.8.2 | Visibility indicators | 3 public, 2 private methods | Visual distinction (icons, colors) |
| 5.8.3 | Multiple top-level symbols | File with a class and two functions | All three displayed |
| 5.8.4 | Empty file | File with `symbols: []` | Empty building interior, placeholder message |
| 5.8.5 | Floor ordering from source location | Symbol members include `loc.startLine` | Floors/rooms are ordered by source order |
| 5.8.6 | Floor ordering fallback without location | Members have no `loc` | Stable deterministic order still used |

### 5.9 Weather

| # | Case | Input | Expected |
|---|---|---|---|
| 5.9.1 | Success weather | `checks.status: "success"` | Clear sky, bright lighting |
| 5.9.2 | Failure weather | `checks.status: "failure"` | Dark clouds, rain effect |
| 5.9.3 | Mixed weather | `checks.status: "mixed"` | Partly cloudy |
| 5.9.4 | Pending weather | `checks.status: "pending"` | Wind/dust effect |
| 5.9.5 | Unknown weather | `checks` is `null` | Fog effect |

### 5.10 Search

| # | Case | Input | Expected |
|---|---|---|---|
| 5.10.1 | Search by file name | Query: "auth" | Files containing "auth" in the path |
| 5.10.2 | Search by symbol name | Query: "login" | Symbols named "login" shown in results |
| 5.10.3 | Search empty query | Query: "" | Search cleared, no results |
| 5.10.4 | Search no results | Query: "xyznonexistent" | Empty results, "no matches" message |
| 5.10.5 | Click search result | Click a file result | Camera navigates to that building |

### 5.11 Polling

| # | Case | Condition | Expected |
|---|---|---|---|
| 5.11.1 | Regular polling | Normal operation | GET request every `pollIntervalMs` |
| 5.11.2 | Pause when hidden | Tab becomes hidden (`visibilityState: "hidden"`) | Polling stops |
| 5.11.3 | Resume when visible | Tab becomes visible again | Polling resumes immediately |
| 5.11.4 | Hash unchanged | Server returns same hash | No blueprint re-fetch |
| 5.11.5 | Hash changed | Server returns new hash | Blueprint re-fetched, store updated |
| 5.11.6 | Seq updated on change | New blueprint event on server | `seqMap` updated with new seq |
| 5.11.7 | Render update on change | New blueprint loaded | City re-renders with new data |
| 5.11.8 | World polling updates summaries | World poll returns updated `checks_status` / `files_count` / `symbols_count` | World view updates city node size/weather using summary fields |

### 5.12 Themes

| # | Case | Config | Expected |
|---|---|---|---|
| 5.12.1 | Light theme | `theme: 'light'` | Light background, dark text |
| 5.12.2 | Dark theme | `theme: 'dark'` | Dark background, light text |
| 5.12.3 | Auto theme | `theme: 'auto'` | Matches OS/browser preference |
| 5.12.4 | Theme change | Switch from light to dark | Renderer re-renders with new theme |

---

## 6. Game Client — SPA Shell

### 6.1 Routing

| # | Case | URL | Expected |
|---|---|---|---|
| 6.1.1 | Landing page | `/` | World overview with city list |
| 6.1.2 | City view | `/cities/:id` | Renderer opens on that city |
| 6.1.3 | District deep link | `/cities/:id/src/services` | Renderer opens on that district |
| 6.1.4 | Building deep link | `/cities/:id/src/services/auth.ts` | Renderer opens on that building |
| 6.1.5 | Invalid city ID | `/cities/nonexistent` | 404 or error message |
| 6.1.6 | URL updates on navigation | Navigate to a district in the renderer | Browser URL updates to match |
| 6.1.7 | Back/forward navigation | Browser back button | Returns to previous view |

### 6.2 Authentication Pages

| # | Case | Action | Expected |
|---|---|---|---|
| 6.2.1 | Login page renders | Navigate to login | Form with username and password fields |
| 6.2.2 | Successful login | Submit valid credentials | Redirected to world view, token stored |
| 6.2.3 | Failed login | Submit wrong password | Error message displayed, stay on login page |
| 6.2.4 | Register page renders | Navigate to register | Form with username, email, password |
| 6.2.5 | Successful registration | Submit valid form | Account created, redirected to login or auto-logged in |
| 6.2.6 | Protected route redirect | Access `/cities/:id` without login (private world) | Redirected to login page |
| 6.2.7 | Public world no login | Access a public world's cities | Accessible without authentication |

### 6.3 Landing Page

| # | Case | State | Expected |
|---|---|---|---|
| 6.3.1 | Cities listed | World has 5 cities | All 5 shown with name, repo, weather |
| 6.3.2 | Click city | Click a city card | Navigate to `/cities/:id` |
| 6.3.3 | Empty world | No cities | Message: "No cities yet" |
| 6.3.4 | Blueprint hash shown | City has blueprint | Weather/status indicator visible |

### 6.4 Served by World Server

| # | Case | Request | Expected |
|---|---|---|---|
| 6.4.1 | SPA served at root | `GET /` | Returns `index.html` |
| 6.4.2 | Static assets served | `GET /assets/renderer.js` | Returns JS bundle |
| 6.4.3 | Client-side routing fallback | `GET /cities/some-id` (direct navigation) | Returns `index.html` (SPA handles routing) |
| 6.4.4 | API routes unaffected | `GET /api/v1/health` | Returns API response, not SPA |

---

*Test cases will be expanded as features are implemented. Edge cases and performance
tests should be added per component during development.*
