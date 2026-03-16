# City Building — Product Requirements Document

> Turn codebases into living cities. A game where your code is the map.

---

## Vision

Software architecture is invisible. Flowcharts and diagrams are static, boring,
and instantly outdated. City Building makes codebase structure tangible — every
service becomes a building, every feature adds a floor, every repo becomes a city,
and connected repos form a world of interconnected cities.

It's not a diagram tool. It's a game.

---

## Problem

- Developers have no intuitive spatial understanding of the codebases they work in.
- Onboarding to a new codebase is slow — there's no "map" to explore.
- Architecture diagrams are manually maintained and always out of date.
- There's no fun, social, or competitive layer to code quality and growth.

---

## Solution

A system that automatically scans codebases via AST analysis, produces deterministic
structural snapshots, and renders them as isometric cities in a game-like experience.

---

## Core Concepts

| Code | City |
|---|---|
| Repository | City |
| Top-level directory / module | District / Neighborhood |
| File / class | Building |
| Function / method | Floor / room |
| Import between files | Road / street |
| Import between directories | Highway |
| Cross-repo dependency | Bridge between cities |
| Multiple repos | Multiple cities in a world |
| CI checks status | Weather (sunny, stormy, foggy) |
| Team / org | City owners |

---

## Target Users

1. **Development teams** — visualize and explore their architecture in a new way.
2. **New engineers** — onboard by "walking through" the codebase as a city.
3. **Engineering managers** — see the shape of what their teams are building.
4. **Open source maintainers** — showcase project structure publicly.

---

## Key Principles

1. **Zero-config by default** — one GitHub Action file to get started.
2. **No source code leaves the repo** — only structural metadata (paths, symbol names, counts).
3. **Current state, not history** — the city represents what the codebase looks like *now*
   (history is preserved via event sourcing but the primary view is always "now").
4. **Data is not rendering** — the scan produces neutral, deterministic data.
   All visual decisions (building appearance, layout, clustering) are client-side.
5. **Open source and self-hostable** — anyone can run a world server.
6. **Integration simplicity** — non-intrusive, no tokens sent to third parties,
   no access to source code required by the server.

---

## Features

### Phase 1 — Core Loop

**Scan → Push → See your city.**

- **AST Scanner** — Rust-based scanner that parses a codebase using tree-sitter,
  extracts structural symbols (classes, functions, methods, interfaces, enums),
  import edges, and produces a deterministic CityBlueprint JSON.
- **CLI** — Full setup and operation from the terminal. Register, create a team,
  create a city, scan, push. Every command supports `--json` and `--non-interactive`
  for AI agent operation.
- **GitHub Action** — Single workflow file. Scans on push to main, includes CI
  checks status, pushes the blueprint to the world server.
- **World Server** — Receives and stores blueprints as immutable events (event sourcing).
  Serves city data to the game client. Manages teams, API keys, and worlds.
- **Game Client (SPA)** — Isometric 2D city rendered with PixiJS. Served by the
  world server. Four zoom levels: world (all cities) → city (districts) → district
  (buildings) → building (symbols). CI weather overlay. Search and navigation.
- **Teams** — Cities are owned by teams. Users join teams via shareable invite links.
  API keys are team-scoped.
- **Blueprint Hashing** — Each blueprint has a deterministic SHA-256 hash. The client
  polls existing GET endpoints and compares hashes to detect changes. No dedicated
  polling route.

### Phase 2 — Multi-City, Connections & IDE

- Inter-city connections (cross-repo dependencies as bridges/roads)
- VS Code extension (embeds the same SPA renderer in a WebView panel with IDE-aware
  features: active file tracking, building-to-file navigation, status bar weather)
- Blueprint history navigation (time-lapse, event browser)
- Transition animations between blueprint states
- World federation (linking independent world servers)
- Private worlds

### Phase 3 — Gamification

- TBD: Travian-style mechanics (troops, resources, combat between cities),
  achievements, leaderboards, scores, or a simpler gamification model.
- Custom city themes and rendering styles.
- Server-side scanning for competitive integrity (opt-in).

---

## What It Is NOT

- **Not a code analysis tool** — it doesn't measure quality, complexity, or coverage.
- **Not a monitoring tool** — it doesn't track runtime behavior or errors.
- **Not a diagram generator** — it's a game with a codebase as input.
- **Not a CI/CD tool** — it reads CI status but doesn't run or manage pipelines.

---

## Trust Model

Data integrity is a social contract, not a technical guarantee. There is no way to
cryptographically prove a blueprint matches a real codebase without server-side
scanning. Therefore: no trust tiers, no OIDC, no signed payloads. API keys control
who can push where. The `source_type` field (github-action vs cli) is informational only.

Users who don't want to send metadata to a third party can self-host or scan locally
without pushing.

---

## Success Metrics (TBD)

- Number of cities created (repos onboarded)
- Number of active worlds
- Repeat visits to the game client
- Time spent exploring cities
- Team adoption (multi-user teams)
- Self-hosted world server instances

---

*Detailed technical plans: [PLAN.md](./PLAN.md) (architecture) and
[CLIENT_PLAN.md](./CLIENT_PLAN.md) (client). Test cases: [TEST_CASES.md](./TEST_CASES.md).*
