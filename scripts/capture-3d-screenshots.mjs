#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const worldServerUrl = process.env.WORLD_SERVER_URL ?? "http://127.0.0.1:3000";
const worldId = process.env.WORLD_ID ?? "default";
const outputDir = path.resolve(rootDir, process.env.SCREENSHOT_OUTPUT_DIR ?? "artifacts/visual-feedback");
const screenshotTimeoutMs = parsePositiveInt(process.env.SCREENSHOT_TIMEOUT_MS, 45_000);
const viewportWidth = parsePositiveInt(process.env.SCREENSHOT_WIDTH, 1680);
const viewportHeight = parsePositiveInt(process.env.SCREENSHOT_HEIGHT, 1020);
const shouldBootstrap = parseBoolean(process.env.VISUAL_BOOTSTRAP, true);
const bootstrapRepo = process.env.CITY_BOOTSTRAP_REPO ?? `local/cityBuilding-visual-${Date.now()}`;
const requireWebgl = parseBoolean(process.env.REQUIRE_WEBGL, true);
const headlessBrowser = parseBoolean(process.env.SCREENSHOT_HEADLESS, true);
const renderDebounceMs = parsePositiveInt(process.env.RENDER_DEBOUNCE_MS, 1_800);
const renderStabilityIntervalMs = parsePositiveInt(process.env.RENDER_STABILITY_INTERVAL_MS, 320);
const renderStableSamples = parsePositiveInt(process.env.RENDER_STABLE_SAMPLES, 3);
const renderStabilityTimeoutMs = parsePositiveInt(process.env.RENDER_STABILITY_TIMEOUT_MS, 9_000);

const worldScreenshotPath = path.join(outputDir, "world.png");
const cityScreenshotPath = path.join(outputDir, "city.png");
const cityStageScreenshotPath = path.join(outputDir, "city-stage.png");
const manifestPath = path.join(outputDir, "manifest.json");

/**
 * Usage:
 *   npm run capture:3d
 *
 * Optional env:
 *   WORLD_SERVER_URL=http://127.0.0.1:3000
 *   WORLD_ID=default
 *   CITY_ID=city-123
 *   VISUAL_BOOTSTRAP=true|false
 *   SCREENSHOT_OUTPUT_DIR=artifacts/visual-feedback
 *   SCREENSHOT_WIDTH=1680
 *   SCREENSHOT_HEIGHT=1020
 *   SCREENSHOT_TIMEOUT_MS=45000
 *   REQUIRE_WEBGL=true
 *   SCREENSHOT_HEADLESS=true
 *   RENDER_DEBOUNCE_MS=1800
 *   RENDER_STABILITY_INTERVAL_MS=320
 *   RENDER_STABLE_SAMPLES=3
 *   RENDER_STABILITY_TIMEOUT_MS=9000
 */

function parsePositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function routeUrl(route) {
  return new URL(route, worldServerUrl).toString();
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

async function fetchJson(route) {
  const response = await fetch(routeUrl(route), { method: "GET" });
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${route}`);
  }
  return body;
}

async function isServerHealthy() {
  try {
    const response = await fetch(routeUrl("/api/v1/health"), { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy()) {
      return true;
    }
    await sleep(400);
  }
  return false;
}

function resolvePort(url) {
  const parsed = new URL(url);
  if (parsed.port) {
    return Number.parseInt(parsed.port, 10);
  }
  return parsed.protocol === "https:" ? 443 : 80;
}

async function stopProcessGracefully(child, timeoutMs = 6_000) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([once(child, "exit").then(() => true), sleep(timeoutMs).then(() => false)]);
  if (!exited) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Unable to import "playwright". Run "npm install --save-dev playwright". Original error: ${String(error)}`,
    );
  }
}

