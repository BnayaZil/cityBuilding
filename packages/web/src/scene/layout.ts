import type { CityBlueprint, FileNode } from "@city-building/shared";

export interface SceneBuilding {
  cityId: string;
  path: string;
  name: string;
  districtKey: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  symbolsCount: number;
}

export interface SceneDistrict {
  key: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  fileCount: number;
  symbolsCount: number;
}

export interface SceneRoad {
  districtKey: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  orientation: "horizontal" | "vertical";
}

export interface SceneGarden {
  districtKey: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  style: "park" | "plaza";
}

export interface CitySceneModel {
  cityId: string;
  width: number;
  depth: number;
  maxHeight: number;
  districts: SceneDistrict[];
  buildings: SceneBuilding[];
  roads: SceneRoad[];
  gardens: SceneGarden[];
  signature: string;
}

export interface SceneVerification {
  ok: boolean;
  errors: string[];
}

const DISTRICT_PADDING = 1.55;
const DISTRICT_GAP = 2.4;
const CITY_ROW_LIMIT = 56;
const BUILDING_WIDTH = 1.35;
const BUILDING_DEPTH = 1.35;
const BUILDING_NEIGHBOR_GAP = 0.34;
const DISTRICT_ROAD_WIDTH = 1.05;

function districtKey(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "(root)";
  }
  return parts[0];
}

function districtLabel(key: string): string {
  return key === "(root)" ? "Root" : key;
}

function fileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function countSymbols(file: FileNode): number {
  return file.symbols.reduce((total, symbol) => total + 1 + (symbol.members?.length ?? 0), 0);
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function shuffleWithRng(values: number[], rng: () => number): number[] {
  const copy = values.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = copy[index]!;
    copy[index] = copy[swapIndex]!;
    copy[swapIndex] = current;
  }
  return copy;
}

function buildingHeight(symbolsCount: number): number {
  const base = 1.2;
  const growth = Math.sqrt(Math.max(symbolsCount, 1)) * 0.9;
  return Math.min(14, base + growth);
}

type DistrictInput = {
  key: string;
  files: Array<{ path: string; node: FileNode; symbolsCount: number }>;
  symbolsCount: number;
};

function buildDistrictInputs(blueprint: CityBlueprint): DistrictInput[] {
  const grouped = new Map<string, DistrictInput>();
  const filePaths = Object.keys(blueprint.files).sort((a, b) => a.localeCompare(b));
  for (const path of filePaths) {
    const node = blueprint.files[path];
    const symbolsCount = countSymbols(node);
    const key = districtKey(path);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        files: [],
        symbolsCount: 0,
      });
    }
    const district = grouped.get(key)!;
    district.files.push({ path, node, symbolsCount });
    district.symbolsCount += symbolsCount;
  }
  return [...grouped.values()].sort((a, b) => b.symbolsCount - a.symbolsCount || a.key.localeCompare(b.key));
}

type Rect = { x: number; z: number; width: number; depth: number };

function intersectsRect(a: Rect, b: Rect): boolean {
  const EPSILON = 1e-6;
  const ax1 = a.x - a.width / 2;
  const ax2 = a.x + a.width / 2;
  const az1 = a.z - a.depth / 2;
  const az2 = a.z + a.depth / 2;
  const bx1 = b.x - b.width / 2;
  const bx2 = b.x + b.width / 2;
  const bz1 = b.z - b.depth / 2;
  const bz2 = b.z + b.depth / 2;
  return ax1 < bx2 - EPSILON && ax2 > bx1 + EPSILON && az1 < bz2 - EPSILON && az2 > bz1 + EPSILON;
}

function isInsideDistrict(district: SceneDistrict, rect: Rect): boolean {
  const dx = Math.abs(rect.x - district.x) + rect.width / 2;
  const dz = Math.abs(rect.z - district.z) + rect.depth / 2;
  return dx <= district.width / 2 && dz <= district.depth / 2;
}

type AxisRoad = {
  boundaryAfter: number;
  center: number;
  width: number;
};

type AxisLayout = {
  centers: number[];
  roads: AxisRoad[];
  length: number;
};

