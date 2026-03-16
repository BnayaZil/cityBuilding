import type { CityBlueprint, WorldResponse } from "./types.js";

export interface CityResponse {
  id: string;
  name: string;
  repo: string;
  blueprint_hash: string | null;
  blueprint: CityBlueprint | null;
}

export interface PushResponse {
  ok: true;
  seq: number;
  blueprint_hash: string;
}

export type GetWorldResponse = WorldResponse;
