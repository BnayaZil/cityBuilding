import { mountWebApp } from "./main.js";

declare global {
  interface Window {
    __CITY_SERVER_URL__?: string;
  }
}

const container = document.getElementById("app");
if (container) {
  const serverUrl = window.__CITY_SERVER_URL__ ?? window.location.origin;
  const app = mountWebApp(container, window.location.pathname, {
    serverUrl,
  });
  window.addEventListener("popstate", () => {
    app.navigate(window.location.pathname);
  });
}