function buildAxisLayout(
  count: number,
  cellSize: number,
  neighborGap: number,
  roadWidth: number,
  roadAfter: Set<number>,
): AxisLayout {
  const centers: number[] = [];
  const roads: AxisRoad[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    centers.push(cursor + cellSize / 2);
    cursor += cellSize;
    if (index < count - 1) {
      const space = roadAfter.has(index) ? roadWidth : neighborGap;
      if (roadAfter.has(index)) {
        roads.push({
          boundaryAfter: index,
          center: cursor + space / 2,
          width: space,
        });
      }
      cursor += space;
    }
  }
  return {
    centers,
    roads,
    length: cursor,
  };
}

function selectRoadBoundaries(cellCount: number, rng: () => number): Set<number> {
  const boundaries = new Set<number>();
  if (cellCount <= 2) {
    return boundaries;
  }
  const boundaryCount = cellCount - 1;
  const desired = cellCount >= 6 ? (rng() < 0.55 ? 2 : 1) : 1;
  const candidates = shuffleWithRng(
    Array.from({ length: boundaryCount }, (_, index) => index),
    rng,
  );
  for (const candidate of candidates) {
    if (boundaries.size >= desired) {
      break;
    }
    const nearExisting = [...boundaries].some((value) => Math.abs(value - candidate) <= 1);
    if (nearExisting && boundaryCount > 3) {
      continue;
    }
    boundaries.add(candidate);
  }
  if (boundaries.size === 0) {
    boundaries.add(Math.floor((boundaryCount - 1) / 2));
  }
  return boundaries;
}

function selectGardenLotIndices(rows: number, columns: number, requiredBuildings: number, rng: () => number): Set<number> {
  const lotCount = rows * columns;
  const gardenCount = Math.max(0, lotCount - requiredBuildings);
  if (gardenCount === 0) {
    return new Set<number>();
  }

  const centerRow = (rows - 1) / 2;
  const centerColumn = (columns - 1) / 2;
  const maxDistance = Math.max(1, Math.abs(centerRow) + Math.abs(centerColumn));
  const preferCenter = rng() < 0.66;

  const candidates = Array.from({ length: lotCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const distance = Math.abs(row - centerRow) + Math.abs(column - centerColumn);
    const centeredScore = distance / maxDistance;
    const edgeScore = 1 - centeredScore;
    const styleScore = preferCenter ? centeredScore : edgeScore;
    return {
      index,
      row,
      column,
      score: styleScore + rng() * 0.55,
    };
  }).sort((a, b) => a.score - b.score);

  const selected = new Set<number>();
  for (const candidate of candidates) {
    if (selected.size >= gardenCount) {
      break;
    }
    const adjacent = [...selected].some((chosenIndex) => {
      const chosenRow = Math.floor(chosenIndex / columns);
      const chosenColumn = chosenIndex % columns;
      return Math.abs(chosenRow - candidate.row) <= 1 && Math.abs(chosenColumn - candidate.column) <= 1;
    });
    if (adjacent && candidates.length - selected.size > gardenCount - selected.size) {
      continue;
    }
    selected.add(candidate.index);
  }

  if (selected.size < gardenCount) {
    for (let index = 0; index < lotCount; index += 1) {
      if (selected.size >= gardenCount) {
        break;
      }
      selected.add(index);
    }
  }

  return selected;
}

function buildSignature(
  cityId: string,
  districts: SceneDistrict[],
  buildings: SceneBuilding[],
  roads: SceneRoad[],
  gardens: SceneGarden[],
): string {
  const districtPart = districts.map((d) => `${d.key}:${d.fileCount}:${d.symbolsCount}`).join("|");
  const buildingPart = buildings.map((b) => `${b.path}:${b.height.toFixed(2)}`).join("|");
  const roadPart = roads.map((r) => `${r.districtKey}:${r.orientation}:${r.x.toFixed(2)}:${r.z.toFixed(2)}`).join("|");
  const gardenPart = gardens.map((g) => `${g.districtKey}:${g.style}:${g.x.toFixed(2)}:${g.z.toFixed(2)}`).join("|");
  return `${cityId}|${districtPart}|${buildingPart}|${roadPart}|${gardenPart}`;
}

