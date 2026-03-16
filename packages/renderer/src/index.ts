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
}

type EventHandlers = {
  viewChanged: Array<(view: ViewState) => void>;
  buildingClicked: Array<(file: FileRef) => void>;
  districtClicked: Array<(dir: DirectoryRef) => void>;
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
}

export class CityBuildingRenderer {
  private config: RendererConfig | null = null;
  private mounted = false;
  private container: HTMLElement | null = null;
  private handlers: EventHandlers = { viewChanged: [], buildingClicked: [], districtClicked: [] };
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
  }

  destroy(): void {
    this.mounted = false;
    this.container = null;
    this.config = null;
    this.store.connected = false;
    this.handlers = { viewChanged: [], buildingClicked: [], districtClicked: [] };
  }

  navigateToWorld(worldId = this.store.activeWorldId ?? "default"): void {
    this.store.activeWorldId = worldId;
    this.store.view = { level: "world", worldId };
    this.emit("viewChanged", this.store.view);
  }

  navigateToCity(cityId: string): void {
    this.store.view = { level: "city", cityId };
    this.emit("viewChanged", this.store.view);
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
  on(event: keyof EventHandlers, handler: (arg: any) => void): void {
    this.handlers[event].push(handler);
  }

  setWorldSummary(world: WorldResponse): void {
    this.store.activeWorldId = world.id;
    this.store.cities.clear();
    for (const city of world.cities) {
      this.store.cities.set(city.id, city);
      this.store.seqMap.set(city.id, city.seq);
      this.store.hashMap.set(city.id, city.blueprint_hash);
    }
  }

  setCityBlueprint(cityId: string, blueprint: CityBlueprint): void {
    this.store.blueprints.set(cityId, blueprint);
    this.store.hashMap.set(cityId, blueprint.hash);
    this.store.seqMap.set(cityId, (this.store.seqMap.get(cityId) ?? 0) + 1);
  }

  getStoreSnapshot(): CityBuildingStore {
    return this.store;
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
