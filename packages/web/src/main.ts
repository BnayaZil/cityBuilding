import { CityBuildingRenderer, createRenderer } from "@city-building/renderer";
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_WORLD_SERVER_URL, type CitySummary } from "@city-building/shared";
import { parseRoute, routeToPath, type Route } from "./router.js";
import { buildCitySceneModel, verifyCitySceneModel, type CitySceneModel } from "./scene/layout.js";
import { CityWebGLView } from "./scene/webgl-city-view.js";
import { renderWorldIslandPreview } from "./world-surface-canvas.js";

export interface WebApp {
  renderer: CityBuildingRenderer;
  navigate(pathname: string): void;
  refresh(): Promise<void>;
  render(): void;
}

export interface WebAppOptions {
  serverUrl?: string;
  worldId?: string;
  pollIntervalMs?: number;
  autoLoad?: boolean;
}

const APP_STYLE_ID = "city-building-web-style";

function ensureStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.getElementById(APP_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = APP_STYLE_ID;
  style.textContent = `
    :root {
      --cb-bg: #0a1221;
      --cb-panel: rgba(13, 20, 36, 0.86);
      --cb-surface: rgba(10, 17, 31, 0.82);
      --cb-border: #283b5c;
      --cb-border-strong: #3b5b88;
      --cb-text: #dbe8ff;
      --cb-text-muted: #8ea5c8;
      --cb-primary: #6ec5ff;
      --cb-primary-strong: #4ca9f3;
    }
    body {
      margin: 0;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(circle at 16% 8%, #1a2a44 0%, #101b31 42%, #0a1221 100%);
      color: var(--cb-text);
    }
    #app {
      min-height: 100vh;
    }
    .cb-app {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
      display: grid;
      gap: 14px;
    }
    .cb-panel {
      border-radius: 14px;
      border: 1px solid var(--cb-border);
      background: var(--cb-panel);
      box-shadow: 0 14px 30px rgba(2, 8, 20, 0.44);
      padding: 16px;
      backdrop-filter: blur(3px);
    }
    .cb-grid {
      display: grid;
      grid-template-columns: minmax(250px, 330px) 1fr;
      gap: 14px;
    }
    .cb-toolbar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .cb-btn {
      border: 1px solid var(--cb-border-strong);
      border-radius: 9px;
      background: linear-gradient(180deg, #1a2844 0%, #121d33 100%);
      color: #cfe5ff;
      font-weight: 600;
      padding: 7px 12px;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
    }
    .cb-btn:hover {
      border-color: var(--cb-primary);
      background: linear-gradient(180deg, #1f3152 0%, #162644 100%);
      color: #e4f3ff;
    }
    .cb-meta {
      margin: 4px 0;
      color: var(--cb-text-muted);
      font-size: 13px;
    }
    .cb-error {
      margin-top: 8px;
      border-radius: 9px;
      border: 1px solid #7a3750;
      background: rgba(116, 38, 65, 0.28);
      color: #ffc1d1;
      padding: 8px 10px;
      font-size: 13px;
    }
    .cb-city-list {
      display: grid;
      gap: 10px;
    }
    .cb-city-item {
      width: 100%;
      text-align: left;
      border: 1px solid var(--cb-border);
      border-radius: 9px;
      padding: 8px;
      background: rgba(13, 20, 35, 0.9);
      color: var(--cb-text);
      cursor: pointer;
    }
    .cb-city-item.active {
      border-color: var(--cb-primary-strong);
      box-shadow: inset 0 0 0 1px var(--cb-primary-strong);
    }
    .cb-city-item strong {
      color: #d4e6ff;
      font-size: 15px;
    }
    .cb-world-grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }
    .cb-world-card {
      border: 1px solid var(--cb-border);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(20, 30, 52, 0.88) 0%, rgba(14, 22, 39, 0.94) 100%);
      box-shadow: 0 12px 24px rgba(1, 6, 18, 0.42);
      padding: 12px;
      display: grid;
      gap: 8px;
    }
    .cb-world-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .cb-world-card-title {
      margin: 0;
      color: #d7e8ff;
      font-size: 15px;
      font-weight: 700;
    }
    .cb-world-card-meta {
      margin: 0;
      color: #90a7cc;
      font-size: 12px;
    }
    .cb-world-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(120px, 1fr));
      gap: 10px;
    }
    .cb-world-metric {
      border: 1px solid var(--cb-border);
      border-radius: 10px;
      background: var(--cb-surface);
      padding: 10px;
    }
    .cb-world-metric-label {
      margin: 0;
      color: #8ca4c8;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .cb-world-metric-value {
      margin: 2px 0 0;
      color: #cfe4ff;
      font-size: 20px;
      font-weight: 700;
    }
    .cb-world-empty {
      border: 1px dashed #36517a;
      border-radius: 12px;
      background: rgba(13, 20, 36, 0.72);
      padding: 20px;
      color: #9db4d7;
      text-align: center;
    }
    .cb-world-map-panel {
      display: grid;
      gap: 10px;
    }
    .cb-world-map-shell {
      position: relative;
      height: 620px;
      overflow: auto;
      border-radius: 12px;
      border: 1px solid #2f4b77;
      background:
        radial-gradient(circle at 24% 20%, rgba(63, 124, 217, 0.34) 0%, rgba(16, 42, 86, 0.26) 34%, rgba(6, 19, 46, 0.88) 100%),
        linear-gradient(180deg, #0e2042 0%, #081832 100%);
      box-shadow: inset 0 0 0 1px rgba(137, 181, 245, 0.18);
      cursor: grab;
    }
    .cb-world-map-shell.dragging {
      cursor: grabbing;
      user-select: none;
    }
    .cb-world-map-surface {
      position: relative;
      background:
        linear-gradient(90deg, rgba(115, 173, 255, 0.09) 1px, transparent 1px),
        linear-gradient(180deg, rgba(115, 173, 255, 0.09) 1px, transparent 1px),
        radial-gradient(circle at 70% 30%, rgba(86, 150, 238, 0.22) 0%, rgba(20, 47, 93, 0.1) 36%, rgba(9, 24, 52, 0) 72%);
      background-size:
        42px 42px,
        42px 42px,
        100% 100%;
      border-radius: 12px;
    }
    .cb-world-links {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: visible;
    }
    .cb-world-link {
      stroke: rgba(104, 232, 255, 0.78);
      stroke-width: 2.2;
      fill: none;
      stroke-linecap: round;
      filter: drop-shadow(0 0 6px rgba(47, 198, 255, 0.46));
    }
    .cb-world-link.soft {
      stroke: rgba(124, 182, 255, 0.44);
      stroke-dasharray: 4 6;
      stroke-width: 1.6;
      filter: drop-shadow(0 0 4px rgba(98, 160, 238, 0.34));
    }
    .cb-world-link.active {
      stroke: rgba(142, 246, 255, 0.9);
      stroke-width: 2.8;
      stroke-dasharray: 7 8;
      animation: cb-link-flow 1.15s linear infinite;
      filter: drop-shadow(0 0 10px rgba(88, 235, 255, 0.72));
    }
    .cb-world-link.soft.active {
      stroke-width: 2.2;
      stroke-dasharray: 6 8;
    }
    .cb-world-node {
      position: absolute;
      transform: translate(-50%, -50%);
      display: grid;
      justify-items: center;
      gap: 8px;
      width: max-content;
      pointer-events: auto;
    }
    .cb-world-island {
      position: relative;
      width: var(--island-width);
      height: var(--island-height);
      border: none;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      padding: 0;
      margin: 0;
      overflow: visible;
      cursor: pointer;
      pointer-events: auto;
      transition: transform 140ms ease, filter 160ms ease;
      will-change: transform, filter;
    }
    .cb-world-island:hover {
      transform: translateY(-1px) scale(1.02);
      filter: drop-shadow(0 0 8px rgba(90, 229, 255, 0.4));
    }
    .cb-world-node.flow .cb-world-island {
      animation: cb-island-hover-flow 1.25s ease-in-out infinite;
      filter: drop-shadow(0 0 11px rgba(96, 234, 255, 0.54));
    }
    .cb-world-island:focus-visible {
      outline: 2px solid #87d0ff;
      outline-offset: 4px;
      border-radius: 8px;
    }
    .cb-world-island::after {
      content: none;
    }
    .cb-world-island-canvas {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
    }
    .cb-world-node-caption {
      display: grid;
      justify-items: center;
      gap: 2px;
      pointer-events: none;
      text-shadow: 0 1px 2px rgba(4, 12, 30, 0.64);
    }
    .cb-world-node.flow .cb-world-node-caption {
      text-shadow:
        0 0 4px rgba(109, 225, 255, 0.68),
        0 1px 2px rgba(4, 12, 30, 0.74);
    }
    .cb-world-node-name {
      font-size: 13px;
      font-weight: 700;
      line-height: 1.15;
      color: #f0f6ff;
    }
    .cb-world-node-meta {
      font-size: 11px;
      color: rgba(216, 232, 255, 0.93);
      line-height: 1;
    }
    .cb-world-hint {
      margin: 0;
      color: var(--cb-text-muted);
      font-size: 12px;
    }
    @keyframes cb-link-flow {
      from {
        stroke-dashoffset: 0;
      }
      to {
        stroke-dashoffset: -30;
      }
    }
    @keyframes cb-island-hover-flow {
      0%,
      100% {
        transform: translateY(-1px) scale(1.02);
        filter: drop-shadow(0 0 8px rgba(90, 229, 255, 0.4));
      }
      50% {
        transform: translateY(-2px) scale(1.035);
        filter: drop-shadow(0 0 14px rgba(96, 234, 255, 0.66));
      }
    }
    .cb-mini-skyline {
      height: 64px;
      border-radius: 8px;
      background: linear-gradient(180deg, rgba(60, 100, 162, 0.34) 0%, rgba(26, 47, 83, 0.3) 100%);
      border: 1px solid rgba(101, 147, 209, 0.44);
      display: flex;
      gap: 4px;
      align-items: flex-end;
      padding: 8px;
    }
    .cb-mini-bar {
      flex: 1;
      min-width: 8px;
      border-radius: 3px 3px 0 0;
      background: linear-gradient(180deg, #73bcff 0%, #355c94 100%);
      box-shadow: 0 1px 0 rgba(235, 247, 255, 0.2) inset;
    }
    .cb-open-city {
      justify-self: start;
      border: 1px solid var(--cb-border-strong);
      border-radius: 8px;
      background: linear-gradient(180deg, #1a2844 0%, #121d33 100%);
      color: #cfe5ff;
      font-weight: 600;
      padding: 6px 10px;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
    }
    .cb-open-city:hover {
      border-color: var(--cb-primary);
      background: linear-gradient(180deg, #1f3152 0%, #162644 100%);
      color: #e4f3ff;
    }
    .cb-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      background: rgba(71, 123, 190, 0.3);
      color: #abd3ff;
    }
    .cb-scene-wrap {
      display: grid;
      gap: 10px;
    }
    .cb-stage {
      border-radius: 12px;
      border: 1px solid var(--cb-border);
      overflow: hidden;
      min-height: 520px;
      background: linear-gradient(180deg, #192944 0%, #13223d 66%, #111f37 100%);
      box-shadow: inset 0 0 0 1px rgba(128, 170, 230, 0.22);
    }
    .cb-stage canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    .cb-district-list,
    .cb-building-list {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .cb-chip {
      border: 1px solid var(--cb-border);
      border-radius: 999px;
      background: rgba(15, 24, 40, 0.9);
      padding: 5px 10px;
      font-size: 12px;
      color: #bcd6f8;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
    }
    .cb-chip:hover {
      border-color: var(--cb-primary);
      color: #d9edff;
    }
    .cb-chip.active {
      border-color: var(--cb-primary-strong);
      background: rgba(66, 123, 194, 0.28);
      color: #e1f1ff;
    }
    @media (max-width: 940px) {
      .cb-grid {
        grid-template-columns: 1fr;
      }
      .cb-stage {
        min-height: 420px;
      }
      .cb-world-metrics {
        grid-template-columns: repeat(2, minmax(120px, 1fr));
      }
      .cb-world-map-shell {
        height: 500px;
      }
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function activeCityIdFromView(view: ReturnType<CityBuildingRenderer["getCurrentView"]>): string | null {
  return view.level === "world" ? null : view.cityId;
}

function selectPathFromView(view: ReturnType<CityBuildingRenderer["getCurrentView"]>): string | null {
  if (view.level === "district" || view.level === "building") {
    return view.path;
  }
  return null;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function statusBadgeTone(status: string): string {
  switch (status) {
    case "success":
      return "background:rgba(53,112,84,0.28);color:#9ce2be;";
    case "failure":
      return "background:rgba(134,44,72,0.3);color:#ffb8cb;";
    case "mixed":
      return "background:rgba(120,88,34,0.32);color:#ffd99a;";
    case "pending":
      return "background:rgba(76,88,116,0.38);color:#c5d3ed;";
    default:
      return "background:rgba(62,103,161,0.32);color:#abd1ff;";
  }
}

function miniSkyline(cityId: string, filesCount: number, symbolsCount: number): string {
  const seed = stableHash(`${cityId}:${filesCount}:${symbolsCount}`);
  const bars = 7;
  const base = Math.max(0.25, Math.min(0.86, symbolsCount / Math.max(1, filesCount * 7)));
  const barMarkup: string[] = [];
  for (let index = 0; index < bars; index += 1) {
    const wave = Math.sin((index + 1) * 1.27 + (seed % 17)) * 0.13;
    const random = (((seed >> ((index % 4) * 7)) & 0xff) / 255) * 0.3;
    const height = Math.max(20, Math.min(58, (base + wave + random) * 66));
    barMarkup.push(`<span class="cb-mini-bar" style="height:${height.toFixed(0)}px"></span>`);
  }
  return `<div class="cb-mini-skyline">${barMarkup.join("")}</div>`;
}

type WorldMapNode = {
  city: CitySummary;
  x: number;
  y: number;
  islandWidth: number;
  islandHeight: number;
};

type WorldMapEdge = {
  from: WorldMapNode;
  to: WorldMapNode;
  soft: boolean;
};

type WorldMapLayout = {
  width: number;
  height: number;
  nodes: WorldMapNode[];
  edges: WorldMapEdge[];
};

type WorldMapScrollState = {
  left: number;
  top: number;
  initialized: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildWorldMapLayout(cities: CitySummary[]): WorldMapLayout {
  const sorted = [...cities].sort(
    (a, b) => b.symbols_count - a.symbols_count || b.files_count - a.files_count || a.id.localeCompare(b.id),
  );
  if (sorted.length === 0) {
    return {
      width: 1800,
      height: 1200,
      nodes: [],
      edges: [],
    };
  }

  const width = Math.max(2200, 1400 + sorted.length * 210);
  const height = Math.max(1400, 900 + sorted.length * 150);
  const centerX = width / 2;
  const centerY = height / 2;
  const margin = 120;

  const nodes: WorldMapNode[] = sorted.map((city, index) => {
    const seed = stableHash(city.id);
    const ring = Math.floor(Math.sqrt(index));
    const angle = index * 2.399963 + ((seed % 360) * Math.PI) / 180 * 0.15;
    const radius = 220 + ring * 185 + ((seed >> 3) % 90) - 45;
    const x = centerX + Math.cos(angle) * radius * 1.2;
    const y = centerY + Math.sin(angle) * radius * 0.84;
    const islandWidth = clamp(160 + Math.sqrt(Math.max(1, city.files_count)) * 16, 160, 270);
    const islandHeight = clamp(105 + Math.sqrt(Math.max(1, city.symbols_count)) * 5.5, 105, 190);
    return {
      city,
      x: clamp(x, margin, width - margin),
      y: clamp(y, margin, height - margin),
      islandWidth,
      islandHeight,
    };
  });

  // Light overlap resolution so islands stay readable.
  for (let pass = 0; pass < 8; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const minDx = (a.islandWidth + b.islandWidth) / 2 + 90;
        const minDy = (a.islandHeight + b.islandHeight) / 2 + 85;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= minDx || Math.abs(dy) >= minDy) {
          continue;
        }
        const moveX = (minDx - Math.abs(dx)) * 0.16 + 1.5;
        const moveY = (minDy - Math.abs(dy)) * 0.16 + 1.5;
        const dirX = dx >= 0 ? 1 : -1;
        const dirY = dy >= 0 ? 1 : -1;
        a.x = clamp(a.x - dirX * moveX, margin, width - margin);
        b.x = clamp(b.x + dirX * moveX, margin, width - margin);
        a.y = clamp(a.y - dirY * moveY, margin, height - margin);
        b.y = clamp(b.y + dirY * moveY, margin, height - margin);
      }
    }
  }

  const edges: WorldMapEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const node of nodes) {
    const nearest = nodes
      .filter((candidate) => candidate.city.id !== node.city.id)
      .map((candidate) => {
        const dx = candidate.x - node.x;
        const dy = candidate.y - node.y;
        return { candidate, distance: Math.hypot(dx, dy) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    for (const neighbor of nearest) {
      if (neighbor.distance > 980) {
        continue;
      }
      const key = [node.city.id, neighbor.candidate.city.id].sort().join("|");
      if (edgeSeen.has(key)) {
        continue;
      }
      edgeSeen.add(key);
      edges.push({
        from: node,
        to: neighbor.candidate,
        soft: neighbor.distance > 520,
      });
    }
  }

  return { width, height, nodes, edges };
}

function setupWorldMapPanning(shell: HTMLElement, scrollState: WorldMapScrollState): void {
  const mapWidth = Number(shell.dataset.mapWidth ?? "0");
  const mapHeight = Number(shell.dataset.mapHeight ?? "0");
  if (!scrollState.initialized) {
    shell.scrollLeft = Math.max(0, (mapWidth - shell.clientWidth) / 2);
    shell.scrollTop = Math.max(0, (mapHeight - shell.clientHeight) / 2);
    scrollState.left = shell.scrollLeft;
    scrollState.top = shell.scrollTop;
    scrollState.initialized = true;
  } else {
    shell.scrollLeft = scrollState.left;
    shell.scrollTop = scrollState.top;
  }

  let dragging = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const stopDragging = () => {
    dragging = false;
    pointerId = -1;
    shell.classList.remove("dragging");
  };

  shell.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-city]")) {
      return;
    }
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = shell.scrollLeft;
    startTop = shell.scrollTop;
    shell.classList.add("dragging");
    try {
      shell.setPointerCapture(pointerId);
    } catch {
      // Ignore capture failure if pointer is no longer active.
    }
  });

  shell.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    shell.scrollLeft = startLeft - dx;
    shell.scrollTop = startTop - dy;
  });

  shell.addEventListener("pointerup", (event) => {
    if (dragging && event.pointerId === pointerId) {
      stopDragging();
    }
  });
  shell.addEventListener("pointercancel", stopDragging);
  shell.addEventListener("mouseleave", () => {
    if (!dragging) {
      return;
    }
    stopDragging();
  });
  shell.addEventListener("scroll", () => {
    scrollState.left = shell.scrollLeft;
    scrollState.top = shell.scrollTop;
  });
}

export function mountWebApp(container: HTMLElement, initialPath = "/", options: WebAppOptions = {}): WebApp {
  ensureStyles();
  const defaultServerUrl =
    options.serverUrl ??
    (typeof window !== "undefined" && window.location.origin ? window.location.origin : DEFAULT_WORLD_SERVER_URL);

  const renderer = createRenderer();
  const sceneView = new CityWebGLView();
  renderer.mount(container, {
    serverUrl: defaultServerUrl,
    worldId: options.worldId ?? "default",
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    autoLoad: options.autoLoad ?? true,
  });
  sceneView.setPickHandler((path) => {
    const currentView = renderer.getCurrentView();
    if (currentView.level === "world") {
      return;
    }
    if (currentView.level === "building" && currentView.path === path) {
      return;
    }
    navigate(`/cities/${currentView.cityId}/${path}`);
  });

  let lastModel: CitySceneModel | null = null;
  const worldMapScroll: WorldMapScrollState = {
    left: 0,
    top: 0,
    initialized: false,
  };
  let renderScheduled = false;

  function scheduleRender(): void {
    if (renderScheduled) {
      return;
    }
    renderScheduled = true;
    queueMicrotask(() => {
      renderScheduled = false;
      render();
    });
  }

  renderer.on("stateChanged", () => {
    scheduleRender();
  });

  function applyRoute(route: Route): void {
    if (route.kind === "landing") {
      renderer.navigateToWorld(options.worldId ?? "default");
      return;
    }
    if (route.kind === "city") {
      renderer.navigateToCity(route.cityId);
      return;
    }
    if (route.path.includes(".")) {
      renderer.navigateToBuilding(route.cityId, route.path);
      return;
    }
    renderer.navigateToDistrict(route.cityId, route.path);
  }

  function navigate(pathname: string): void {
    const route = parseRoute(pathname);
    applyRoute(route);
    if (typeof window !== "undefined" && window.history) {
      const path = routeToPath(route);
      if (window.location.pathname !== path) {
        window.history.pushState({}, "", path);
      }
    }
    render();
  }

  async function refresh(): Promise<void> {
    const view = renderer.getCurrentView();
    if (view.level === "world") {
      await renderer.loadWorld(view.worldId);
    } else {
      await renderer.loadWorld(options.worldId ?? "default");
      await renderer.loadCity(view.cityId);
    }
    await renderer.pollOnce();
    render();
  }

  function render(): void {
    if (!("innerHTML" in container)) {
      return;
    }
    const previousWorldMap = container.querySelector("#cb-world-map-shell");
    if (previousWorldMap instanceof HTMLElement) {
      worldMapScroll.left = previousWorldMap.scrollLeft;
      worldMapScroll.top = previousWorldMap.scrollTop;
      worldMapScroll.initialized = true;
    }

    const store = renderer.getStoreSnapshot();
    const view = renderer.getCurrentView();
    const activeCityId = activeCityIdFromView(view);
    const selectedPath = selectPathFromView(view);
    const activeBlueprint = activeCityId ? store.blueprints.get(activeCityId) ?? null : null;

    lastModel = activeCityId && activeBlueprint ? buildCitySceneModel(activeCityId, activeBlueprint) : null;
    const verification = lastModel ? verifyCitySceneModel(lastModel) : { ok: true, errors: [] as string[] };

    const cities = [...store.cities.values()].sort(
      (a, b) => b.symbols_count - a.symbols_count || b.files_count - a.files_count || a.name.localeCompare(b.name),
    );

    const cityCards = cities
      .map((city) => {
        const active = city.id === activeCityId ? " active" : "";
        return `
          <button class="cb-city-item${active}" data-city="${city.id}">
            <strong>${escapeHtml(city.name)}</strong>
            <span class="cb-badge" style="${statusBadgeTone(city.checks_status)}">${escapeHtml(city.checks_status)}</span>
            <p class="cb-meta">${escapeHtml(city.repo)} | ${city.files_count} files | ${city.symbols_count} symbols</p>
          </button>
        `;
      })
      .join("");

    const worldMapLayout = buildWorldMapLayout(cities);
    const worldEdgesMarkup = worldMapLayout.edges
      .map((edge) => {
        const className = edge.soft ? "cb-world-link soft" : "cb-world-link";
        return `<line class="${className}" data-from="${edge.from.city.id}" data-to="${edge.to.city.id}" x1="${edge.from.x.toFixed(2)}" y1="${edge.from.y.toFixed(2)}" x2="${edge.to.x.toFixed(2)}" y2="${edge.to.y.toFixed(2)}"></line>`;
      })
      .join("");

    const worldNodesMarkup = worldMapLayout.nodes
      .map((node) => {
        const city = node.city;
        const healthStyle = statusBadgeTone(city.checks_status);
        return `
          <article class="cb-world-node" style="left:${node.x.toFixed(2)}px;top:${node.y.toFixed(2)}px;">
            <button
              class="cb-world-island"
              data-city="${city.id}"
              aria-label="Open ${escapeHtml(city.name)} city"
              style="--island-width:${node.islandWidth.toFixed(0)}px;--island-height:${node.islandHeight.toFixed(0)}px;"
            >
              <canvas class="cb-world-island-canvas" data-city-preview="${city.id}"></canvas>
            </button>
            <div class="cb-world-node-caption">
              <span class="cb-world-node-name">${escapeHtml(city.name)}</span>
              <span class="cb-world-node-meta">${formatNumber(city.files_count)} files | ${formatNumber(city.symbols_count)} symbols</span>
              <span class="cb-badge" style="${healthStyle}">${escapeHtml(city.checks_status)}</span>
            </div>
          </article>
        `;
      })
      .join("");

    const totalFiles = cities.reduce((sum, city) => sum + city.files_count, 0);
    const totalSymbols = cities.reduce((sum, city) => sum + city.symbols_count, 0);
    const passingCities = cities.filter((city) => city.checks_status === "success").length;
    const mixedCities = cities.filter((city) => city.checks_status === "mixed").length;
    const failingCities = cities.filter((city) => city.checks_status === "failure").length;
    const pendingCities = cities.filter((city) => city.checks_status === "pending").length;

    const districtChips =
      lastModel && lastModel.districts.length > 0
        ? lastModel.districts
            .map((district) => {
              const active = view.level === "district" && view.path === district.key ? " active" : "";
              return `<button class="cb-chip${active}" data-district="${escapeHtml(district.key)}">${escapeHtml(district.label)} (${district.fileCount})</button>`;
            })
            .join("")
        : "<span class='cb-meta'>No districts yet</span>";

    const topBuildings =
      lastModel && lastModel.buildings.length > 0
        ? [...lastModel.buildings]
            .sort((a, b) => b.symbolsCount - a.symbolsCount)
            .slice(0, 12)
            .map((building) => {
              const active = selectedPath === building.path ? " active" : "";
              return `<button class="cb-chip${active}" data-building="${escapeHtml(building.path)}">${escapeHtml(building.name)} (${building.symbolsCount})</button>`;
            })
            .join("")
        : "<span class='cb-meta'>No buildings yet</span>";

    const viewLabel =
      view.level === "world" ? `world:${view.worldId}` : `${view.level}:${view.cityId}${selectedPath ? `/${selectedPath}` : ""}`;

    if (view.level === "world") {
      container.innerHTML = `
        <main class="cb-app">
          <header class="cb-panel">
            <h1>City Building Local World</h1>
            <p class="cb-meta">View: <strong>${escapeHtml(viewLabel)}</strong></p>
            <p class="cb-meta">Connected: ${store.connected ? "yes" : "no"} | Last poll: ${store.lastPollAt ?? "never"}</p>
            <div class="cb-toolbar">
              <button class="cb-btn" id="go-world">World</button>
              <button class="cb-btn" id="refresh-world">Refresh</button>
            </div>
            ${
              store.lastError
                ? `<div class="cb-error">Data error: ${escapeHtml(store.lastError)}</div>`
                : ""
            }
          </header>
          <section class="cb-panel">
            <div class="cb-world-metrics">
              <article class="cb-world-metric">
                <p class="cb-world-metric-label">Cities</p>
                <p class="cb-world-metric-value">${formatNumber(cities.length)}</p>
              </article>
              <article class="cb-world-metric">
                <p class="cb-world-metric-label">Files</p>
                <p class="cb-world-metric-value">${formatNumber(totalFiles)}</p>
              </article>
              <article class="cb-world-metric">
                <p class="cb-world-metric-label">Symbols</p>
                <p class="cb-world-metric-value">${formatNumber(totalSymbols)}</p>
              </article>
              <article class="cb-world-metric">
                <p class="cb-world-metric-label">Healthy</p>
                <p class="cb-world-metric-value">${formatNumber(passingCities)}</p>
              </article>
            </div>
            <p class="cb-meta">
              Checks status: ${formatNumber(passingCities)} success, ${formatNumber(mixedCities)} mixed,
              ${formatNumber(failingCities)} failed, ${formatNumber(pendingCities)} pending.
            </p>
          </section>
          ${
            worldNodesMarkup
              ? `
                <section class="cb-panel cb-world-map-panel">
                  <h2>World Surface</h2>
                  <p class="cb-world-hint">Drag to pan the map in both axes. Click any island to open the city.</p>
                  <div
                    class="cb-world-map-shell"
                    id="cb-world-map-shell"
                    data-map-width="${worldMapLayout.width}"
                    data-map-height="${worldMapLayout.height}"
                  >
                    <div
                      class="cb-world-map-surface"
                      style="width:${worldMapLayout.width}px;height:${worldMapLayout.height}px"
                    >
                      <svg class="cb-world-links" viewBox="0 0 ${worldMapLayout.width} ${worldMapLayout.height}" preserveAspectRatio="none">
                        ${worldEdgesMarkup}
                      </svg>
                      ${worldNodesMarkup}
                    </div>
                  </div>
                </section>
              `
              : `<section class="cb-world-empty">No cities yet. Click Refresh after bootstrap/push to populate your world.</section>`
          }
        </main>
      `;
    } else {
      container.innerHTML = `
        <main class="cb-app">
          <header class="cb-panel">
            <h1>City Building Local World</h1>
            <p class="cb-meta">View: <strong>${escapeHtml(viewLabel)}</strong></p>
            <p class="cb-meta">Connected: ${store.connected ? "yes" : "no"} | Last poll: ${store.lastPollAt ?? "never"}</p>
            <div class="cb-toolbar">
              <button class="cb-btn" id="go-world">World</button>
              <button class="cb-btn" id="refresh-world">Refresh</button>
              ${activeCityId ? `<button class="cb-btn" id="go-city-root" data-city-root="${escapeHtml(activeCityId)}">City Root</button>` : ""}
            </div>
            ${
              store.lastError
                ? `<div class="cb-error">Data error: ${escapeHtml(store.lastError)}</div>`
                : verification.ok
                  ? ""
                  : `<div class="cb-error">3D model verification failed: ${escapeHtml(verification.errors[0] ?? "unknown error")}</div>`
            }
          </header>
          <section class="cb-grid">
            <aside class="cb-panel">
              <h2>Cities</h2>
              <div class="cb-city-list">${cityCards || "<p class='cb-meta'>No cities yet</p>"}</div>
              <h3>Districts</h3>
              <div class="cb-district-list">${districtChips}</div>
              <h3>Top Buildings</h3>
              <div class="cb-building-list">${topBuildings}</div>
            </aside>
            <section class="cb-panel cb-scene-wrap">
              <h2>${activeCityId ? `City: ${escapeHtml(activeCityId)}` : "City Scene"}</h2>
              <div class="cb-stage" id="cb-three-stage"></div>
              ${
                lastModel
                  ? `<p class="cb-meta">Rendered ${lastModel.districts.length} districts, ${lastModel.buildings.length} buildings, ${lastModel.roads.length} roads, and ${lastModel.gardens.length} gardens. Drag to orbit, wheel to zoom, click a building to focus.</p>`
                  : "<p class='cb-meta'>Select a city to render its 3D scene.</p>"
              }
            </section>
          </section>
        </main>
      `;
    }

    if (typeof document !== "undefined") {
      const refreshBtn = container.querySelector("#refresh-world");
      refreshBtn?.addEventListener("click", () => {
        void refresh();
      });

      const worldBtn = container.querySelector("#go-world");
      worldBtn?.addEventListener("click", () => {
        navigate("/");
      });

      const cityRootBtn = container.querySelector("#go-city-root");
      cityRootBtn?.addEventListener("click", () => {
        const cityId = (cityRootBtn as HTMLElement).getAttribute("data-city-root");
        if (cityId) {
          navigate(`/cities/${cityId}`);
        }
      });

      for (const city of store.cities.values()) {
        const cityButtons = container.querySelectorAll(`[data-city='${city.id}']`);
        for (const button of cityButtons) {
          button.addEventListener("click", (event) => {
            event.preventDefault();
            navigate(`/cities/${city.id}`);
          });
        }
      }

      for (const chip of container.querySelectorAll("[data-district]")) {
        chip.addEventListener("click", (event) => {
          event.preventDefault();
          if (!activeCityId) {
            return;
          }
          const district = (chip as HTMLElement).getAttribute("data-district");
          if (!district || district === "(root)") {
            navigate(`/cities/${activeCityId}`);
            return;
          }
          navigate(`/cities/${activeCityId}/${district}`);
        });
      }

      for (const chip of container.querySelectorAll("[data-building]")) {
        chip.addEventListener("click", (event) => {
          event.preventDefault();
          if (!activeCityId) {
            return;
          }
          const path = (chip as HTMLElement).getAttribute("data-building");
          if (!path) {
            return;
          }
          navigate(`/cities/${activeCityId}/${path}`);
        });
      }

      const worldMapShell = container.querySelector("#cb-world-map-shell");
      if (worldMapShell instanceof HTMLElement) {
        setupWorldMapPanning(worldMapShell, worldMapScroll);
      } else if (view.level !== "world") {
        worldMapScroll.initialized = false;
        worldMapScroll.left = 0;
        worldMapScroll.top = 0;
      }

      const setWorldFlowCity = (cityId: string | null) => {
        const worldLinks = container.querySelectorAll(".cb-world-link");
        for (const link of worldLinks) {
          const fromId = link.getAttribute("data-from");
          const toId = link.getAttribute("data-to");
          const active = cityId !== null && (fromId === cityId || toId === cityId);
          link.classList.toggle("active", active);
        }

        const worldNodes = container.querySelectorAll(".cb-world-node");
        for (const node of worldNodes) {
          const nodeCity = node.querySelector(".cb-world-island[data-city]")?.getAttribute("data-city");
          node.classList.toggle("flow", cityId !== null && nodeCity === cityId);
        }
      };

      const worldCityButtons = container.querySelectorAll(".cb-world-island[data-city]");
      for (const button of worldCityButtons) {
        const cityId = button.getAttribute("data-city");
        if (!cityId) {
          continue;
        }
        button.addEventListener("mouseenter", () => {
          setWorldFlowCity(cityId);
        });
        button.addEventListener("mouseleave", () => {
          setWorldFlowCity(null);
        });
        button.addEventListener("focus", () => {
          setWorldFlowCity(cityId);
        });
        button.addEventListener("blur", () => {
          setWorldFlowCity(null);
        });
      }

      const previewCanvases = container.querySelectorAll("[data-city-preview]");
      const cityById = new Map(cities.map((city) => [city.id, city]));
      for (const preview of previewCanvases) {
        if (!(preview instanceof HTMLCanvasElement)) {
          continue;
        }
        const cityId = preview.getAttribute("data-city-preview");
        if (!cityId) {
          continue;
        }
        const city = cityById.get(cityId);
        if (!city) {
          continue;
        }
        renderWorldIslandPreview(preview, city);
      }

      const stage = container.querySelector("#cb-three-stage");
      if (stage instanceof HTMLElement) {
        sceneView.mount(stage);
        sceneView.renderModel(lastModel, selectedPath);
      } else {
        sceneView.renderModel(null, null);
      }
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      sceneView.dispose();
    });
  }

  navigate(initialPath);
  if (options.autoLoad ?? true) {
    void refresh();
  }
  return { renderer, navigate, refresh, render };
}