async function launchBrowser(chromium) {
  const launchOptions = {
    headless: headlessBrowser,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  };
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    const message = String(error);
    if (!message.includes("Executable doesn't exist")) {
      throw error;
    }
    console.log("Chromium is missing for Playwright. Installing once...");
    await runCommand("npx", ["--yes", "playwright", "install", "chromium"]);
    return chromium.launch(launchOptions);
  }
}

async function resolveCityId() {
  if (process.env.CITY_ID) {
    return process.env.CITY_ID;
  }

  try {
    const localState = JSON.parse(await readFile(path.resolve(rootDir, ".city.local.json"), "utf8"));
    if (typeof localState.cityId === "string" && localState.cityId.length > 0) {
      return localState.cityId;
    }
  } catch {
    // Ignore missing or malformed local state.
  }

  const world = await fetchJson(`/api/v1/worlds/${encodeURIComponent(worldId)}`);
  const cities = Array.isArray(world?.cities) ? world.cities : [];
  const firstCityId = cities[0]?.id;
  if (!firstCityId) {
    throw new Error(
      `No city available in world "${worldId}". Run "npm run bootstrap:local" or set VISUAL_BOOTSTRAP=true.`,
    );
  }
  return firstCityId;
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function waitForVisualSettle(page, selector, label) {
  await page.waitForSelector(selector, { state: "visible" });

  if (renderDebounceMs > 0) {
    await page.waitForTimeout(renderDebounceMs);
  }

  const startedAt = Date.now();
  const locator = page.locator(selector);
  let previousHash = "";
  let stableSamples = 0;
  while (Date.now() - startedAt < renderStabilityTimeoutMs) {
    const samplePng = await locator.screenshot();
    const currentHash = hashBuffer(samplePng);
    if (currentHash === previousHash) {
      stableSamples += 1;
    } else {
      stableSamples = 1;
      previousHash = currentHash;
    }
    if (stableSamples >= renderStableSamples) {
      return;
    }
    await page.waitForTimeout(renderStabilityIntervalMs);
  }
  console.warn(`[capture:3d] ${label} did not fully stabilize before timeout; capturing latest frame.`);
}

async function readStageRenderMode(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector("#cb-three-stage canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        hasCanvas: false,
        mode: "none",
        width: 0,
        height: 0,
      };
    }
    let hasWebgl2 = false;
    let hasWebgl = false;
    try {
      hasWebgl2 = !!canvas.getContext("webgl2");
    } catch {
      hasWebgl2 = false;
    }
    try {
      hasWebgl = !!canvas.getContext("webgl");
    } catch {
      hasWebgl = false;
    }
    const mode = hasWebgl2 ? "webgl2" : hasWebgl ? "webgl" : "fallback";
    return {
      hasCanvas: true,
      mode,
      width: canvas.width,
      height: canvas.height,
    };
  });
}

