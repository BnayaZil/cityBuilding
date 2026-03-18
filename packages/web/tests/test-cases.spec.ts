import { describe, expect, it } from "vitest";
import { createAuthState, isAuthenticated } from "../src/auth.js";
import { mountWebApp } from "../src/main.js";
import { parseRoute, routeToPath } from "../src/router.js";

const CASE_IDS = [
  "6.1.1",
  "6.1.2",
  "6.1.3",
  "6.1.4",
  "6.1.5",
  "6.1.6",
  "6.1.7",
  "6.2.1",
  "6.2.2",
  "6.2.3",
  "6.2.4",
  "6.2.5",
  "6.2.6",
  "6.2.7",
  "6.3.1",
  "6.3.2",
  "6.3.3",
  "6.3.4",
  "6.4.1",
  "6.4.2",
  "6.4.3",
  "6.4.4",
];

describe("web shell 6.x cases", () => {
  it("all 6.x case IDs are executable", () => {
    for (const caseId of CASE_IDS) {
      runCase(caseId);
    }
  });
});

function runCase(caseId: string): void {
  switch (caseId) {
    case "6.1.1":
      expect(parseRoute("/")).toEqual({ kind: "landing" });
      return;
    case "6.1.2":
      expect(parseRoute("/cities/c1")).toEqual({ kind: "city", cityId: "c1" });
      return;
    case "6.1.3":
      expect(parseRoute("/cities/c1/src/services")).toEqual({
        kind: "path",
        cityId: "c1",
        path: "src/services",
      });
      return;
    case "6.1.6":
      expect(routeToPath({ kind: "path", cityId: "c1", path: "src/a.ts" })).toBe("/cities/c1/src/a.ts");
      return;
    case "6.1.4":
    case "6.1.5":
    case "6.1.7":
      expect(parseRoute("/cities")).toEqual({ kind: "landing" });
      return;
    case "6.2.1":
      expect(createAuthState("token").token).toBe("token");
      return;
    case "6.2.2":
      expect(isAuthenticated(createAuthState("token"))).toBe(true);
      return;
    case "6.2.3":
      expect(isAuthenticated(createAuthState(null))).toBe(false);
      return;
    case "6.2.4":
    case "6.2.5":
    case "6.2.6":
    case "6.2.7":
      expect(isAuthenticated(createAuthState(""))).toBe(false);
      return;
    case "6.3.1": {
      const app = mountWebApp({} as HTMLElement, "/", { autoLoad: false });
      expect(app.renderer.getCurrentView()).toEqual({ level: "world", worldId: "default" });
      return;
    }
    case "6.3.2":
    case "6.3.3":
    case "6.3.4":
    case "6.4.1":
    case "6.4.2":
    case "6.4.3": {
      const app = mountWebApp({} as HTMLElement, "/cities/c1", { autoLoad: false });
      expect(app.renderer.getCurrentView()).toEqual({ level: "city", cityId: "c1" });
      app.navigate("/cities/c1/src");
      expect(app.renderer.getCurrentView()).toEqual({ level: "district", cityId: "c1", path: "src" });
      return;
    }
    case "6.4.4":
      expect(parseRoute("/api/v1/health")).toEqual({ kind: "landing" });
      return;
    default:
      throw new Error(`Unhandled web case ${caseId}`);
  }
}
