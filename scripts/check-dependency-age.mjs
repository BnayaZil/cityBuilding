import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_AGE_DAYS = 12;
const DEFAULT_REGISTRY = "https://npm.dev.wixpress.com";
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_FETCH_RETRIES = 1;
const DEFAULT_FETCH_CONCURRENCY = 4;
const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];

const maxAgeDays = parseMaxAgeDays(process.env.DEPENDENCY_MAX_AGE_DAYS);
const registry = normalizeRegistry(process.env.DEPENDENCY_AGE_REGISTRY ?? DEFAULT_REGISTRY);
const fetchTimeoutMs = parseOptionalNonNegativeInteger(
  "DEPENDENCY_AGE_FETCH_TIMEOUT_MS",
  process.env.DEPENDENCY_AGE_FETCH_TIMEOUT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
);
const fetchRetries = parseOptionalNonNegativeInteger(
  "DEPENDENCY_AGE_FETCH_RETRIES",
  process.env.DEPENDENCY_AGE_FETCH_RETRIES,
  DEFAULT_FETCH_RETRIES,
);
const fetchConcurrency = Math.max(
  1,
  parseOptionalNonNegativeInteger(
    "DEPENDENCY_AGE_FETCH_CONCURRENCY",
    process.env.DEPENDENCY_AGE_FETCH_CONCURRENCY,
    DEFAULT_FETCH_CONCURRENCY,
  ),
);
const now = new Date();
const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

const lockfilePath = path.resolve("package-lock.json");
const lockfileRaw = await readFile(lockfilePath, "utf8");
const lockfile = JSON.parse(lockfileRaw);

if (!lockfile.packages || typeof lockfile.packages !== "object") {
  throw new Error("package-lock.json must use lockfileVersion >= 2 with a top-level packages map.");
}

const manifestEntries = Object.entries(lockfile.packages).filter(([pkgPath, pkg]) => {
  if (!pkg || typeof pkg !== "object") {
    return false;
  }
  if (pkgPath.includes("node_modules")) {
    return false;
  }
  return true;
});

const workspacePackageNames = new Set(
  manifestEntries
    .map(([, pkg]) => pkg.name)
    .filter((pkgName) => typeof pkgName === "string" && pkgName.length > 0),
);

const lockedDirectDependencies = collectLockedDirectDependencies(lockfile.packages, manifestEntries, workspacePackageNames);

if (lockedDirectDependencies.unresolved.length > 0) {
  console.error("Dependency age check could not resolve locked versions for:");
  for (const unresolved of lockedDirectDependencies.unresolved) {
    console.error(
      `- ${unresolved.name} from ${unresolved.source} (${unresolved.requestedRange})`,
    );
  }
  process.exit(1);
}

const checks = [...lockedDirectDependencies.dependencies.values()].sort((a, b) =>
  a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
);

console.log(
  `Checking ${checks.length} direct dependency version(s) against ${registry} (minimum age: ${maxAgeDays} day(s), concurrency: ${fetchConcurrency}).`,
);

const violations = [];
const lookupErrors = [];
const tasks = checks.map((dependency, index) => ({ dependency, index }));
let nextTaskIndex = 0;

async function runLookupWorker() {
  while (true) {
    const taskIndex = nextTaskIndex;
    nextTaskIndex += 1;
    if (taskIndex >= tasks.length) {
      return;
    }

    const { dependency, index } = tasks[taskIndex];
    console.log(`[${index + 1}/${checks.length}] Checking ${dependency.name}@${dependency.version}`);
    try {
      const publishedAt = await fetchPublishedAt(dependency.name, dependency.version, registry);
      const publishedDate = new Date(publishedAt);
      if (Number.isNaN(publishedDate.getTime())) {
        throw new Error(`Received invalid publish timestamp: ${publishedAt}`);
      }
      const ageMs = now.getTime() - publishedDate.getTime();
      if (ageMs < maxAgeMs) {
        violations.push({
          ...dependency,
          publishedAt: publishedDate.toISOString(),
          ageDays: ageMs / (24 * 60 * 60 * 1000),
        });
      }
    } catch (error) {
      lookupErrors.push({
        ...dependency,
        error: formatError(error),
      });
    }
  }
}

const workerCount = Math.min(fetchConcurrency, tasks.length || 1);
await Promise.all(Array.from({ length: workerCount }, () => runLookupWorker()));

if (lookupErrors.length > 0) {
  console.error("Dependency age check failed because publish metadata could not be verified:");
  for (const lookupError of lookupErrors) {
    console.error(`- ${lookupError.name}@${lookupError.version}: ${lookupError.error}`);
  }
  process.exit(1);
}