async function waitForCityRendererReady(page, webglWarnings) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < renderStabilityTimeoutMs) {
    const stage = await readStageRenderMode(page);
    if (stage.hasCanvas && (stage.mode === "webgl2" || stage.mode === "webgl")) {
      return stage;
    }
    if (!requireWebgl && stage.hasCanvas) {
      return stage;
    }
    if (webglWarnings.length > 0 && requireWebgl) {
      break;
    }
    await page.waitForTimeout(renderStabilityIntervalMs);
  }
  const finalStage = await readStageRenderMode(page);
  if (requireWebgl) {
    const warningSuffix =
      webglWarnings.length > 0 ? ` Console warning: ${webglWarnings[webglWarnings.length - 1]}` : "";
    throw new Error(
      `WebGL renderer was not ready for city stage (mode=${finalStage.mode}, canvas=${finalStage.hasCanvas}).${warningSuffix}`,
    );
  }
  console.warn(`[capture:3d] WebGL not available (mode=${finalStage.mode}); continuing with fallback renderer.`);
  return finalStage;
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  console.log("[capture:3d] Building web bundle...");
  await runCommand("npm", ["run", "build", "--workspace", "@city-building/web"]);

  let worldServerProcess = null;
  const serverAlreadyRunning = await isServerHealthy();
  if (!serverAlreadyRunning) {
    console.log("[capture:3d] world-server is offline. Building and starting a local instance...");
    await runCommand("npm", ["run", "build", "--workspace", "@city-building/world-server"]);

    const port = resolvePort(worldServerUrl);
    worldServerProcess = spawn("node", ["packages/world-server/dist/index.js"], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: "inherit",
    });

    const healthy = await waitForHealth(30_000);
    if (!healthy) {
      await stopProcessGracefully(worldServerProcess);
      throw new Error(`Timed out waiting for world-server health at ${routeUrl("/api/v1/health")}`);
    }
  } else {
    console.log("[capture:3d] Reusing running world-server.");
  }

  try {
    if (shouldBootstrap) {
      console.log("[capture:3d] Refreshing city data via bootstrap...");
      await runCommand("npm", ["run", "bootstrap:local"], {
        env: {
          WORLD_SERVER_URL: worldServerUrl,
          WORLD_ID: worldId,
          CITY_BOOTSTRAP_REPO: bootstrapRepo,
        },
      });
    } else {
      console.log("[capture:3d] Skipping bootstrap (VISUAL_BOOTSTRAP=false).");
    }

    const cityId = await resolveCityId();
    const { chromium } = await loadPlaywright();
    const browser = await launchBrowser(chromium);

    try {
      const context = await browser.newContext({
        viewport: {
          width: viewportWidth,
          height: viewportHeight,
        },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(screenshotTimeoutMs);
      const webglWarnings = [];
      page.on("console", (message) => {
        const text = message.text();
        if (text.includes("WebGL 3D view failed")) {
          webglWarnings.push(text);
        }
      });

      console.log(`[capture:3d] Capturing world screenshot (${routeUrl("/")})...`);
      await page.goto(routeUrl("/"), { waitUntil: "networkidle" });
      await page.waitForSelector("#cb-world-map-shell", { state: "visible" });
      await page.waitForSelector(".cb-world-node", { state: "visible" });
      await waitForVisualSettle(page, "#cb-world-map-shell", "World map");
      await page.screenshot({ path: worldScreenshotPath, fullPage: true });

      const cityUrl = routeUrl(`/cities/${encodeURIComponent(cityId)}`);
      console.log(`[capture:3d] Capturing city screenshot (${cityUrl})...`);
      await page.goto(cityUrl, { waitUntil: "networkidle" });
      await page.waitForSelector("#cb-three-stage", { state: "visible" });
      await page.waitForSelector("#cb-three-stage canvas", { state: "visible" });
      const stageInfo = await waitForCityRendererReady(page, webglWarnings);
      await waitForVisualSettle(page, "#cb-three-stage", "City stage");
      await page.screenshot({ path: cityScreenshotPath, fullPage: true });
      await page.locator("#cb-three-stage").screenshot({ path: cityStageScreenshotPath });

      const manifest = {
        generatedAt: new Date().toISOString(),
        worldServerUrl,
        worldId,
        cityId,
        screenshots: {
          world: path.relative(rootDir, worldScreenshotPath),
          city: path.relative(rootDir, cityScreenshotPath),
          cityStage: path.relative(rootDir, cityStageScreenshotPath),
        },
        renderer: {
          cityStageMode: stageInfo.mode,
          requireWebgl,
        },
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      console.log("[capture:3d] Complete.");
      console.log(`- ${manifest.screenshots.world}`);
      console.log(`- ${manifest.screenshots.city}`);
      console.log(`- ${manifest.screenshots.cityStage}`);
      console.log(`- ${path.relative(rootDir, manifestPath)}`);
    } finally {
      await browser.close();
    }
  } finally {
    if (worldServerProcess) {
      console.log("[capture:3d] Stopping local world-server.");
      await stopProcessGracefully(worldServerProcess);
    }
  }
}

main().catch((error) => {
  console.error(`[capture:3d] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
