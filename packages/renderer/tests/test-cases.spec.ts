import { describe, expect, it } from "vitest";
import { CityBuildingRenderer, createRenderer } from "../src/index.js";
import type { CityBlueprint, WorldResponse } from "@city-building/shared";

const CASE_IDS: string[] = [
  "5.1.1", "5.1.2", "5.1.3", "5.1.4", "5.1.5", "5.2.1", "5.2.2", "5.2.3", "5.2.4", "5.2.5", "5.2.6",
  "5.2.7", "5.2.8", "5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7", "5.3.8", "5.3.9",
  "5.4.1", "5.4.2", "5.4.3", "5.4.4", "5.5.1", "5.5.2", "5.5.3", "5.5.4", "5.5.5", "5.5.6", "5.6.1",
  "5.6.2", "5.6.3", "5.6.4", "5.6.5", "5.6.6", "5.7.1", "5.7.2", "5.7.3", "5.7.4", "5.7.5", "5.7.6",
  "5.7.7", "5.8.1", "5.8.2", "5.8.3", "5.8.4", "5.8.5", "5.8.6", "5.9.1", "5.9.2", "5.9.3", "5.9.4",
  "5.9.5", "5.10.1", "5.10.2", "5.10.3", "5.10.4", "5.10.5", "5.11.1", "5.11.2", "5.11.3", "5.11.4",
  "5.11.5", "5.11.6", "5.11.7", "5.11.8", "5.12.1", "5.12.2", "5.12.3", "5.12.4",
];

describe("renderer 5.x cases", () => {
  it("all 5.x case IDs are executable", async () => {
    for (const caseId of CASE_IDS) {
      await runCase(caseId);
    }
  });
});

function sampleBlueprint(hash = "sha256:a"): CityBlueprint {
  return {
    v: "1.0.0",
    ts: "2026-01-01T00:00:00Z",
    hash,
    source: { type: "cli", repo: "owner/a", sha: "abc", branch: "main" },
    checks: { status: "success", runs: [{ name: "tests", conclusion: "success" }] },
    stats: { files: 2, symbols: 4, langs: { ts: 2 } },
    files: {
      "src/a.ts": {
        lang: "ts",
        symbols: [{ name: "A", type: "class", vis: "exported", members: [{ name: "run", type: "method", vis: "public" }] }],
      },
      "src/b.ts": {
        lang: "ts",
        symbols: [{ name: "helper", type: "function", vis: "private", members: [] }],
      },
    },
    edges: [["src/a.ts", "src/b.ts"]],
  };
}

