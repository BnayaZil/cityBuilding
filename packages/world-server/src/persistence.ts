import type { MemoryState } from "./state.js";

export interface StatePersistence {
  healthCheck(): Promise<boolean>;
  loadState(): Promise<MemoryState | null>;
  saveState(state: MemoryState): Promise<void>;
  runMigrations(): Promise<void>;
  close(): Promise<void>;
}

export class NoopPersistence implements StatePersistence {
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async loadState(): Promise<MemoryState | null> {
    return null;
  }
  async saveState(_state: MemoryState): Promise<void> {}
  async runMigrations(): Promise<void> {}
  async close(): Promise<void> {}
}