if (violations.length > 0) {
  console.error(
    `Dependency age policy violation: ${violations.length} package(s) are newer than ${maxAgeDays} day(s).`,
  );
  for (const violation of violations) {
    const sources = [...violation.sources].sort().join(", ");
    console.error(
      `- ${violation.name}@${violation.version} published ${violation.publishedAt} (${violation.ageDays.toFixed(
        2,
      )} day(s) old), referenced by ${sources}`,
    );
  }
  process.exit(1);
}

console.log(
  `Dependency age policy passed: all checked packages are at least ${maxAgeDays} day(s) old.`,
);

function parseMaxAgeDays(rawValue) {
  return parseOptionalNonNegativeInteger(
    "DEPENDENCY_MAX_AGE_DAYS",
    rawValue,
    DEFAULT_MAX_AGE_DAYS,
  );
}

function normalizeRegistry(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("DEPENDENCY_AGE_REGISTRY cannot be empty.");
  }
  return trimmed.replace(/\/+$/, "");
}

function parseOptionalNonNegativeInteger(label, rawValue, fallback) {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer, got "${rawValue}".`);
  }
  return parsed;
}

function collectLockedDirectDependencies(packagesMap, manifestEntries, workspacePackageNames) {
  const dependencies = new Map();
  const unresolved = [];

  for (const [manifestPath, manifest] of manifestEntries) {
    const sourceLabel = manifestPath === "" ? "root" : manifestPath;

    for (const section of dependencySections) {
      const sectionDependencies = manifest[section];
      if (!sectionDependencies || typeof sectionDependencies !== "object") {
        continue;
      }

      for (const [dependencyName, requestedRange] of Object.entries(sectionDependencies)) {
        if (workspacePackageNames.has(dependencyName)) {
          continue;
        }
        if (typeof requestedRange !== "string") {
          continue;
        }
        if (isLocalDependencySpecifier(requestedRange)) {
          continue;
        }

        const lockEntry = resolveLockEntry(packagesMap, manifestPath, dependencyName);
        if (!lockEntry || typeof lockEntry.version !== "string") {
          unresolved.push({
            name: dependencyName,
            requestedRange,
            source: `${sourceLabel}:${section}`,
          });
          continue;
        }
        if (lockEntry.link === true) {
          continue;
        }

        const key = `${dependencyName}@${lockEntry.version}`;
        if (!dependencies.has(key)) {
          dependencies.set(key, {
            name: dependencyName,
            version: lockEntry.version,
            sources: new Set(),
          });
        }
        dependencies.get(key).sources.add(`${sourceLabel}:${section}`);
      }
    }
  }

  return { dependencies, unresolved };
}

function isLocalDependencySpecifier(range) {
  return (
    range.startsWith("workspace:") ||
    range.startsWith("file:") ||
    range.startsWith("link:") ||
    range.startsWith("git+") ||
    range.startsWith("http://") ||
    range.startsWith("https://")
  );
}

function resolveLockEntry(packagesMap, manifestPath, dependencyName) {
  const candidateKeys = [];
  if (manifestPath.length > 0) {
    candidateKeys.push(`${manifestPath}/node_modules/${dependencyName}`);
  }
  candidateKeys.push(`node_modules/${dependencyName}`);

  for (const candidateKey of candidateKeys) {
    if (packagesMap[candidateKey]) {
      return packagesMap[candidateKey];
    }
  }
  return null;
}

async function fetchPublishedAt(packageName, packageVersion, registryUrl) {
  const spec = `${packageName}@${packageVersion}`;
  const { stdout } = await execFileAsync(
    "npm",
    [
      "view",
      spec,
      "version",
      "time",
      "--json",
      "--silent",
      `--fetch-timeout=${fetchTimeoutMs}`,
      `--fetch-retries=${fetchRetries}`,
      "--registry",
      registryUrl,
    ],
    {
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
      },
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  const parsed = parseJson(stdout);
  const publishedAt = extractPublishedAt(parsed, packageVersion);
  if (!publishedAt) {
    throw new Error(`Publish date for ${spec} was not found in npm metadata.`);
  }
  return publishedAt;
}

function parseJson(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("npm view returned empty output.");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const objectSlice = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(objectSlice);
    }
    throw new Error("npm view output was not valid JSON.");
  }
}

function extractPublishedAt(metadata, packageVersion) {
  if (typeof metadata === "string") {
    return metadata;
  }

  const entries = Array.isArray(metadata) ? metadata : [metadata];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (!entry.time || typeof entry.time !== "object") {
      continue;
    }
    const selectedVersion = typeof entry.version === "string" ? entry.version : packageVersion;
    const timestamp = entry.time[selectedVersion] ?? entry.time[packageVersion];
    if (typeof timestamp === "string") {
      return timestamp;
    }
  }

  return null;
}

function formatError(error) {
  if (error && typeof error === "object") {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) {
      return stderr.trim();
    }
    const message = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}
