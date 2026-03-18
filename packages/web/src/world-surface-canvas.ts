import type { CitySummary } from "@city-building/shared";

type Point2D = {
  x: number;
  y: number;
};

type IsoPrism = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  topColor: string;
  leftColor: string;
  rightColor: string;
  strokeColor: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function toRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function tint(hex: number, factor: number): string {
  const { r, g, b } = toRgb(hex);
  const outR = clamp(Math.round(r * factor), 0, 255);
  const outG = clamp(Math.round(g * factor), 0, 255);
  const outB = clamp(Math.round(b * factor), 0, 255);
  return `rgb(${outR} ${outG} ${outB})`;
}

function isoProject(
  x: number,
  z: number,
  y: number,
  scaleX: number,
  scaleY: number,
  verticalScale: number,
  offsetX: number,
  offsetY: number,
): Point2D {
  return {
    x: (x - z) * scaleX + offsetX,
    y: (x + z) * scaleY + offsetY - y * verticalScale,
  };
}

function drawPrism(
  context: CanvasRenderingContext2D,
  prism: IsoPrism,
  projection: { sx: number; sy: number; vz: number; ox: number; oy: number },
): void {
  const { sx, sy, vz, ox, oy } = projection;
  const x1 = prism.x - prism.width / 2;
  const x2 = prism.x + prism.width / 2;
  const z1 = prism.z - prism.depth / 2;
  const z2 = prism.z + prism.depth / 2;

  const bottomNW = isoProject(x1, z1, 0, sx, sy, vz, ox, oy);
  const bottomNE = isoProject(x2, z1, 0, sx, sy, vz, ox, oy);
  const bottomSE = isoProject(x2, z2, 0, sx, sy, vz, ox, oy);
  const bottomSW = isoProject(x1, z2, 0, sx, sy, vz, ox, oy);
  const topNW = isoProject(x1, z1, prism.height, sx, sy, vz, ox, oy);
  const topNE = isoProject(x2, z1, prism.height, sx, sy, vz, ox, oy);
  const topSE = isoProject(x2, z2, prism.height, sx, sy, vz, ox, oy);
  const topSW = isoProject(x1, z2, prism.height, sx, sy, vz, ox, oy);

  context.beginPath();
  context.moveTo(bottomSW.x, bottomSW.y);
  context.lineTo(bottomNW.x, bottomNW.y);
  context.lineTo(topNW.x, topNW.y);
  context.lineTo(topSW.x, topSW.y);
  context.closePath();
  context.fillStyle = prism.leftColor;
  context.fill();

  context.beginPath();
  context.moveTo(bottomNE.x, bottomNE.y);
  context.lineTo(bottomSE.x, bottomSE.y);
  context.lineTo(topSE.x, topSE.y);
  context.lineTo(topNE.x, topNE.y);
  context.closePath();
  context.fillStyle = prism.rightColor;
  context.fill();

  context.beginPath();
  context.moveTo(topNW.x, topNW.y);
  context.lineTo(topNE.x, topNE.y);
  context.lineTo(topSE.x, topSE.y);
  context.lineTo(topSW.x, topSW.y);
  context.closePath();
  context.fillStyle = prism.topColor;
  context.fill();

  context.strokeStyle = prism.strokeColor;
  context.lineWidth = 0.9;
  context.stroke();
}

function createBuildingPrisms(city: CitySummary): IsoPrism[] {
  const seed = stableHash(`${city.id}:${city.files_count}:${city.symbols_count}`);
  const rng = createSeededRng(seed);
  const symbolsPerFile = city.symbols_count / Math.max(1, city.files_count);
  const baseHeight = clamp(0.95 + Math.sqrt(symbolsPerFile) * 0.42, 0.95, 2.8);
  const buildingCount = clamp(Math.round(city.files_count / 4) + 3, 4, 13);

  const lotSlots: Array<{ x: number; z: number }> = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = 1.4 + col * 1.7;
      const z = 1.1 + row * 1.45;
      const inRoad = Math.abs(x - 5.0) < 0.82 || Math.abs(z - 3.3) < 0.78;
      if (!inRoad) {
        lotSlots.push({ x, z });
      }
    }
  }

  for (let index = lotSlots.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = lotSlots[index]!;
    lotSlots[index] = lotSlots[swapIndex]!;
    lotSlots[swapIndex] = current;
  }

  const palette = [0xeef3fb, 0xe5edf9, 0xd7e3f5, 0xc8d9f0, 0xb8cde9];
  const prisms: IsoPrism[] = [];
  for (let index = 0; index < Math.min(buildingCount, lotSlots.length); index += 1) {
    const lot = lotSlots[index]!;
    const slotNoise = rng();
    const width = 0.9 + slotNoise * 0.34;
    const depth = 0.9 + rng() * 0.28;
    const heightBoost = index < 3 ? 0.7 + rng() * 0.9 : rng() * 0.7;
    const height = clamp(baseHeight + heightBoost, 1.0, 4.6);
    const colorHex = palette[(index + (seed % palette.length)) % palette.length]!;
    prisms.push({
      x: lot.x + (rng() - 0.5) * 0.18,
      z: lot.z + (rng() - 0.5) * 0.18,
      width,
      depth,
      height,
      topColor: tint(colorHex, 1.08),
      leftColor: tint(colorHex, 0.84),
      rightColor: tint(colorHex, 0.69),
      strokeColor: "rgba(54, 88, 138, 0.42)",
    });
  }
  return prisms;
}

