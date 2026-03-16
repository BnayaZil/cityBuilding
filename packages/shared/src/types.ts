export type SourceType = "github-action" | "cli";

export type ChecksStatus = "success" | "failure" | "pending" | "mixed" | "unknown";

export interface CheckRun {
  name: string;
  conclusion: string;
}

export interface Checks {
  status: ChecksStatus;
  runs: CheckRun[];
}

export interface Stats {
  files: number;
  symbols: number;
  langs: Record<string, number>;
}

export type DistrictStyle = "commercial" | "residential" | "industrial";

export interface DistrictHint {
  path: string;
  label?: string;
  style?: DistrictStyle;
  [key: string]: unknown;
}

export interface Hints {
  districts: DistrictHint[];
  [key: string]: unknown;
}

export type SymbolType = "class" | "function" | "method" | "interface" | "enum" | "variable";

export type Visibility = "exported" | "public" | "private" | "protected" | "internal";

export interface SymbolLocation {
  startLine: number;
  endLine: number;
}

export interface SymbolMember {
  name: string;
  type: SymbolType;
  vis: Visibility;
  loc?: SymbolLocation;
}

export interface SymbolDef {
  name: string;
  type: SymbolType;
  vis: Visibility;
  members: SymbolMember[];
  loc?: SymbolLocation;
}

export interface FileNode {
  lang: string;
  symbols: SymbolDef[];
}

export interface CityBlueprint {
  v: string;
  ts: string;
  hash: string;
  source: {
    type: SourceType;
    repo: string;
    sha: string;
    branch: string;
  };
  checks: Checks | null;
  stats: Stats;
  hints?: Hints;
  files: Record<string, FileNode>;
  edges: [string, string][];
}

export interface CitySummary {
  id: string;
  name: string;
  repo: string;
  seq: number;
  blueprint_hash: string;
  checks_status: ChecksStatus;
  files_count: number;
  symbols_count: number;
}

export interface WorldResponse {
  id: string;
  name: string;
  cities: CitySummary[];
}
