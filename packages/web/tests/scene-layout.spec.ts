import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CityBlueprint } from "@city-building/shared";
import { buildCitySceneModel, verifyCitySceneModel } from "../src/scene/layout.js";

function sampleBlueprint(): CityBlueprint {
  return {
    v: "1.0.0",
    ts: "2026-01-01T00:00:00Z",
    hash: "sha256:test",
    source: { type: "cli", repo: "owner/repo", sha: "abc", branch: "main" },
    checks: { status: "success", runs: [{ name: "tests", conclusion: "success" }] },
    stats: { files: 4, symbols: 10, langs: { ts: 4 } },
    files: {
      "crates/core/lib.rs": { lang: "rs", symbols: [{ name: "Core", type: "class", vis: "public", members: [] }] },
      "crates/core/main.rs": { lang: "rs", symbols: [{ name: "main", type: "function", vis: "private", members: [] }] },
      "packages/web/main.ts": { lang: "ts", symbols: [{ name: "mount", type: "function", vis: "exported", members: [] }] },
      "packages/web/router.ts": { lang: "ts", symbols: [{ name: "route", type: "function", vis: "exported", members: [] }] },
    },
    edges: [],
  };
}

function denseDistrictBlueprint(fileCount = 12): CityBlueprint {
  const files: CityBlueprint["files"] = {};
  for (let index = 0; index < fileCount; index += 1) {
    files[`packages/web/module-${index}.ts`] = {
      lang: "ts",
      symbols: [
        {
          name: `Module${index}`,
          type: "class",
          vis: "exported",
          members: [{ name: "run", type: "method", vis: "public" }],
        },
      ],
    };
  }

  return {
    v: "1.0.0",
    ts: "2026-01-01T00:00:00Z",
    hash: "sha256:dense",
    source: { type: "cli", repo: "owner/repo", sha: "def", branch: "main" },
    checks: { status: "success", runs: [{ name: "tests", conclusion: "success" }] },
    stats: { files: fileCount, symbols: fileCount * 2, langs: { ts: fileCount } },
    files,
    edges: [],
  };
}

describe("web 3d scene layout", () => {
  it("builds districts and buildings from blueprint", () => {
    const model = buildCitySceneModel("city-1", sampleBlueprint());
    expect(model.districts.length).toBe(2);
    expect(model.buildings.length).toBe(4);
    expect(model.maxHeight).toBeGreaterThan(0);
  });

  it("verification passes for deterministic layout", () => {
    const model = buildCitySceneModel("city-1", sampleBlueprint());
    const validation = verifyCitySceneModel(model);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("adds roads and gardens for larger districts", () => {
    const model = buildCitySceneModel("city-dense", denseDistrictBlueprint(14));
    expect(model.districts.length).toBe(1);
    expect(model.buildings.length).toBe(14);
    expect(model.roads.length).toBeGreaterThan(0);
    expect(model.gardens.length).toBeGreaterThan(0);
    expect(verifyCitySceneModel(model).ok).toBe(true);
  });

  it("verifies provided metadata path quickly", () => {
    const metadataPath = process.env.METADATA_PATH;
    if (!metadataPath) {
      expect(true).toBe(true);
      return;
    }
    const absolutePath = path.isAbsolute(metadataPath) ? metadataPath : path.resolve(process.cwd(), metadataPath);
    const blueprint = JSON.parse(readFileSync(absolutePath, "utf8")) as CityBlueprint;
    const model = buildCitySceneModel("metadata-city", blueprint);
    const validation = verifyCitySceneModel(model);
    expect(validation.ok).toBe(true);
  });
});
