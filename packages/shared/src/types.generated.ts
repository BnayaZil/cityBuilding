/* eslint-disable */
// Generated file. Do not edit directly.

export type ChecksStatus = 'success' | 'failure' | 'pending' | 'mixed' | 'unknown';
export type SymbolType = 'class' | 'function' | 'method' | 'interface' | 'enum' | 'variable';
export type Visibility = 'exported' | 'public' | 'private' | 'protected' | 'internal';
export type DistrictStyle = 'commercial' | 'residential' | 'industrial';
export type SourceType = 'github-action' | 'cli';

export interface CityBlueprint {
  checks?: Checks | null;
  edges: [string, string][];
  files: {
    [k: string]: FileNode;
  };
  hash: string;
  hints?: Hints | null;
  source: SourceInfo;
  stats: Stats;
  ts: string;
  v: string;
  [k: string]: unknown;
}
export interface Checks {
  runs: CheckRun[];
  status: ChecksStatus;
  [k: string]: unknown;
}
export interface CheckRun {
  conclusion: string;
  name: string;
  [k: string]: unknown;
}
export interface FileNode {
  lang: string;
  symbols: Symbol[];
  [k: string]: unknown;
}
export interface Symbol {
  loc?: SymbolLocation | null;
  members?: SymbolMember[];
  name: string;
  type: SymbolType;
  vis: Visibility;
  [k: string]: unknown;
}
export interface SymbolLocation {
  endLine: number;
  startLine: number;
  [k: string]: unknown;
}
export interface SymbolMember {
  loc?: SymbolLocation | null;
  name: string;
  type: SymbolType;
  vis: Visibility;
  [k: string]: unknown;
}
export interface Hints {
  districts?: DistrictHint[];
  [k: string]: unknown;
}
export interface DistrictHint {
  label?: string | null;
  path: string;
  style?: DistrictStyle | null;
  [k: string]: unknown;
}
export interface SourceInfo {
  branch: string;
  repo: string;
  sha: string;
  type: SourceType;
  [k: string]: unknown;
}
export interface Stats {
  files: number;
  langs: {
    [k: string]: number;
  };
  symbols: number;
  [k: string]: unknown;
}

export type ChecksStatus = 'success' | 'failure' | 'pending' | 'mixed' | 'unknown';

export interface CitySummary {
  blueprint_hash: string;
  checks_status: ChecksStatus;
  files_count: number;
  id: string;
  name: string;
  repo: string;
  seq: number;
  symbols_count: number;
  [k: string]: unknown;
}