export function buildCitySceneModel(cityId: string, blueprint: CityBlueprint): CitySceneModel {
  const inputs = buildDistrictInputs(blueprint);
  const districts: SceneDistrict[] = [];
  const buildings: SceneBuilding[] = [];
  const roads: SceneRoad[] = [];
  const gardens: SceneGarden[] = [];

  let cursorX = 0;
  let cursorZ = 0;
  let rowDepth = 0;
  let maxX = 0;
  let maxZ = 0;
  let maxHeight = 0;

  for (const districtInput of inputs) {
    const fileCount = districtInput.files.length;
    const districtSeed = stableHash(`${cityId}|${districtInput.key}|${fileCount}|${districtInput.symbolsCount}`);
    const districtRng = createSeededRng(districtSeed);
    const targetGardenLots = fileCount >= 12 ? 2 : fileCount >= 4 ? 1 : 0;
    const targetCapacity = fileCount + targetGardenLots;
    const columns = Math.max(1, Math.ceil(Math.sqrt(targetCapacity)));
    const rows = Math.max(1, Math.ceil(targetCapacity / columns));
    const verticalRoadAfter = selectRoadBoundaries(columns, districtRng);
    const horizontalRoadAfter = selectRoadBoundaries(rows, districtRng);
    const xAxis = buildAxisLayout(
      columns,
      BUILDING_WIDTH,
      BUILDING_NEIGHBOR_GAP,
      DISTRICT_ROAD_WIDTH,
      verticalRoadAfter,
    );
    const zAxis = buildAxisLayout(
      rows,
      BUILDING_DEPTH,
      BUILDING_NEIGHBOR_GAP,
      DISTRICT_ROAD_WIDTH,
      horizontalRoadAfter,
    );
    const districtWidth = DISTRICT_PADDING * 2 + xAxis.length;
    const districtDepth = DISTRICT_PADDING * 2 + zAxis.length;

    if (cursorX > 0 && cursorX + districtWidth > CITY_ROW_LIMIT) {
      cursorX = 0;
      cursorZ += rowDepth + DISTRICT_GAP;
      rowDepth = 0;
    }

    const x = cursorX + districtWidth / 2;
    const z = cursorZ + districtDepth / 2;
    const district: SceneDistrict = {
      key: districtInput.key,
      label: districtLabel(districtInput.key),
      x,
      z,
      width: districtWidth,
      depth: districtDepth,
      fileCount,
      symbolsCount: districtInput.symbolsCount,
    };
    districts.push(district);

    const interiorLeft = x - districtWidth / 2 + DISTRICT_PADDING;
    const interiorTop = z - districtDepth / 2 + DISTRICT_PADDING;
    for (const road of xAxis.roads) {
      roads.push({
        districtKey: districtInput.key,
        orientation: "vertical",
        x: interiorLeft + road.center,
        z,
        width: road.width,
        depth: zAxis.length,
      });
    }
    for (const road of zAxis.roads) {
      roads.push({
        districtKey: districtInput.key,
        orientation: "horizontal",
        x,
        z: interiorTop + road.center,
        width: xAxis.length,
        depth: road.width,
      });
    }

    const gardenLots = selectGardenLotIndices(rows, columns, fileCount, districtRng);
    const buildingLotIndices: number[] = [];
    const lotCount = rows * columns;
    for (let index = 0; index < lotCount; index += 1) {
      if (!gardenLots.has(index)) {
        buildingLotIndices.push(index);
      }
    }

    for (let index = 0; index < districtInput.files.length; index += 1) {
      const file = districtInput.files[index];
      const lotIndex = buildingLotIndices[index] ?? buildingLotIndices[buildingLotIndices.length - 1] ?? 0;
      const col = lotIndex % columns;
      const row = Math.floor(lotIndex / columns);
      const buildingX = interiorLeft + xAxis.centers[col]!;
      const buildingZ = interiorTop + zAxis.centers[row]!;
      const height = buildingHeight(file.symbolsCount);
      maxHeight = Math.max(maxHeight, height);
      buildings.push({
        cityId,
        districtKey: districtInput.key,
        path: file.path,
        name: fileName(file.path),
        x: buildingX,
        z: buildingZ,
        width: BUILDING_WIDTH,
        depth: BUILDING_DEPTH,
        height,
        symbolsCount: file.symbolsCount,
      });
    }

    for (const lotIndex of [...gardenLots.values()].sort((a, b) => a - b)) {
      const gardenSeed = stableHash(`${cityId}|${districtInput.key}|garden|${lotIndex}`);
      const gardenRng = createSeededRng(gardenSeed);
      const row = Math.floor(lotIndex / columns);
      const col = lotIndex % columns;
      const style = gardenRng() < 0.7 ? "park" : "plaza";
      gardens.push({
        districtKey: districtInput.key,
        x: interiorLeft + xAxis.centers[col]!,
        z: interiorTop + zAxis.centers[row]!,
        width: BUILDING_WIDTH * (style === "park" ? 0.66 + gardenRng() * 0.2 : 0.54 + gardenRng() * 0.18),
        depth: BUILDING_DEPTH * (style === "park" ? 0.66 + gardenRng() * 0.2 : 0.54 + gardenRng() * 0.18),
        style,
      });
    }

    cursorX += districtWidth + DISTRICT_GAP;
    rowDepth = Math.max(rowDepth, districtDepth);
    maxX = Math.max(maxX, cursorX);
    maxZ = Math.max(maxZ, cursorZ + districtDepth);
  }

  const width = Math.max(maxX, 12);
  const depth = Math.max(maxZ, 12);
  const signature = buildSignature(cityId, districts, buildings, roads, gardens);

  return {
    cityId,
    width,
    depth,
    maxHeight,
    districts,
    buildings,
    roads,
    gardens,
    signature,
  };
}