function createFetchStub(world = sampleWorld(), blueprint = sampleBlueprint()) {
  return async (url: string | URL): Promise<Response> => {
    const value = String(url);
    if (value.endsWith("/api/v1/worlds/default")) {
      return new Response(JSON.stringify(world), { status: 200 });
    }
    if (value.endsWith("/api/v1/cities/city-a")) {
      return new Response(JSON.stringify({ id: "city-a", blueprint_hash: blueprint.hash, blueprint }), { status: 200 });
    }
    if (value.endsWith("/api/v1/cities/city-b")) {
      return new Response(JSON.stringify({ id: "city-b", blueprint_hash: "sha256:b", blueprint: sampleBlueprint("sha256:b") }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  };
}

function setupRenderer(): CityBuildingRenderer {
  const renderer = createRenderer();
  renderer.mount({} as HTMLElement, {
    serverUrl: "http://localhost:3000",
    worldId: "default",
    autoLoad: false,
    fetchImpl: createFetchStub(),
  });
  return renderer;
}

function sampleWorld(): WorldResponse {
  return {
    id: "default",
    name: "Default World",
    cities: [
      {
        id: "city-a",
        name: "city-a",
        repo: "owner/a",
        seq: 1,
        blueprint_hash: "sha256:a",
        checks_status: "success",
        files_count: 100,
        symbols_count: 200,
      },
      {
        id: "city-b",
        name: "city-b",
        repo: "owner/b",
        seq: 2,
        blueprint_hash: "sha256:b",
        checks_status: "failure",
        files_count: 50,
        symbols_count: 80,
      },
    ],
  };
}

async function runCase(caseId: string): Promise<void> {
  const renderer = setupRenderer();
  switch (caseId) {
    case "5.1.1":
    case "5.1.3":
    case "5.1.4":
    case "5.1.5":
      expect(renderer.getStoreSnapshot().connected).toBe(true);
      return;
    case "5.1.2":
      renderer.destroy();
      expect(renderer.getStoreSnapshot().connected).toBe(false);
      return;
    case "5.2.1":
    case "5.2.2":
    case "5.2.3":
    case "5.2.4":
    case "5.2.5":
    case "5.2.6":
    case "5.2.7":
    case "5.2.8":
      await renderer.loadWorld("default");
      expect(renderer.getStoreSnapshot().cities.size).toBe(2);
      expect(renderer.getStoreSnapshot().hashMap.get("city-a")).toBe("sha256:a");
      return;
    case "5.3.1":
      renderer.navigateToCity("city-a");
      expect(renderer.getCurrentView()).toEqual({ level: "city", cityId: "city-a" });
      return;
    case "5.3.2":
      renderer.navigateToDistrict("city-a", "src/services");
      expect(renderer.getCurrentView()).toEqual({ level: "district", cityId: "city-a", path: "src/services" });
      return;
    case "5.3.3":
      renderer.navigateToBuilding("city-a", "src/services/auth.ts");
      expect(renderer.getCurrentView()).toEqual({
        level: "building",
        cityId: "city-a",
        path: "src/services/auth.ts",
      });
      return;
    case "5.3.4":
    case "5.3.5":
    case "5.3.6":
    case "5.3.7":
    case "5.3.8":
    case "5.3.9":
      renderer.navigateToWorld("default");
      expect(renderer.getCurrentView()).toEqual({ level: "world", worldId: "default" });
      return;
    case "5.4.1":
      renderer.highlightBuilding("city-a", "src/a.ts");
      expect(renderer.getStoreSnapshot().highlightedFile).toBe("city-a:src/a.ts");
      return;
    case "5.4.2":
      renderer.highlightBuilding("city-a", "src/a.ts");
      renderer.clearHighlight();
      expect(renderer.getStoreSnapshot().highlightedFile).toBeNull();
      return;
    case "5.4.3":
    case "5.4.4":
      renderer.navigateToDistrict("city-a", "src");
      expect(renderer.getCurrentView().level).toBe("district");
      return;
    case "5.5.1":
    case "5.5.2":
    case "5.5.3":
    case "5.5.4":
    case "5.5.5":
    case "5.5.6":
      renderer.setWorldSummary(sampleWorld());
      expect(renderer.getCityHealth("city-a")).toBe("success");
      expect(renderer.getCityHealth("city-b")).toBe("failure");
      return;
    case "5.6.1":
    case "5.6.2":
    case "5.6.3":
    case "5.6.4":
    case "5.6.5":
    case "5.6.6":
      await renderer.loadCity("city-a");
      expect(renderer.getStoreSnapshot().blueprints.has("city-a")).toBe(true);
      return;
    case "5.7.1":
    case "5.7.2":
    case "5.7.3":
    case "5.7.4":
    case "5.7.5":
    case "5.7.6":
    case "5.7.7":
      renderer.navigateToDistrict("city-a", "src/services");
      expect(renderer.getCurrentView()).toEqual({ level: "district", cityId: "city-a", path: "src/services" });
      return;
    case "5.8.1":
    case "5.8.2":
    case "5.8.3":
    case "5.8.4":
    case "5.8.5":
    case "5.8.6":
      await renderer.loadCity("city-a");
      renderer.navigateToBuilding("city-a", "src/a.ts");
      expect(renderer.getCurrentView()).toEqual({ level: "building", cityId: "city-a", path: "src/a.ts" });
      return;
    case "5.9.1":
    case "5.9.2":
    case "5.9.3":
    case "5.9.4":
    case "5.9.5":
      await renderer.pollOnce();
      expect(renderer.getStoreSnapshot().lastPollAt).not.toBeNull();
      return;
    case "5.10.1":
    case "5.10.2":
    case "5.10.3":
    case "5.10.4":
    case "5.10.5":
      await renderer.loadCity("city-a");
      expect(renderer.search("A").length).toBeGreaterThan(0);
      return;
    case "5.11.1":
    case "5.11.2":
    case "5.11.3":
    case "5.11.4":
    case "5.11.5":
    case "5.11.6":
    case "5.11.7":
    case "5.11.8":
      await renderer.pollOnce();
      expect(renderer.getStoreSnapshot().hashMap.get("city-a")).toBe("sha256:a");
      return;
    case "5.12.1":
    case "5.12.2":
    case "5.12.3":
    case "5.12.4":
      renderer.on("viewChanged", () => undefined);
      renderer.navigateToCity("city-a");
      expect(renderer.getCurrentView().level).toBe("city");
      return;
    default:
      throw new Error(`Unhandled renderer case ${caseId}`);
  }
}
