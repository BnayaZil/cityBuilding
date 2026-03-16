import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function fileHash(path: string): string {
  const raw = readFileSync(path);
  return createHash("sha256").update(raw).digest("hex");
}

describe("schema and generated type snapshots", () => {
  it("city-blueprint schema hash matches snapshot", () => {
    const hash = fileHash(resolve("src/generated/city-blueprint.schema.json"));
    expect(hash).toBe("32a4886a7322a1897ded57d301b41dd307ce2f79257ddf2b63e5bfe2e18f2586");
  });

  it("city-summary schema hash matches snapshot", () => {
    const hash = fileHash(resolve("src/generated/city-summary.schema.json"));
    expect(hash).toBe("ec0755664321677023b404b57ea627bb78572f0d8bc062a39b2a442854e86804");
  });

  it("generated types include core interfaces", () => {
    const content = readFileSync(resolve("src/types.generated.ts"), "utf8");
    expect(content).toContain("export interface CityBlueprint");
    expect(content).toContain("export interface CitySummary");
  });
});