export function verifyCitySceneModel(model: CitySceneModel): SceneVerification {
  const errors: string[] = [];
  const districtByKey = new Map(model.districts.map((district) => [district.key, district]));
  const seenPaths = new Set<string>();
  for (const building of model.buildings) {
    if (seenPaths.has(building.path)) {
      errors.push(`Duplicate building path: ${building.path}`);
    }
    seenPaths.add(building.path);
    if (building.height <= 0 || building.width <= 0 || building.depth <= 0) {
      errors.push(`Non-positive dimensions for building: ${building.path}`);
    }
    const district = districtByKey.get(building.districtKey);
    if (!district) {
      errors.push(`Missing district for building: ${building.path}`);
      continue;
    }
    if (!isInsideDistrict(district, building)) {
      errors.push(`Building out of district bounds: ${building.path}`);
    }
  }

  for (const road of model.roads) {
    if (road.width <= 0 || road.depth <= 0) {
      errors.push(`Non-positive road dimensions in district ${road.districtKey}`);
      continue;
    }
    const district = districtByKey.get(road.districtKey);
    if (!district) {
      errors.push(`Road references missing district: ${road.districtKey}`);
      continue;
    }
    if (!isInsideDistrict(district, road)) {
      errors.push(`Road out of district bounds: ${road.districtKey}`);
    }
  }

  for (const garden of model.gardens) {
    if (garden.width <= 0 || garden.depth <= 0) {
      errors.push(`Non-positive garden dimensions in district ${garden.districtKey}`);
      continue;
    }
    const district = districtByKey.get(garden.districtKey);
    if (!district) {
      errors.push(`Garden references missing district: ${garden.districtKey}`);
      continue;
    }
    if (!isInsideDistrict(district, garden)) {
      errors.push(`Garden out of district bounds: ${garden.districtKey}`);
    }
  }

  for (let i = 0; i < model.districts.length; i += 1) {
    for (let j = i + 1; j < model.districts.length; j += 1) {
      if (intersectsRect(model.districts[i], model.districts[j])) {
        errors.push(`Districts overlap: ${model.districts[i].key} and ${model.districts[j].key}`);
      }
    }
  }

  for (let i = 0; i < model.buildings.length; i += 1) {
    for (let j = i + 1; j < model.buildings.length; j += 1) {
      const a = model.buildings[i];
      const b = model.buildings[j];
      if (a.districtKey !== b.districtKey) {
        continue;
      }
      if (intersectsRect(a, b)) {
        errors.push(`Buildings overlap in district ${a.districtKey}: ${a.path} / ${b.path}`);
      }
    }
  }

  for (const building of model.buildings) {
    for (const road of model.roads) {
      if (building.districtKey !== road.districtKey) {
        continue;
      }
      if (intersectsRect(building, road)) {
        errors.push(`Road overlaps building in district ${building.districtKey}: ${building.path}`);
      }
    }
    for (const garden of model.gardens) {
      if (building.districtKey !== garden.districtKey) {
        continue;
      }
      if (intersectsRect(building, garden)) {
        errors.push(`Garden overlaps building in district ${building.districtKey}: ${building.path}`);
      }
    }
  }

  for (const garden of model.gardens) {
    for (const road of model.roads) {
      if (garden.districtKey !== road.districtKey) {
        continue;
      }
      if (intersectsRect(garden, road)) {
        errors.push(`Garden overlaps road in district ${garden.districtKey}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
