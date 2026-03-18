import type { CitySceneModel, SceneBuilding, SceneDistrict } from "./layout.js";

type Point2D = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function tint(hex: number, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const outR = clamp(Math.round(r * factor), 0, 255);
  const outG = clamp(Math.round(g * factor), 0, 255);
  const outB = clamp(Math.round(b * factor), 0, 255);
  return `rgb(${outR} ${outG} ${outB})`;
}

function districtColor(index: number): number {
  const colors = [0x9ad06c, 0x98c1ec, 0xf0c47a, 0xb4bbf2, 0x91d6af];
  return colors[index % colors.length]!;
}

function buildingColor(symbolsCount: number): number {
  const base = 0x3d78d8;
  const boost = clamp(symbolsCount / 30, 0, 1);
  const { r, g, b } = hexToRgb(base);
  const outR = clamp(Math.round(r + 50 * boost), 0, 255);
  const outG = clamp(Math.round(g + 70 * boost), 0, 255);
  const outB = clamp(Math.round(b + 90 * boost), 0, 255);
  return (outR << 16) | (outG << 8) | outB;
}

export class CityCanvas3DView {
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private model: CitySceneModel | null = null;
  private selectedPath: string | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {}

  mount(host: HTMLElement): void {
    if (this.host === host && this.canvas) {
      this.resize();
      this.draw();
      return;
    }
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
    host.innerHTML = "";
    host.appendChild(this.canvas);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.draw();
      });
      this.resizeObserver.observe(host);
    }
    this.resize();
    this.draw();
  }

  renderModel(model: CitySceneModel | null, selectedPath: string | null): void {
    this.model = model;
    this.selectedPath = selectedPath;
    this.draw();
  }

  dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.context = null;
    this.model = null;
  }

  private resize(): void {
    if (!this.host || !this.canvas || !this.context) {
      return;
    }
    const width = Math.max(300, this.host.clientWidth || 300);
    const height = Math.max(320, this.host.clientHeight || 320);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(width * pixelRatio);
    this.canvas.height = Math.floor(height * pixelRatio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  private iso(x: number, z: number, y: number, scaleX: number, scaleY: number, verticalScale: number, offsetX: number, offsetY: number): Point2D {
    return {
      x: (x - z) * scaleX + offsetX,
      y: (x + z) * scaleY + offsetY - y * verticalScale,
    };
  }

  private drawPrism(
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    topColor: string,
    leftColor: string,
    rightColor: string,
    strokeColor: string,
    projection: { sx: number; sy: number; vz: number; ox: number; oy: number },
  ): void {
    if (!this.context) {
      return;
    }
    const { sx, sy, vz, ox, oy } = projection;
    const x1 = x - width / 2;
    const x2 = x + width / 2;
    const z1 = z - depth / 2;
    const z2 = z + depth / 2;
    const bottomNW = this.iso(x1, z1, 0, sx, sy, vz, ox, oy);
    const bottomNE = this.iso(x2, z1, 0, sx, sy, vz, ox, oy);
    const bottomSE = this.iso(x2, z2, 0, sx, sy, vz, ox, oy);
    const bottomSW = this.iso(x1, z2, 0, sx, sy, vz, ox, oy);
    const topNW = this.iso(x1, z1, height, sx, sy, vz, ox, oy);
    const topNE = this.iso(x2, z1, height, sx, sy, vz, ox, oy);
    const topSE = this.iso(x2, z2, height, sx, sy, vz, ox, oy);
    const topSW = this.iso(x1, z2, height, sx, sy, vz, ox, oy);

    this.context.beginPath();
    this.context.moveTo(bottomSW.x, bottomSW.y);
    this.context.lineTo(bottomNW.x, bottomNW.y);
    this.context.lineTo(topNW.x, topNW.y);
    this.context.lineTo(topSW.x, topSW.y);
    this.context.closePath();
    this.context.fillStyle = leftColor;
    this.context.fill();

    this.context.beginPath();
    this.context.moveTo(bottomNE.x, bottomNE.y);
    this.context.lineTo(bottomSE.x, bottomSE.y);
    this.context.lineTo(topSE.x, topSE.y);
    this.context.lineTo(topNE.x, topNE.y);
    this.context.closePath();
    this.context.fillStyle = rightColor;
    this.context.fill();

    this.context.beginPath();
    this.context.moveTo(topNW.x, topNW.y);
    this.context.lineTo(topNE.x, topNE.y);
    this.context.lineTo(topSE.x, topSE.y);
    this.context.lineTo(topSW.x, topSW.y);
    this.context.closePath();
    this.context.fillStyle = topColor;
    this.context.fill();
    this.context.strokeStyle = strokeColor;
    this.context.lineWidth = 1;
    this.context.stroke();
  }

  private drawDistricts(model: CitySceneModel, projection: { sx: number; sy: number; vz: number; ox: number; oy: number }): void {
    if (!this.context) {
      return;
    }
    const sortedDistricts = [...model.districts].sort((a, b) => a.x + a.z - (b.x + b.z));
    sortedDistricts.forEach((district, index) => {
      const color = districtColor(index);
      this.drawPrism(
        district.x,
        district.z,
        district.width,
        district.depth,
        0.24,
        tint(color, 1.15),
        tint(color, 0.85),
        tint(color, 0.96),
        "rgba(24, 57, 100, 0.35)",
        projection,
      );
    });
  }

  private drawBuildings(model: CitySceneModel, projection: { sx: number; sy: number; vz: number; ox: number; oy: number }): void {
    if (!this.context) {
      return;
    }
    const sortedBuildings = [...model.buildings].sort((a, b) => a.x + a.z - (b.x + b.z));
    sortedBuildings.forEach((building) => {
      const color = buildingColor(building.symbolsCount);
      const selected = this.selectedPath === building.path;
      const top = selected ? "rgb(255 214 84)" : tint(color, 1.25);
      const left = selected ? "rgb(233 164 46)" : tint(color, 0.92);
      const right = selected ? "rgb(201 124 35)" : tint(color, 0.76);
      this.drawPrism(
        building.x,
        building.z,
        building.width,
        building.depth,
        building.height,
        top,
        left,
        right,
        selected ? "rgba(250, 184, 23, 0.9)" : "rgba(18, 54, 98, 0.22)",
        projection,
      );
    });
  }

  private draw(): void {
    if (!this.context || !this.canvas) {
      return;
    }
    const ctx = this.context;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(142, 194, 255, 0.9)");
    gradient.addColorStop(1, "rgba(112, 168, 236, 0.94)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (!this.model) {
      ctx.fillStyle = "rgba(20, 41, 74, 0.75)";
      ctx.font = "600 16px Inter, system-ui, sans-serif";
      ctx.fillText("Select a city to render 3D scene", 24, 36);
      return;
    }

    const model = this.model;
    const span = Math.max(model.width + model.depth, 16);
    const scaleX = Math.min(width / (span * 1.26), 20);
    const scaleY = scaleX * 0.52;
    const verticalScale = scaleX * 0.92;
    const projection = {
      sx: scaleX,
      sy: scaleY,
      vz: verticalScale,
      ox: width / 2,
      oy: height * 0.73,
    };

    const groundColor = "rgba(129, 197, 91, 0.72)";
    this.drawPrism(
      model.width / 2,
      model.depth / 2,
      model.width + 5,
      model.depth + 5,
      0.18,
      "rgba(189, 228, 145, 0.8)",
      "rgba(125, 180, 98, 0.85)",
      groundColor,
      "rgba(38, 89, 44, 0.3)",
      projection,
    );
    this.drawDistricts(model, projection);
    this.drawBuildings(model, projection);
  }
}
