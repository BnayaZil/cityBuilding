# City Building — Client Technical Plan

> Two clients, one rendering engine. A standalone SPA and a VS Code extension
> that embeds the same SPA with IDE-aware capabilities.

---

## Table of Contents

1. [Approach](#1-approach)
2. [Shared Rendering Core](#2-shared-rendering-core)
3. [SPA (Standalone Web Client)](#3-spa-standalone-web-client)
4. [VS Code Extension](#4-vs-code-extension)
5. [State Management](#5-state-management)
6. [Rendering Specification](#6-rendering-specification)
7. [Polling & Data Sync](#7-polling--data-sync)
8. [Package Structure](#8-package-structure)
9. [Technical Decisions](#9-technical-decisions)
10. [Phasing](#10-phasing)

---

## 1. Approach

### One Engine, Two Hosts

```
┌──────────────────────────────────────────────────────┐
│                   RENDERING CORE                      │
│                                                      │
│  PixiJS engine + UI components + state management    │
│  (framework-agnostic, runs in any browser context)   │
│                                                      │
└──────────────┬───────────────────────┬───────────────┘
               │                       │
       ┌───────▼───────┐       ┌───────▼────────┐
       │      SPA      │       │  VS Code Ext   │
       │   (Phase 1)   │       │   (Phase 2)    │
       │               │       │                │
       │  Served by    │       │  WebView panel │
       │  world server │       │  + extension   │
       │               │       │    bridge      │
       │  URL routing  │       │                │
       │  Auth / login │       │  IDE context:  │
       │               │       │  - workspace   │
       │               │       │  - active file │
       │               │       │  - commands    │
       │               │       │  - status bar  │
       └───────────────┘       └────────────────┘
```

The rendering core is a **standalone TypeScript package** that:
- Takes a DOM container element
- Accepts a configuration object (server URL, initial view, IDE bridge callbacks)
- Renders the full city experience (city list, city, districts, buildings)
- Exposes an API for external control (navigate to file, highlight building, etc.)

The SPA and the VS Code extension are both thin shells around this core.

### Why This Works

- **No duplication.** All rendering, interaction, and state logic lives in one place.
- **Testable in isolation.** The core can be tested in a headless browser without
  VS Code or a server.
- **The VS Code WebView is a browser.** It supports Canvas, WebGL, PixiJS —
  everything the SPA uses. No feature gap.
- **Proven pattern.** This is how most VS Code extensions with rich UI work
  (GitHub PR extension, Thunder Client, Draw.io, etc.)

---

## 2. Shared Rendering Core

### Package: `@city-building/renderer`

This is the heart of both clients. It is a framework-agnostic TypeScript library
that owns all rendering and interaction logic.

### Public API

```typescript
interface CityBuildingRenderer {
  // Lifecycle
  mount(container: HTMLElement, config: RendererConfig): void;
  destroy(): void;

  // Navigation (4 zoom levels: world, city, district, building)
  navigateToWorld(worldId?: string): void;
  navigateToCity(cityId: string): void;
  navigateToDistrict(cityId: string, directoryPath: string): void;
  navigateToBuilding(cityId: string, filePath: string): void;

  // Highlighting
  highlightBuilding(cityId: string, filePath: string): void;
  clearHighlight(): void;

  // State queries
  getCurrentView(): ViewState;
  getCityHealth(cityId: string): ChecksStatus | null;

  // Events
  on(event: 'viewChanged', handler: (view: ViewState) => void): void;
  on(event: 'buildingClicked', handler: (file: FileRef) => void): void;
  on(event: 'districtClicked', handler: (dir: DirectoryRef) => void): void;
}

interface RendererConfig {
  serverUrl: string;                     // world server URL
  worldId?: string;                      // which world to display
  cityId?: string;                       // start on a specific city
  pollIntervalMs?: number;               // default: 30000
  theme?: 'light' | 'dark' | 'auto';
  ideBridge?: IdeBridge;                 // VS Code extension bridge (null for SPA, Phase 2)
}

interface IdeBridge {
  onBuildingClicked?: (file: FileRef) => void;     // extension opens the file
  onRequestScan?: () => void;                       // extension triggers a scan
  getActiveFile?: () => FileRef | null;             // extension reports current file
  getWorkspaceRepo?: () => string | null;           // extension reports workspace repo
}
```

### Internal Architecture

```
@city-building/renderer
├── engine/
│   ├── app.ts                  # PixiJS Application setup, resize handling
│   ├── camera.ts               # Pan, zoom, fly-to animations
│   ├── input.ts                # Mouse/touch/keyboard input handling
│   └── layers.ts               # Layer management (ground, buildings, roads, weather, UI)
├── views/
│   ├── world-view.ts           # World map: cities as nodes
│   ├── city-view.ts            # City: districts as neighborhoods
│   ├── district-view.ts        # District: buildings on streets
│   └── building-view.ts        # Building: floors/symbols interior
├── objects/
│   ├── city-node.ts            # City icon on the world map
│   ├── district-zone.ts        # District boundary / neighborhood
│   ├── building-sprite.ts      # Individual building
│   ├── road-line.ts            # Import edge rendered as road
│   └── weather-effect.ts       # CI status weather overlay
├── layout/
│   ├── isometric.ts            # Isometric coordinate math
│   ├── grid-layout.ts          # Grid-based building placement
│   └── force-layout.ts         # Force-directed layout for organic look
├── ui/
│   ├── hud.ts                  # Heads-up display (breadcrumb, minimap)
│   ├── search.ts               # Search overlay (file/symbol search)
│   ├── info-panel.ts           # Side panel with details on selected item
│   ├── toolbar.ts              # Zoom controls, view toggles
│   └── tooltip.ts              # Hover tooltip for buildings/roads
├── data/
│   ├── api-client.ts           # World server REST client
│   ├── poller.ts               # Polling service for updates
│   ├── store.ts                # State store (zustand)
│   └── types.ts                # Generated TypeScript types from schema
└── index.ts                    # Public API (CityBuildingRenderer)
```

---

## 3. SPA (Standalone Web Client)

### Package: `@city-building/web`

A thin shell that mounts the renderer into a full-page web application with URL
routing and a server connection form.

### Responsibilities

| What | How |
|---|---|
| Mount the renderer into `<div id="app">` | Calls `renderer.mount()` |
| URL routing | Maps browser URL to renderer navigation |
| Authentication | Login/register for accessing worlds |
| World/city selection | Landing page showing the world's cities |
| Responsive layout | Full-screen canvas, overlay UI panels |

### URL Structure

```
/                                    → Landing / world overview (all cities)
/cities/:cityId                      → City view
/cities/:cityId/*path                → District or building view (path = dir or file path)
```

The SPA connects to the world server that serves it — no server selection needed.
The server URL is implicit (same origin).

> **TBD (Phase 2+):** Self-hosted / federated server selection. When federation
> is designed, a server picker or multi-server navigation may be introduced.

### SPA-Specific UI

- **Landing page:** Overview of the world — list of cities, team info.
- **Shareable URLs:** Deep links to any city, district, or building.
  When teams are involved, shared links may require team membership (invite-gated).
- **Fullscreen mode:** F11 or button to go fullscreen for immersive viewing.

### Technology

- The SPA itself is minimal — just routing + landing page.
- React for the UI shell.
- Vite as the build tool (fast HMR, good PixiJS asset handling).

### Deployment

Served by the world server at `/`. The SPA is bundled into the world server's
Docker image. No separate hosting needed.

---

## 4. VS Code Extension

### Package: `city-building-vscode`

A VS Code extension that embeds the rendering core in a WebView panel and bridges
IDE context into it.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                      │
│                                                                │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Activate   │  │  Commands  │  │  Status  │  │  Config  │  │
│  │  (entry)    │  │  Registry  │  │  Bar     │  │  Reader  │  │
│  └──────┬─────┘  └──────┬─────┘  └────┬─────┘  └────┬─────┘  │
│         │               │              │              │        │
│         └───────────────┼──────────────┼──────────────┘        │
│                         │              │                       │
│                  ┌──────▼──────────────▼──────┐                │
│                  │     Extension Bridge        │                │
│                  │  (postMessage ↔ renderer)   │                │
│                  └──────────────┬──────────────┘                │
│                                │                               │
│  ┌─────────────────────────────▼──────────────────────────┐    │
│  │                   WebView Panel                         │    │
│  │                                                         │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │           @city-building/renderer                 │   │    │
│  │  │                                                  │   │    │
│  │  │  Same rendering core as the SPA.                 │   │    │
│  │  │  Mounted with ideBridge callbacks enabled.       │   │    │
│  │  │                                                  │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                │
└──────────────────────────────────────────────────────────────────┘
```

### Extension ↔ WebView Communication

The extension host and the WebView run in separate contexts. They communicate
via VS Code's `postMessage` API.

**Messages from Extension → WebView:**

| Message | Payload | Purpose |
|---|---|---|
| `setContext` | `{ repo, serverUrl, worldId, cityId }` | Initial config on panel open |
| `activeFileChanged` | `{ filePath }` | User switched files in the editor |
| `scanCompleted` | `{ blueprint }` | A local scan finished (future) |
| `themeChanged` | `{ theme: 'light' \| 'dark' }` | VS Code theme changed |

**Messages from WebView → Extension:**

| Message | Payload | Purpose |
|---|---|---|
| `openFile` | `{ filePath }` | User clicked a building → open the file in editor |
| `requestScan` | `{}` | User clicked "scan" in the city UI |
| `ready` | `{}` | WebView finished loading |
| `viewChanged` | `{ view: ViewState }` | Navigation changed (for status bar update) |

### Extension Features

**1. WebView Panel**

The main feature. Opens a panel (side or tab) showing the city for the current
workspace.

```
Command: City Building: Open City
Shortcut: Ctrl+Shift+C (configurable)
Panel title: "🏙 <repo-name>"
```

When opened, the extension:
1. Reads the workspace's git remote URL to determine the repo name.
2. Reads `.city.yml` if present for server URL config, or uses the default.
3. Opens the WebView panel and posts `setContext` with the repo and server info.
4. The renderer fetches the city data from the world server and renders it.

**2. Active File Tracking**

When the user switches files in the editor, the extension sends `activeFileChanged`
to the WebView. The renderer highlights the corresponding building in the city
(subtle glow or outline). This creates a live connection between code and city.

```
User opens src/services/auth.service.ts in the editor
  → Extension sends: { type: 'activeFileChanged', filePath: 'src/services/auth.service.ts' }
  → Renderer highlights the AuthService building
  → If the building is off-screen, a subtle indicator points toward it
```

**3. Building → File Navigation**

When the user clicks a building in the city, the WebView sends `openFile` to the
extension. The extension opens the corresponding file in the editor.

```
User clicks the AuthService building in the city
  → WebView sends: { type: 'openFile', filePath: 'src/services/auth.service.ts' }
  → Extension calls vscode.workspace.openTextDocument() + vscode.window.showTextDocument()
```

**4. Status Bar Item**

A status bar item shows the current city's health (CI weather).

```
┌────────────────────────────────────────────────────────────┐
│  ... other status bar items ...    ☀️ my-org/payments      │
└────────────────────────────────────────────────────────────┘
```

- ☀️ = all checks passing
- 🌧 = some checks failing
- ⛈ = all checks failing
- 🌫 = no checks / unknown

Clicking the status bar item opens the city panel.

**5. Commands**

| Command | Description |
|---|---|
| `city-building.openCity` | Open the city panel for the current workspace |
| `city-building.scanAndPush` | Run `city push` for the current workspace (requires CLI installed) |
| `city-building.goToBuilding` | Quick-pick: search for a file/symbol and navigate to its building |
| `city-building.toggleTracking` | Enable/disable active file → building tracking |

**6. Configuration (VS Code settings)**

```jsonc
{
  // World server URL (default: public server)
  "cityBuilding.serverUrl": "https://world.city-building.dev",

  // World ID to use
  "cityBuilding.worldId": "default",

  // Poll interval in seconds
  "cityBuilding.pollInterval": 30,

  // Auto-track active file in the city view
  "cityBuilding.trackActiveFile": true,

  // Panel position when opening
  "cityBuilding.panelPosition": "beside"   // "beside" | "active" | "tab"
}
```

### WebView Asset Loading

The renderer bundle (JS + CSS + sprite assets) is bundled with the extension
and loaded into the WebView from the extension's `media/` directory.

```
city-building-vscode/
├── src/
│   ├── extension.ts            # Extension entry point
│   ├── bridge.ts               # postMessage bridge implementation
│   ├── commands.ts             # Command registrations
│   ├── status-bar.ts           # Status bar item
│   ├── workspace.ts            # Git remote detection, .city.yml reading
│   └── webview-provider.ts     # WebView panel creation and lifecycle
├── media/
│   ├── renderer.js             # Bundled @city-building/renderer (built artifact)
│   ├── renderer.css
│   └── assets/                 # Sprite sheets, fonts
└── package.json                # VS Code extension manifest
```

The renderer is built as a standalone bundle (via Vite library mode) that the
extension loads. It is NOT fetched from a CDN — the extension is fully self-contained.

---

## 5. State Management

### Store: Zustand

A single zustand store inside `@city-building/renderer` manages all client state.
Both the SPA and the VS Code extension use the same store — it lives inside the
renderer.

### Store Shape

```typescript
interface CityBuildingStore {
  // Connection
  connected: boolean;

  // World state
  activeWorldId: string | null;

  // Cities
  cities: Map<string, CitySummary>;            // city ID → summary (name, repo, seq, blueprint_hash, checks_status, files_count, symbols_count)
  blueprints: Map<string, CityBlueprint>;      // city ID → latest full blueprint (loaded on demand)

  // Navigation
  view: ViewState;                              // current zoom level + target

  // UI
  selectedItem: SelectedItem | null;            // currently selected building/district
  highlightedFile: string | null;               // file highlighted via IDE tracking
  searchQuery: string;
  searchResults: SearchResult[];
  infoPanelOpen: boolean;

  // Polling & cache
  seqMap: Map<string, number>;                  // city ID → last known seq (event ordering)
  hashMap: Map<string, string>;                 // city ID → last known blueprint_hash (cache invalidation)
  lastPollAt: number | null;
}

type ViewState =
  | { level: 'world'; worldId: string }
  | { level: 'city'; cityId: string }
  | { level: 'district'; cityId: string; path: string }
  | { level: 'building'; cityId: string; path: string };
```

### Data Loading Strategy

Blueprints can be large. The client does NOT load all blueprints for all cities
upfront.

| View level | What's loaded |
|---|---|
| World map | `cities` summaries only (`name`, `repo`, `seq`, `checks_status`, `files_count`, `symbols_count`, `blueprint_hash`). Lightweight. |
| City view | Full blueprint for the selected city. Loaded on navigation. |
| District / Building | Already loaded (part of the city's blueprint). |

When the user navigates to a city, the client fetches its full blueprint from the
server. When they leave, it stays cached (evicted under memory pressure via LRU).

Expected world summary payload (`GET /api/v1/worlds/:id`):

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

---

## 6. Rendering Specification

### 6.1 Isometric Coordinate System

The city uses a standard isometric projection:

```
Screen X = (gridX - gridY) * tileWidth / 2
Screen Y = (gridX + gridY) * tileHeight / 2
```

Where `tileWidth` and `tileHeight` define the isometric tile dimensions.
All positions are computed from grid coordinates — the layout engine assigns
grid positions, and the isometric math converts them to screen positions.

### 6.2 Camera System

| Feature | Implementation |
|---|---|
| Pan | Click-drag or arrow keys. Bounded to world/city extents. |
| Zoom | Scroll wheel or pinch. Discrete zoom levels (5-8 levels). |
| Fly-to | Animated camera movement to a target position (easing). |
| Minimap | Small overview in the corner. Click to jump. |

Zoom level transitions trigger view-level changes (e.g., zooming into a city
transitions from world view to city view with an animation).

### 6.3 Zoom Level Rendering

**World View:**

```
┌──────────────────────────────────────────┐
│                                          │
│    ☁️                                     │
│        [🏙 payments]─────[🏙 auth]       │
│             │                            │
│             │                            │
│        [🏙 frontend]    [🏙 analytics]   │
│                                          │
│  Minimap: [·]                            │
└──────────────────────────────────────────┘
```

- Each city is a labeled icon.
- Icon size reflects city summary `files_count` (relative scale).
- Weather overlay per city (from city summary `checks_status`).
- Connection lines between cities (from `connections` table).
- Force-directed or manual layout for city positions.

**City View:**

```
┌──────────────────────────────────────────┐
│  payments > city view                    │
│                                          │
│    ┌─────────┐     ┌──────────┐          │
│    │services │     │ models   │          │
│    │ ▓▓▓ ▓▓  │─────│ ▓▓ ▓    │          │
│    │ ▓▓ ▓▓▓  │     │ ▓▓      │          │
│    └─────────┘     └──────────┘          │
│         │                                │
│    ┌─────────┐                           │
│    │  utils  │                           │
│    │ ▓ ▓ ▓  │                           │
│    └─────────┘                           │
│                                          │
└──────────────────────────────────────────┘
```

- Districts (top-level directories) rendered as bounded zones.
- Buildings inside districts shown as small blocks (no detail).
- Roads between districts represent cross-directory import edges.
- District labels visible.

**District View:**

```
┌──────────────────────────────────────────┐
│  payments > src/services                 │
│                                          │
│      🏢          🏗️        🏠            │
│    AuthSvc    PaymentSvc   helpers.ts    │
│      │            │                      │
│      └────────────┘                      │
│           │                              │
│      🏢──┘                               │
│    UserSvc                               │
│                                          │
└──────────────────────────────────────────┘
```

- Individual files as buildings.
- Building size based on symbol count.
- Building style based on file language (if mixed codebase).
- Roads between buildings represent import edges.
- Building labels visible (file name or primary class name).

**Building View:**

```
┌──────────────────────────────────────────┐
│  payments > src/services/auth.service.ts │
│                                          │
│    ┌──────────────────────┐              │
│    │    AuthService       │              │
│    ├──────────────────────┤              │
│    │  🔓 login()          │              │
│    │  🔓 logout()         │              │
│    │  🔒 hashPassword()   │              │
│    │  🔒 validateToken()  │              │
│    └──────────────────────┘              │
│                                          │
│    🔓 = public/exported                  │
│    🔒 = private                          │
│                                          │
└──────────────────────────────────────────┘
```

- Individual symbols (functions, methods) as floors/rooms.
- Visibility indicators (exported vs. private).
- Class structure visible (class as building, methods as floors).
- If symbol `loc` metadata exists, floors are ordered by `loc.startLine`.

### 6.4 Building Appearance Rules

The renderer assigns visual properties based on blueprint data.
These are client-side heuristics — the data layer provides raw attributes.

| Blueprint data | Visual property |
|---|---|
| File symbol count | Building height (more symbols = taller) |
| Exported vs. private symbol ratio | Building openness (many exports = more windows/doors) |
| File language | Building material/color palette |
| Number of incoming edges | Building prominence (many importers = larger footprint) |
| `hints.districts[].style` | District zone appearance (commercial, residential, industrial) |

**Language → palette (initial mapping):**

| Language | Style |
|---|---|
| TypeScript / JavaScript | Blue-toned glass & steel |
| Python | Green-toned wood & stone |
| Rust | Orange-toned industrial metal |
| Go | Cyan-toned minimalist concrete |
| Java | Red-toned classic brick |
| C# | Purple-toned modern |

### 6.5 Weather Effects

Rendered as a per-city overlay in the world view, or a global effect in the city view.

| `checks.status` | Weather |
|---|---|
| `success` | Clear sky, sun |
| `mixed` | Partly cloudy |
| `failure` | Rain, dark clouds |
| `pending` | Wind / dust |
| `unknown` / `null` | Fog |

Implemented as PixiJS particle effects + sky color tinting.

### 6.6 Transitions Between Blueprint Events

When the client detects a new blueprint event (via polling), it can animate the
change:

1. Diff the old and new blueprints (client-side).
2. **New files** → building "construction" animation (rises from ground).
3. **Removed files** → building fades out.
4. **Changed symbols** → building resizes smoothly.
5. **New edges** → road draws in.
6. **Removed edges** → road fades out.

This uses the event-sourced blueprint history. The client holds the previous
blueprint in memory and diffs against the new one.

---

## 7. Polling & Data Sync

### Polling Flow

There is no dedicated polling endpoint. The client polls whichever GET endpoint
matches its current view. World responses include `blueprint_hash` per city plus
render metadata (`checks_status`, `files_count`, `symbols_count`, `seq`), which the
client uses for cache invalidation and world-map rendering.

```
Client                              World Server
  │                                      │
  │  GET /worlds/:id                     │   (client is on world view)
  │  ─────────────────────────────────►  │
  │                                      │
  │  { cities: [                                                │
  │    { id: "c1", files_count: 342, checks_status: "success", │
  │      blueprint_hash: "sha256:ab.." },                      │
  │    { id: "c2", files_count: 180, checks_status: "mixed",   │
  │      blueprint_hash: "sha256:ff.." }                       │
  │  ]}                                                         │
  │  ◄─────────────────────────────────  │
  │                                      │
  │  (compare with local hashMap)        │
  │  c1 local="sha256:ab.." → same, skip│
  │  c2 local="sha256:ee.." → changed!  │
  │                                      │
  │  GET /cities/c2                      │
  │  ─────────────────────────────────►  │
  │                                      │
  │  { blueprint: {...}, blueprint_hash: "ff.." }  │
  │  ◄─────────────────────────────────  │
  │                                      │
  │  (update store, re-render)           │
  │                                      │
  │  ... wait pollIntervalMs ...         │
  │                                      │
```

**When viewing a single city:** the client polls `GET /cities/:id`. The response
includes the blueprint hash. If the hash matches the cached blueprint, no re-fetch
is needed.

### Polling Rules

- No dedicated polling route. Any GET endpoint serves as a poll target.
- Full blueprint is fetched only for cities whose `blueprint_hash` changed.
- Polling pauses when the browser tab is not visible (`document.visibilityState`).
- Polling interval is configurable (default 30s).

---

## 8. Package Structure

```
packages/
├── renderer/                    # @city-building/renderer
│   ├── src/
│   │   ├── engine/              # PixiJS app, camera, input, layers
│   │   ├── views/               # World, city, district, building views
│   │   ├── objects/             # Sprites: buildings, roads, weather
│   │   ├── layout/             # Isometric math, grid/force layout
│   │   ├── ui/                  # HUD, search, info panel, toolbar
│   │   ├── data/                # API client, poller, store
│   │   └── index.ts             # Public API
│   ├── assets/                  # Sprite sheets, tileset PNGs, fonts
│   ├── vite.config.ts           # Library mode build (outputs renderer.js)
│   ├── package.json
│   └── tsconfig.json
│
├── web/                         # @city-building/web (SPA shell)
│   ├── src/
│   │   ├── main.ts              # Mount renderer, setup routing
│   │   ├── router.ts            # URL ↔ renderer navigation
│   │   ├── auth.ts              # Login/register page
│   │   └── index.html
│   ├── vite.config.ts           # SPA build
│   └── package.json
│
├── vscode/                      # city-building-vscode (extension)
│   ├── src/
│   │   ├── extension.ts         # activate/deactivate
│   │   ├── webview-provider.ts  # WebView panel lifecycle
│   │   ├── bridge.ts            # postMessage protocol
│   │   ├── commands.ts          # Command registrations
│   │   ├── status-bar.ts        # Status bar item
│   │   └── workspace.ts         # Git remote detection, config reading
│   ├── media/                   # Bundled renderer (built from renderer package)
│   │   ├── renderer.js
│   │   ├── renderer.css
│   │   └── assets/
│   ├── package.json             # VS Code extension manifest
│   └── tsconfig.json
│
└── shared/                      # @city-building/shared
    ├── src/
    │   ├── types.ts             # Generated TypeScript types (from Rust schema)
    │   ├── api-types.ts         # World server API request/response types
    │   └── constants.ts         # Shared constants (default server URL, etc.)
    └── package.json
```

### Build Pipeline

```
1. Rust schema crate ──► JSON Schema ──► TypeScript types (shared/types.ts)
2. renderer package ──► Vite library build ──► renderer.js + renderer.css
3. web package ──► imports renderer ──► Vite SPA build ──► static files
4. vscode package ──► copies renderer build to media/ ──► vsce package ──► .vsix
```

---

## 9. Technical Decisions

### 9.1 Rendering: PixiJS

- **PixiJS v8** for 2D canvas/WebGL rendering.
- Isometric city built with sprites on a PixiJS stage.
- Sprite sheets for buildings, roads, terrain, weather effects.
- PixiJS handles: rendering, hit testing, z-ordering, particle effects (weather).

### 9.2 UI Chrome: React

- React for all non-canvas UI (search overlay, info panel, toolbar, breadcrumb).
- Rendered into DOM elements overlaid on the PixiJS canvas.
- Communicates with the renderer via the zustand store (shared state).
- Can be optimized later (Preact swap, etc.) if bundle size becomes a concern.

### 9.3 State: Zustand

- Minimal boilerplate, works outside React components.
- The PixiJS rendering loop reads from the store.
- UI components subscribe to store slices.
- Single store instance per renderer mount.

### 9.4 Build: Vite

- Vite for both the renderer (library mode) and the SPA.
- Asset handling: sprite sheets imported as URLs, bundled automatically.
- HMR for development.
- Tree-shaking for production builds.

### 9.5 VS Code WebView Constraints (Phase 2)

Things to account for in the renderer when running inside a VS Code WebView:

| Constraint | Handling |
|---|---|
| No direct network access from WebView | API calls go through the renderer's fetch (WebView has fetch access in VS Code). |
| CSP (Content Security Policy) | Extension sets CSP to allow PixiJS WebGL/Canvas, inline styles, and font loading. |
| Theme awareness | Extension sends `themeChanged` messages. Renderer supports light/dark themes. |
| Panel resize | PixiJS `app.resize()` called on panel resize events. |
| Panel hidden/shown | Polling pauses when panel is hidden, resumes when shown. |
| No localStorage | Use VS Code's `globalState` / `workspaceState` via the bridge for persistence. |

### 9.6 Asset Strategy

Isometric buildings and terrain need sprite assets. Options:

| Strategy | Approach |
|---|---|
| **Phase 1: Procedural** | Generate simple isometric blocks programmatically (colored rectangles with depth). No artist needed. Functional but basic. |
| **Phase 2: Pixel art sprites** | Hand-crafted or AI-generated isometric sprite sheets. Much better visual quality. |
| **Phase 3: Themeable** | Multiple sprite themes (modern, medieval, sci-fi). Users pick a theme. |

Phase 1 should ship with procedural graphics. They can look decent with good
color choices and simple shading. Sprites are an enhancement, not a blocker.

---

## 10. Phasing

### Phase 1 — Core Rendering (SPA)

> See a city in the browser.

**Renderer:**
- [ ] PixiJS application setup, camera (pan/zoom), isometric coordinate system
- [ ] World view: cities as labeled nodes, basic force-directed layout
- [ ] City view: districts as zones, buildings as procedural blocks
- [ ] District view: individual buildings with labels, import roads
- [ ] Building view: symbol list (interior)
- [ ] Zustand store, API client, hash-based polling
- [ ] Search (file/symbol name)
- [ ] Breadcrumb navigation
- [ ] CI weather display (sky color + icon, no particle effects yet)
- [ ] Light/dark theme support

**SPA:**
- [ ] Vite SPA setup, mount renderer
- [ ] URL routing ↔ renderer navigation
- [ ] Auth pages (login/register)
- [ ] Served by world server at `/`

### Phase 2 — VS Code Extension, Polish & Connections

> IDE integration, better visuals, inter-city connections, history navigation.

**VS Code Extension:**
- [ ] WebView panel with bundled renderer
- [ ] Extension ↔ WebView postMessage bridge
- [ ] Auto-detect workspace repo → open correct city
- [ ] Active file tracking → highlight building
- [ ] Building click → open file in editor
- [ ] Status bar item (CI weather)
- [ ] Commands: open city, go to building
- [ ] Publish to VS Code Marketplace

**Polish & Connections:**
- [ ] Sprite-based buildings (replace procedural blocks)
- [ ] Weather particle effects
- [ ] Inter-city connection rendering (roads/bridges on world map)
- [ ] Blueprint event history browser (timeline slider)
- [ ] Transition animations between blueprint states
- [ ] Minimap
- [ ] Info panel with detailed stats on selected item
- [ ] Tooltip on hover
- [ ] Performance optimization for large cities (LOD, culling, sprite batching)

### Phase 3 — Gamification & Themes

- [ ] Gamification layer (TBD)
- [ ] Custom sprite themes
- [ ] Fullscreen immersive mode
- [ ] Sound effects / ambient audio (opt-in)
- [ ] Mobile-responsive layout for SPA

---

*This is a living document. Evolves alongside the main PLAN.md.*