function createBasePrisms(city: CitySummary): IsoPrism[] {
  const seed = stableHash(`base:${city.id}`);
  const rng = createSeededRng(seed);
  const parkInsetX = 6.8 + (rng() - 0.5) * 0.35;
  const parkInsetZ = 1.45 + (rng() - 0.5) * 0.28;
  return [
    {
      x: 5.0,
      z: 3.3,
      width: 10.2,
      depth: 7.0,
      height: 0.32,
      topColor: "rgb(192 209 234)",
      leftColor: "rgb(142 165 201)",
      rightColor: "rgb(122 146 184)",
      strokeColor: "rgba(66, 90, 126, 0.44)",
    },
    {
      x: 5.0,
      z: 3.3,
      width: 8.5,
      depth: 1.05,
      height: 0.06,
      topColor: "rgb(123 132 151)",
      leftColor: "rgb(93 102 120)",
      rightColor: "rgb(86 94 112)",
      strokeColor: "rgba(52, 62, 78, 0.35)",
    },
    {
      x: 5.0,
      z: 3.3,
      width: 1.06,
      depth: 5.7,
      height: 0.06,
      topColor: "rgb(123 132 151)",
      leftColor: "rgb(93 102 120)",
      rightColor: "rgb(86 94 112)",
      strokeColor: "rgba(52, 62, 78, 0.35)",
    },
    {
      x: parkInsetX,
      z: parkInsetZ,
      width: 1.45,
      depth: 1.05,
      height: 0.05,
      topColor: "rgb(115 187 94)",
      leftColor: "rgb(85 147 72)",
      rightColor: "rgb(77 136 66)",
      strokeColor: "rgba(62, 126, 59, 0.35)",
    },
  ];
}

export function renderWorldIslandPreview(canvas: HTMLCanvasElement, city: CitySummary): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const width = Math.max(120, canvas.clientWidth || 120);
  const height = Math.max(84, canvas.clientHeight || 84);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.floor(width * pixelRatio);
  const targetHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const sceneWidth = 10.2;
  const sceneDepth = 7.0;
  const sceneSpan = sceneWidth + sceneDepth;
  const maxHeightHint = 4.8;
  const scaleX = Math.min(
    (width * 0.82) / sceneSpan,
    (height * 0.68) / (sceneSpan * 0.42 + maxHeightHint * 0.75),
    14,
  );
  const scaleY = scaleX * 0.42;
  const verticalScale = scaleX * 0.75;
  const projection = {
    sx: scaleX,
    sy: scaleY,
    vz: verticalScale,
    ox: width / 2,
    oy: height * 0.64,
  };

  const shadowGradient = context.createRadialGradient(
    width / 2,
    height * 0.69,
    8,
    width / 2,
    height * 0.69,
    width * 0.38,
  );
  shadowGradient.addColorStop(0, "rgba(18, 43, 84, 0.28)");
  shadowGradient.addColorStop(1, "rgba(18, 43, 84, 0)");
  context.fillStyle = shadowGradient;
  context.fillRect(0, height * 0.42, width, height * 0.42);

  const basePrisms = createBasePrisms(city);
  const centerX = 5.0;
  const centerZ = 3.3;
  for (const prism of basePrisms) {
    drawPrism(
      context,
      {
        ...prism,
        x: prism.x - centerX,
        z: prism.z - centerZ,
      },
      projection,
    );
  }

  const buildingPrisms = createBuildingPrisms(city).sort((a, b) => a.x + a.z - (b.x + b.z));
  for (const prism of buildingPrisms) {
    drawPrism(
      context,
      {
        ...prism,
        x: prism.x - centerX,
        z: prism.z - centerZ,
      },
      projection,
    );
  }
}
