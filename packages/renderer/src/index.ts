import type { ChecksStatus, CityBlueprint, CitySummary, WorldResponse } from "@city-building/shared";

export type ViewState =
  | { level: "world"; worldId: string }
  | { level: "city"; cityId: string }
  | { level: "district"; cityId: string; path: string }
  | { level: "building"; cityId: string; path: string };

export interface FileRef {
  cityId: string;
  path: string;
}

export interface DirectoryRef {
  cityId: string;
  path: string;
}

export interface IdeBridge {
  onBuildingClicked?: (file: FileRef) => void;
  onRequestScan?: () => void;
  getActiveFile?: () => FileRef | null;
  getWorkspaceRepo?: () => string | null;
}

export interface RendererConfig {
  serverUrl: string;
  worldId?: string;
  cityId?: string;
  pollIntervalMs?: number;
  theme?: "light" | "dark" | "auto";
  ideBridge?: IdeBridge;
  fetchImpl?: typeof fetch;
  autoLoad?: boolean;
  onError?: (error: Error) => void;
}

type EventHandlers = {
  viewChanged: Array<(view: ViewState) => void>;
  buildingClicked: Array<(file: FileRef) => void>;
  districtClicked: Array<(dir: DirectoryRef) => void>;
  stateChanged: Array<() => void>;
};

export interface CityBuildingStore {
  connected: boolean;
  activeWorldId: string | null;
  cities: Map<string, CitySummary>;
  blueprints: Map<string, CityBlueprint>;
  view: ViewState;
  selectedItem: string | null;
  highlightedFile: string | null;
  searchQuery: string;
  searchResults: string[];
  infoPanelOpen: boolean;
  seqMap: Map<string, number>;
  hashMap: Map<string, string>;
  lastPollAt: number | null;
  lastError: string | null;
}

export class CityBuildingRenderer {
  private config: RendererConfig | null = null;
  private mounted = false;
  private container: HTMLElement | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handlers: EventHandlers = { viewChanged: [], buildingClicked: [], districtClicked: [], stateChanged: [] };
  private store: CityBuildingStore = {
    connected: false,
    activeWorldId: null,
    cities: new Map(),
    blueprints: new Map(),
    view: { level: "world", worldId: "default" },
    selectedItem: null,
    highlightedFile: null,
    searchQuery: "",
    searchResults: [],
    infoPanelOpen: false,
    seqMap: new Map(),
    hashMap: new Map(),
    lastPollAt: null,
    lastError: null,
  };

  mount(container: HTMLElement, config: RendererConfig): void {
    this.container = container;
    this.config = config;
    this.mounted = true;
    this.store.connected = true;
    this.store.activeWorldId = config.worldId ?? "default";
    this.store.view = config.cityId
      ? { level: "city", cityId: config.cityId }
      : { level: "world", worldId: this.store.activeWorldId };
    this.emit("viewChanged", this.store.view);
    if (config.autoLoad !== false) {
      void this.loadInitialData();
      this.startPolling();
    }
  }

  destroy(): void {
    this.mounted = false;
    this.container = null;
    this.config = null;
    this.store.connected = false;
    this.stopPolling();
    this.handlers = { viewChanged: [], buildingClicked: [], districtClicked: [], stateChanged: [] };
  }

  navigateToWorld(worldId = this.store.activeWorldId ?? "default"): void {
    this.store.activeWorldId = worldId;
    this.store.view = { level: "world", worldId };
    this.emit("viewChanged", this.store.view);
    if (this.config?.autoLoad !== false) {
      void this.loadWorld(worldId);
    }
  }

  navigateToCity(cityId: string): void {
    this.store.view = { level: "city", cityId };
    this.emit("viewChanged", this.store.view);
    if (this.config?.autoLoad !== false) {
      void this.loadCity(cityId);
    }
  }

  navigateToDistrict(cityId: string, directoryPath: string): void {
    this.store.view = { level: "district", cityId, path: directoryPath };
    this.emit("viewChanged", this.store.view);
    this.emit("districtClicked", { cityId, path: directoryPath });
  }

  navigateToBuilding(cityId: string, filePath: string): void {
    this.store.view = { level: "building", cityId, path: filePath };
    this.emit("viewChanged", this.store.view);
    this.emit("buildingClicked", { cityId, path: filePath });
  }

  highlightBuilding(cityId: string, filePath: string): void {
    this.store.highlightedFile = `${cityId}:${filePath}`;
  }

  clearHighlight(): void {
    this.store.highlightedFile = null;
  }

  getCurrentView(): ViewState {
    return this.store.view;
  }

  getCityHealth(cityId: string): ChecksStatus | null {
    return this.store.cities.get(cityId)?.checks_status ?? null;
  }

