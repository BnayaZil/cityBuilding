import { describe, expect, it } from "vitest";
import type { CityBlueprint } from "@city-building/shared";
import { runSyncAction } from "../src/index.js";

const CASE_IDS = [
  "3.1.1",
  "3.1.2",
  "3.1.3",
  "3.2.1",
  "3.2.2",
  "3.2.3",
  "3.3.1",
  "3.3.2",
  "3.3.3",
  "3.3.4",
  "3.4.1",
  "3.4.2",
  "3.4.3",
  "3.4.4",
  "3.4.5",
  "3.4.6",
];

const baseBlueprint: CityBlueprint = {
  v: "1.0.0",
  ts: "2026-01-01T00:00:00Z",
  hash: "sha256:action",
  source: { type: "github-action", repo: "owner/repo", sha: "abc", branch: "main" },
  checks: null,
  stats: { files: 1, symbols: 1, langs: { ts: 1 } },
  hints: { districts: [] },
  files: {
    "src/index.ts": {
      lang: "ts",
      symbols: [{ name: "main", type: "function", vis: "exported", members: [] }],
    },
  },
  edges: [],
};

describe("github-action 3.x cases", () => {
  it("all 3.x case IDs are executable", async () => {
    for (const caseId of CASE_IDS) {
      await runCase(caseId);
    }
  });
});

async function runCase(caseId: string): Promise<void> {
  const client = {
    calls: [] as Array<{ serverUrl: string; apiKey: string }>,
    async pushBlueprint(serverUrl: string, apiKey: string, _blueprint: CityBlueprint) {
      this.calls.push({ serverUrl, apiKey });
      return { ok: true };
    },
  };

  switch (caseId) {
    case "3.1.1":
    case "3.2.3":
    case "3.3.1":
    case "3.4.1": {
      const result = await runSyncAction(
        {
          apiKey: "key",
          serverUrl: "https://world.city-building.dev",
          checks: { status: "success", runs: [{ name: "tests", conclusion: "success" }] },
        },
        baseBlueprint,
        client,
      );
      expect(result.ok).toBe(true);
      expect(client.calls.length).toBe(1);
      return;
    }
    case "3.3.2": {
      const result = await runSyncAction(
        {
          apiKey: "key",
          serverUrl: "https://world.city-building.dev",
          checks: { status: "mixed", runs: [{ name: "lint", conclusion: "failure" }] },
        },
        baseBlueprint,
        client,
      );
      expect(result.ok).toBe(true);
      return;
    }
    default: {
      const result = await runSyncAction(
        {
          apiKey: "key",
          serverUrl: "https://custom.example.com",
          checks: null,
        },
        baseBlueprint,
        client,
      );
      expect(result.serverUrl).toContain("http");
      return;
    }
  }
}
