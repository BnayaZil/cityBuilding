export type Route =
  | { kind: "landing" }
  | { kind: "city"; cityId: string }
  | { kind: "path"; cityId: string; path: string };

export function parseRoute(urlPath: string): Route {
  if (urlPath === "/") {
    return { kind: "landing" };
  }
  const parts = urlPath.split("/").filter(Boolean);
  if (parts[0] !== "cities" || !parts[1]) {
    return { kind: "landing" };
  }
  if (!parts[2]) {
    return { kind: "city", cityId: parts[1] };
  }
  return { kind: "path", cityId: parts[1], path: parts.slice(2).join("/") };
}

export function routeToPath(route: Route): string {
  switch (route.kind) {
    case "landing":
      return "/";
    case "city":
      return `/cities/${route.cityId}`;
    case "path":
      return `/cities/${route.cityId}/${route.path}`;
  }
}
