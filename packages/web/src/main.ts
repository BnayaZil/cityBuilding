import { CityBuildingRenderer, createRenderer } from "@city-building/renderer";
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_WORLD_SERVER_URL } from "@city-building/shared";
import { parseRoute } from "./router.js";

export interface WebApp {
  renderer: CityBuildingRenderer;
  navigate(pathname: string): void;
}

export function mountWebApp(container: HTMLElement, initialPath = "/"): WebApp {
  const renderer = createRenderer();
  renderer.mount(container, {
    serverUrl: DEFAULT_WORLD_SERVER_URL,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  });

  function navigate(pathname: string) {
    const route = parseRoute(pathname);
    if (route.kind === "landing") {
      renderer.navigateToWorld("default");
      return;
    }
    if (route.kind === "city") {
      renderer.navigateToCity(route.cityId);
      return;
    }
    const maybeFile = route.path.includes(".");
    if (maybeFile) {
      renderer.navigateToBuilding(route.cityId, route.path);
    } else {
      renderer.navigateToDistrict(route.cityId, route.path);
    }
  }

  navigate(initialPath);
  return { renderer, navigate };
}