  on(event: "viewChanged", handler: (view: ViewState) => void): void;
  on(event: "buildingClicked", handler: (file: FileRef) => void): void;
  on(event: "districtClicked", handler: (dir: DirectoryRef) => void): void;
  on(event: "stateChanged", handler: () => void): void;
  on(event: keyof EventHandlers, handler: (arg: any) => void): void {
    const list = this.handlers[event] as unknown as Array<(...args: any[]) => void>;
    list.push(handler as (...args: any[]) => void);
  }

  setWorldSummary(world: WorldResponse): void {
    this.store.activeWorldId = world.id;
    this.store.cities.clear();
    for (const city of world.cities) {
      this.store.cities.set(city.id, city);
      this.store.seqMap.set(city.id, city.seq);
      this.store.hashMap.set(city.id, city.blueprint_hash);
    }
    this.emit("stateChanged", undefined);
  }

  setCityBlueprint(cityId: string, blueprint: CityBlueprint): void {
    this.store.blueprints.set(cityId, blueprint);
    this.store.hashMap.set(cityId, blueprint.hash);
    this.store.seqMap.set(cityId, (this.store.seqMap.get(cityId) ?? 0) + 1);
    this.emit("stateChanged", undefined);
  }

  async loadWorld(worldId = this.store.activeWorldId ?? "default"): Promise<void> {
    const world = await this.fetchJson<WorldResponse>(`/api/v1/worlds/${encodeURIComponent(worldId)}`);
    this.setWorldSummary(world);
  }

  async loadCity(cityId: string): Promise<void> {
    type CityResponse = {
      id: string;
      blueprint_hash: string | null;
      blueprint: CityBlueprint | null;
    };
    const city = await this.fetchJson<CityResponse>(`/api/v1/cities/${encodeURIComponent(cityId)}`);
    if (city.blueprint) {
      this.store.blueprints.set(cityId, city.blueprint);
      this.store.hashMap.set(cityId, city.blueprint_hash ?? city.blueprint.hash);
      this.emit("stateChanged", undefined);
    }
  }

  async pollOnce(): Promise<void> {
    this.store.lastPollAt = Date.now();
    if (this.store.view.level === "world") {
      const previousHash = new Map(this.store.hashMap);
      await this.loadWorld(this.store.view.worldId);
      for (const [cityId, hash] of this.store.hashMap.entries()) {
        if (previousHash.get(cityId) !== hash && this.store.blueprints.has(cityId)) {
          await this.loadCity(cityId);
        }
      }
      return;
    }
    const cityId =
      this.store.view.level === "city"
        ? this.store.view.cityId
        : this.store.view.level === "district"
          ? this.store.view.cityId
          : this.store.view.cityId;
    await this.loadCity(cityId);
  }

  startPolling(): void {
    if (this.pollTimer || !this.config) {
      return;
    }
    const interval = this.config.pollIntervalMs ?? 30_000;
    this.pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void this.pollOnce();
    }, interval);
  }

  stopPolling(): void {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  search(query: string): string[] {
    this.store.searchQuery = query;
    if (!query.trim()) {
      this.store.searchResults = [];
      return [];
    }
    const q = query.toLowerCase();
    const results: string[] = [];
    for (const [cityId, blueprint] of this.store.blueprints.entries()) {
      for (const filePath of Object.keys(blueprint.files)) {
        if (filePath.toLowerCase().includes(q)) {
          results.push(`${cityId}:${filePath}`);
          continue;
        }
        for (const symbol of blueprint.files[filePath].symbols) {
          if (symbol.name.toLowerCase().includes(q)) {
            results.push(`${cityId}:${filePath}#${symbol.name}`);
          }
        }
      }
    }
    this.store.searchResults = results;
    return results;
  }

  getStoreSnapshot(): CityBuildingStore {
    return this.store;
  }

  private async loadInitialData(): Promise<void> {
    try {
      if (this.store.view.level === "world") {
        await this.loadWorld(this.store.view.worldId);
      } else if (this.store.view.level === "city") {
        await this.loadWorld(this.store.activeWorldId ?? "default");
        await this.loadCity(this.store.view.cityId);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private async fetchJson<T>(route: string): Promise<T> {
    if (!this.config) {
      throw new Error("Renderer is not mounted");
    }
    const base = this.config.serverUrl.replace(/\/+$/, "");
    const fn = this.config.fetchImpl ?? fetch;
    const response = await fn(`${base}${route}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${route}`);
    }
    return (await response.json()) as T;
  }

  private handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.store.lastError = err.message;
    this.config?.onError?.(err);
    this.emit("stateChanged", undefined);
  }

  private emit(event: keyof EventHandlers, payload: unknown): void {
    for (const handler of this.handlers[event]) {
      handler(payload as never);
    }
  }
}

export function createRenderer(): CityBuildingRenderer {
  return new CityBuildingRenderer();
}
