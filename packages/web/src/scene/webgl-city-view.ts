import type { CitySceneModel } from "./layout.js";
import { CityCanvas3DView } from "./three-city-view.js";

const THREE_VERSION = "0.171.0";
const THREE_CORE_URL = `https://esm.sh/three@${THREE_VERSION}`;
const ORBIT_CONTROLS_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`;
const EFFECT_COMPOSER_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/postprocessing/EffectComposer.js`;
const RENDER_PASS_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/postprocessing/RenderPass.js`;
const BLOOM_PASS_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/postprocessing/UnrealBloomPass.js`;

type ThreeBundle = {
  THREE: any;
  OrbitControls: any;
  EffectComposer: any;
  RenderPass: any;
  UnrealBloomPass: any;
};

type ThreeRenderState = {
  THREE: any;
  renderer: any;
  scene: any;
  camera: any;
  controls: any;
  composer: any;
  bloomPass: any;
  root: any;
  ground: any;
  keyLight: any;
  keyLightTarget: any;
  buildingMeshes: Map<string, any>;
  raycaster: any;
  pointer: any;
  onPointerDown: (event: PointerEvent) => void;
  animationFrame: number | null;
};

type BuildingPickHandler = (path: string) => void;

let threeBundlePromise: Promise<ThreeBundle> | null = null;

const MATERIAL_TEXTURE_KEYS = [
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "gradientMap",
  "lightMap",
  "map",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "transmissionMap",
] as const;

const ROAD_STANDARD_WIDTH = 0.72;
const ROAD_STANDARD_HEIGHT = 0.024;
const ROAD_STANDARD_CENTER_Y = 0.373;
const ROAD_EDGE_LINE_WIDTH = 0.04;
const ROAD_CENTER_DASH_WIDTH = 0.046;
const ROAD_DASH_LENGTH = 0.5;
const ROAD_DASH_GAP = 0.34;
const ROAD_MARKING_MARGIN = 0.2;

function districtColor(index: number): number {
  const colors = [0x79bc64, 0x6fb45b, 0x86c972, 0x73b861, 0x8dcc77];
  return colors[index % colors.length]!;
}

function buildingColor(symbolCount: number, path: string): number {
  const hash = stableHash(path);
  const wallPalette = [0xf6f3f8, 0xf1eef5, 0xede9f1, 0xe8e5ef];
  const coolAccentPalette = [0xe0e8f6, 0xd8e2f3];
  const symbolTier = symbolCount <= 2 ? 0 : symbolCount <= 7 ? 1 : symbolCount <= 14 ? 2 : 3;
  const base = wallPalette[(symbolTier + (hash % 2)) % wallPalette.length]!;

  // Keep occasional cooler towers, but avoid saturated dark blues.
  if (symbolCount >= 10 && hash % 13 === 0) {
    return coolAccentPalette[hash % coolAccentPalette.length]!;
  }
  return base;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function disposeMaterialWithTextures(material: any): void {
  if (!material || typeof material.dispose !== "function") {
    return;
  }
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const texture = material[key];
    if (texture && typeof texture.dispose === "function") {
      texture.dispose();
    }
  }
  material.dispose();
}

async function loadThreeBundle(): Promise<ThreeBundle> {
  if (!threeBundlePromise) {
    threeBundlePromise = (async () => {
      const [threeModule, controlsModule, composerModule, renderPassModule, bloomModule] = await Promise.all([
        import(/* @vite-ignore */ THREE_CORE_URL),
        import(/* @vite-ignore */ ORBIT_CONTROLS_URL),
        import(/* @vite-ignore */ EFFECT_COMPOSER_URL),
        import(/* @vite-ignore */ RENDER_PASS_URL),
        import(/* @vite-ignore */ BLOOM_PASS_URL),
      ]);

      return {
        THREE: threeModule,
        OrbitControls: controlsModule.OrbitControls,
        EffectComposer: composerModule.EffectComposer,
        RenderPass: renderPassModule.RenderPass,
        UnrealBloomPass: bloomModule.UnrealBloomPass,
      };
    })();
  }
  return threeBundlePromise;
}

export class CityWebGLView {
  private host: HTMLElement | null = null;
  private fallback = new CityCanvas3DView();
  private state: ThreeRenderState | null = null;
  private model: CitySceneModel | null = null;
  private selectedPath: string | null = null;
  private currentSignature = "";
  private resizeObserver: ResizeObserver | null = null;
  private pickHandler: BuildingPickHandler | null = null;
  private initializing = false;
  private disposed = false;

  setPickHandler(handler: BuildingPickHandler | null): void {
    this.pickHandler = handler;
  }

  mount(host: HTMLElement): void {
    this.host = host;

    if (this.state) {
      this.attachRendererToHost(host);
      this.observeHost(host);
      this.resize();
      this.syncScene();
      return;
    }

    this.fallback.mount(host);
    void this.ensureWebGL();
  }

  renderModel(model: CitySceneModel | null, selectedPath: string | null): void {
    this.model = model;
    this.selectedPath = selectedPath;
    if (this.state) {
      this.syncScene();
      return;
    }
    this.fallback.renderModel(model, selectedPath);
  }

  dispose(): void {
    this.disposed = true;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.disposeState();
    this.fallback.dispose();
  }

  private async ensureWebGL(): Promise<void> {
    if (this.initializing || this.state || !this.host || this.disposed) {
      return;
    }
    this.initializing = true;
    try {
      const bundle = await loadThreeBundle();
      if (this.disposed || !this.host) {
        return;
      }
      this.state = this.createState(bundle, this.host);
      this.observeHost(this.host);
      this.resize();
      this.startLoop();
      this.syncScene();
    } catch (error) {
      console.warn("WebGL 3D view failed, keeping canvas fallback.", error);
    } finally {
      this.initializing = false;
    }
  }

  private createState(bundle: ThreeBundle, host: HTMLElement): ThreeRenderState {
    const { THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass } = bundle;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x84bcff);
    scene.fog = new THREE.Fog(0x84bcff, 60, 210);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 1500);
    camera.position.set(24, 18, 24);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.minDistance = 8;
    controls.maxDistance = 280;

    const hemisphere = new THREE.HemisphereLight(0xb5d9ff, 0x628a56, 0.82);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(24, 44, 18);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0002;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 2.4;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 260;
    keyLight.shadow.camera.left = -80;
    keyLight.shadow.camera.right = 80;
    keyLight.shadow.camera.top = 80;
    keyLight.shadow.camera.bottom = -80;
    const keyLightTarget = new THREE.Object3D();
    keyLightTarget.position.set(0, 0, 0);
    scene.add(keyLightTarget);
    keyLight.target = keyLightTarget;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb3d0ff, 0.34);
    fillLight.position.set(-20, 18, -21);
    scene.add(fillLight);

    const root = new THREE.Group();
    scene.add(root);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x7db0ea,
        roughness: 0.92,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.66, 1.02);
    composer.addPass(bloomPass);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const buildingMeshes = new Map<string, any>();

    const state: ThreeRenderState = {
      THREE,
      renderer,
      scene,
      camera,
      controls,
      composer,
      bloomPass,
      root,
      ground,
      keyLight,
      keyLightTarget,
      buildingMeshes,
      raycaster,
      pointer,
      onPointerDown: (event: PointerEvent) => {
        this.handlePointerDown(event);
      },
      animationFrame: null,
    };

    host.innerHTML = "";
    host.appendChild(renderer.domElement as HTMLElement);
    renderer.domElement.addEventListener("pointerdown", state.onPointerDown);
    return state;
  }

  private startLoop(): void {
    if (!this.state) {
      return;
    }
    const renderFrame = () => {
      if (!this.state || this.disposed) {
        return;
      }
      this.state.controls.update();
      this.state.composer.render();
      this.state.animationFrame = requestAnimationFrame(renderFrame);
    };
    this.state.animationFrame = requestAnimationFrame(renderFrame);
  }

  private attachRendererToHost(host: HTMLElement): void {
    if (!this.state) {
      return;
    }
    host.innerHTML = "";
    host.appendChild(this.state.renderer.domElement as HTMLElement);
  }

  private observeHost(host: HTMLElement): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(host);
  }

  private resize(): void {
    if (!this.state || !this.host) {
      return;
    }
    const width = Math.max(320, this.host.clientWidth || 320);
    const height = Math.max(340, this.host.clientHeight || 340);
    this.state.camera.aspect = width / height;
    this.state.camera.updateProjectionMatrix();
    this.state.renderer.setSize(width, height, false);
    this.state.composer.setSize(width, height);
    if (typeof this.state.bloomPass.setSize === "function") {
      this.state.bloomPass.setSize(width, height);
    }
  }

  private syncScene(): void {
    if (!this.state) {
      return;
    }
    if (!this.model) {
      this.clearScene();
      this.currentSignature = "";
      return;
    }

    if (this.model.signature !== this.currentSignature) {
      this.currentSignature = this.model.signature;
      this.rebuildScene(this.model);
      this.fitLightsAndShadows(this.model);
      this.positionCamera(this.model);
    }

    this.applySelection();
  }

  private clearScene(): void {
    if (!this.state) {
      return;
    }
    this.clearGroup(this.state.root);
    this.state.buildingMeshes.clear();
  }

  private createRoundedRectShape(width: number, depth: number, radius: number): any {
    if (!this.state) {
      throw new Error("Cannot create rounded shape without renderer state");
    }
    const { THREE } = this.state;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const corner = clamp(radius, 0.04, Math.min(halfWidth - 0.04, halfDepth - 0.04));
    const shape = new THREE.Shape();

    shape.moveTo(-halfWidth + corner, -halfDepth);
    shape.lineTo(halfWidth - corner, -halfDepth);
    shape.quadraticCurveTo(halfWidth, -halfDepth, halfWidth, -halfDepth + corner);
    shape.lineTo(halfWidth, halfDepth - corner);
    shape.quadraticCurveTo(halfWidth, halfDepth, halfWidth - corner, halfDepth);
    shape.lineTo(-halfWidth + corner, halfDepth);
    shape.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth, halfDepth - corner);
    shape.lineTo(-halfWidth, -halfDepth + corner);
    shape.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth + corner, -halfDepth);
    return shape;
  }

  private createRoundedRingBandGeometry(
    outerWidth: number,
    outerDepth: number,
    outerRadius: number,
    innerWidth: number,
    innerDepth: number,
    innerRadius: number,
    curveSegments = 26,
  ): any | null {
    if (!this.state) {
      return null;
    }
    if (
      outerWidth <= 0 ||
      outerDepth <= 0 ||
      innerWidth <= 0 ||
      innerDepth <= 0 ||
      innerWidth >= outerWidth - 0.001 ||
      innerDepth >= outerDepth - 0.001
    ) {
      return null;
    }
    const { THREE } = this.state;
    const outer = this.createRoundedRectShape(outerWidth, outerDepth, outerRadius);
    const inner = this.createRoundedRectShape(innerWidth, innerDepth, innerRadius);
    outer.holes.push(new THREE.Path(inner.getPoints(curveSegments)));
    const geometry = new THREE.ShapeGeometry(outer, curveSegments);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private createIslandSurface(model: CitySceneModel): any {
    if (!this.state) {
      throw new Error("Cannot create island surface without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const centerX = model.width / 2;
    const centerZ = model.depth / 2;
    const islandWidth = Math.max(12.4, model.width + 4.8);
    const islandDepth = Math.max(10.4, model.depth + 4.8);
    const cornerRadius = Math.min(1.2, Math.min(islandWidth, islandDepth) * 0.14);

    group.position.set(centerX, 0, centerZ);

    const yellowBandHeight = 0.24;
    const topSlabHeight = 0.12;

    const yellowShape = this.createRoundedRectShape(islandWidth, islandDepth, cornerRadius);
    const yellowGeometry = new THREE.ExtrudeGeometry(yellowShape, {
      depth: yellowBandHeight,
      bevelEnabled: false,
      curveSegments: 14,
    });
    yellowGeometry.rotateX(-Math.PI / 2);
    const yellowBand = new THREE.Mesh(
      yellowGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xd8aa28,
        roughness: 0.66,
        metalness: 0.03,
      }),
    );
    yellowBand.position.y = 0;
    yellowBand.castShadow = true;
    yellowBand.receiveShadow = true;
    group.add(yellowBand);

    const topShape = this.createRoundedRectShape(
      islandWidth - 0.44,
      islandDepth - 0.44,
      Math.max(0.34, cornerRadius - 0.18),
    );
    const topGeometry = new THREE.ExtrudeGeometry(topShape, {
      depth: topSlabHeight,
      bevelEnabled: false,
      curveSegments: 14,
    });
    topGeometry.rotateX(-Math.PI / 2);
    const topSlab = new THREE.Mesh(
      topGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xd3ced9,
        roughness: 0.8,
        metalness: 0.02,
      }),
    );
    topSlab.position.y = yellowBandHeight - 0.008;
    topSlab.castShadow = true;
    topSlab.receiveShadow = true;
    group.add(topSlab);

    const trimShape = this.createRoundedRectShape(
      islandWidth - 0.82,
      islandDepth - 0.82,
      Math.max(0.22, cornerRadius - 0.26),
    );
    const trimGeometry = new THREE.ShapeGeometry(trimShape);
    trimGeometry.rotateX(-Math.PI / 2);
    const trim = new THREE.Mesh(
      trimGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xe4dfeb,
        roughness: 0.58,
        metalness: 0.02,
      }),
    );
    trim.position.y = yellowBandHeight + topSlabHeight - 0.006;
    trim.receiveShadow = true;
    trim.castShadow = false;
    group.add(trim);

    const bollardMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8cdd7,
      roughness: 0.55,
      metalness: 0.08,
    });
    const bollardY = 0.06;
    const edgeZ = islandDepth / 2 - 0.09;
    const edgeX = islandWidth / 2 - 0.09;
    const xCount = Math.max(5, Math.round(islandWidth / 1.2));
    const zCount = Math.max(5, Math.round(islandDepth / 1.2));
    for (let index = 1; index < xCount - 1; index += 1) {
      const x = -islandWidth / 2 + (index / (xCount - 1)) * islandWidth;
      for (const zDir of [-1, 1]) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8), bollardMaterial);
        bollard.position.set(x, bollardY, zDir * edgeZ);
        bollard.castShadow = true;
        group.add(bollard);
      }
    }
    for (let index = 1; index < zCount - 1; index += 1) {
      const z = -islandDepth / 2 + (index / (zCount - 1)) * islandDepth;
      for (const xDir of [-1, 1]) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8), bollardMaterial);
        bollard.position.set(xDir * edgeX, bollardY, z);
        bollard.castShadow = true;
        group.add(bollard);
      }
    }

    return group;
  }

  private createPerimeterRoadRing(model: CitySceneModel): any {
    if (!this.state) {
      throw new Error("Cannot create perimeter ring without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const islandWidth = Math.max(12.4, model.width + 4.8);
    const islandDepth = Math.max(10.4, model.depth + 4.8);
    const topWidth = islandWidth - 0.44;
    const topDepth = islandDepth - 0.44;
    const centerX = model.width / 2;
    const centerZ = model.depth / 2;
    const inset = 0.82;
    const lane = ROAD_STANDARD_WIDTH;
    const roadY = ROAD_STANDARD_CENTER_Y;
    const roadHeight = ROAD_STANDARD_HEIGHT;

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x80889a,
      roughness: 0.67,
      metalness: 0.03,
    });
    const outerWidth = Math.max(0.8, topWidth - inset * 2);
    const outerDepth = Math.max(0.8, topDepth - inset * 2);
    const outerRadius = Math.max(0.22, Math.min(outerWidth, outerDepth) * 0.16);
    const innerWidth = outerWidth - lane * 2;
    const innerDepth = outerDepth - lane * 2;
    const innerRadius = Math.max(0.08, outerRadius - lane);
    const roadShape = this.createRoundedRectShape(outerWidth, outerDepth, outerRadius);
    roadShape.holes.push(new THREE.Path(this.createRoundedRectShape(innerWidth, innerDepth, innerRadius).getPoints(30)));
    const roadGeometry = new THREE.ExtrudeGeometry(roadShape, {
      depth: roadHeight,
      bevelEnabled: false,
      curveSegments: 30,
    });
    roadGeometry.rotateX(-Math.PI / 2);
    const roadMesh = new THREE.Mesh(roadGeometry, ringMaterial);
    roadMesh.position.set(centerX, roadY - roadHeight / 2, centerZ);
    roadMesh.receiveShadow = true;
    roadMesh.castShadow = false;
    group.add(roadMesh);
    this.addRoadRingMarkings(group, centerX, centerZ, outerWidth, outerDepth, outerRadius, lane, roadY + roadHeight / 2 + 0.008);

    const xOffset = outerWidth / 2 - lane / 2;
    const zOffset = outerDepth / 2 - lane / 2;
    const cornerX = centerX + xOffset;
    const cornerZ = centerZ + zOffset;
    const cornerLights: Array<{ x: number; z: number; orientation: "horizontal" | "vertical"; side: number }> = [
      { x: centerX - xOffset, z: centerZ - zOffset, orientation: "horizontal", side: -1 },
      { x: centerX + xOffset, z: centerZ - zOffset, orientation: "horizontal", side: -1 },
      { x: centerX - xOffset, z: centerZ + zOffset, orientation: "horizontal", side: 1 },
      { x: cornerX, z: cornerZ, orientation: "horizontal", side: 1 },
    ];
    for (const light of cornerLights) {
      const streetLight = this.createStreetLight(light.x, roadY + roadHeight / 2, light.z, light.orientation, light.side);
      group.add(streetLight);
    }

    const carOffsetX = (outerWidth - lane) * 0.24;
    const carOffsetZ = (outerDepth - lane) * 0.2;
    group.add(this.createToyCar(centerX - carOffsetX, roadY + roadHeight / 2, centerZ - zOffset, "horizontal", 0));
    group.add(this.createToyCar(centerX + xOffset, roadY + roadHeight / 2, centerZ + carOffsetZ, "vertical", 1));

    return group;
  }

  private createDistrictLoopRoad(
    district: CitySceneModel["districts"][number],
    model: CitySceneModel,
    districtColorHex: number,
  ): any | null {
    if (!this.state) {
      throw new Error("Cannot create district loop road without renderer state");
    }
    const { THREE } = this.state;
    const laneWidth = ROAD_STANDARD_WIDTH;
    const roadY = ROAD_STANDARD_CENTER_Y;
    const roadHeight = ROAD_STANDARD_HEIGHT;
    const loopWidth = Math.max(0.9, district.width + laneWidth * 2 + 0.22);
    const loopDepth = Math.max(0.9, district.depth + laneWidth * 2 + 0.22);
    const radius = Math.min(loopWidth, loopDepth) * 0.21;
    const innerWidth = loopWidth - laneWidth * 2;
    const innerDepth = loopDepth - laneWidth * 2;
    if (innerWidth <= 0.26 || innerDepth <= 0.26) {
      return null;
    }

    const group = new THREE.Group();
    const innerRadius = Math.max(0.1, radius - laneWidth);
    const outer = this.createRoundedRectShape(loopWidth, loopDepth, radius);
    outer.holes.push(new THREE.Path(this.createRoundedRectShape(innerWidth, innerDepth, innerRadius).getPoints(26)));
    const loopGeometry = new THREE.ExtrudeGeometry(outer, {
      depth: roadHeight,
      bevelEnabled: false,
      curveSegments: 26,
    });
    loopGeometry.rotateX(-Math.PI / 2);
    const loopMesh = new THREE.Mesh(
      loopGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x7b8396,
        roughness: 0.66,
        metalness: 0.03,
      }),
    );
    loopMesh.position.set(district.x, roadY - roadHeight / 2, district.z);
    loopMesh.receiveShadow = true;
    loopMesh.castShadow = false;
    group.add(loopMesh);
    this.addRoadRingMarkings(group, district.x, district.z, loopWidth, loopDepth, radius, laneWidth, roadY + roadHeight / 2 + 0.007);

    const districtSurface = this.createRoundedRectShape(innerWidth + 0.02, innerDepth + 0.02, innerRadius + 0.01);
    const districtSurfaceGeometry = new THREE.ShapeGeometry(districtSurface, 26);
    districtSurfaceGeometry.rotateX(-Math.PI / 2);
    const districtSurfaceMesh = new THREE.Mesh(
      districtSurfaceGeometry,
      new THREE.MeshStandardMaterial({
        color: districtColorHex,
        roughness: 0.74,
        metalness: 0.02,
      }),
    );
    districtSurfaceMesh.position.set(district.x, 0.36, district.z);
    districtSurfaceMesh.receiveShadow = true;
    districtSurfaceMesh.castShadow = false;
    group.add(districtSurfaceMesh);

    const islandWidth = Math.max(12.4, model.width + 4.8);
    const islandDepth = Math.max(10.4, model.depth + 4.8);
    const topWidth = islandWidth - 0.44;
    const topDepth = islandDepth - 0.44;
    const inset = 0.82;
    const borderLane = ROAD_STANDARD_WIDTH;
    const centerX = model.width / 2;
    const centerZ = model.depth / 2;
    const borderXOffset = topWidth / 2 - inset - borderLane / 2;
    const borderZOffset = topDepth / 2 - inset - borderLane / 2;

    const sideTargets = [
      { side: "left", distance: Math.abs(district.x - (centerX - borderXOffset)) },
      { side: "right", distance: Math.abs(district.x - (centerX + borderXOffset)) },
      { side: "top", distance: Math.abs(district.z - (centerZ - borderZOffset)) },
      { side: "bottom", distance: Math.abs(district.z - (centerZ + borderZOffset)) },
    ].sort((a, b) => a.distance - b.distance);
    const preferred = sideTargets[0]?.side;
    if (!preferred) {
      return group;
    }

    const connectorWidth = laneWidth;
    const connectorMaterial = new THREE.MeshStandardMaterial({
      color: 0x80889b,
      roughness: 0.64,
      metalness: 0.03,
    });

    if (preferred === "left" || preferred === "right") {
      const sourceX = district.x + (preferred === "left" ? -loopWidth / 2 : loopWidth / 2);
      const targetX = preferred === "left" ? centerX - borderXOffset : centerX + borderXOffset;
      const connectorLength = Math.abs(targetX - sourceX);
      if (connectorLength > 0.16) {
        const connectorCenterX = (sourceX + targetX) / 2;
        const connector = new THREE.Mesh(
          new THREE.BoxGeometry(connectorLength, roadHeight, connectorWidth),
          connectorMaterial,
        );
        connector.position.set(connectorCenterX, roadY, district.z);
        connector.receiveShadow = true;
        connector.castShadow = false;
        group.add(connector);
        this.addRoadLinearMarkings(
          group,
          "horizontal",
          connectorCenterX,
          district.z,
          connectorLength,
          connectorWidth,
          roadY + roadHeight / 2 + 0.007,
        );
      }
    } else {
      const sourceZ = district.z + (preferred === "top" ? -loopDepth / 2 : loopDepth / 2);
      const targetZ = preferred === "top" ? centerZ - borderZOffset : centerZ + borderZOffset;
      const connectorLength = Math.abs(targetZ - sourceZ);
      if (connectorLength > 0.16) {
        const connectorCenterZ = (sourceZ + targetZ) / 2;
        const connector = new THREE.Mesh(
          new THREE.BoxGeometry(connectorWidth, roadHeight, connectorLength),
          connectorMaterial,
        );
        connector.position.set(district.x, roadY, connectorCenterZ);
        connector.receiveShadow = true;
        connector.castShadow = false;
        group.add(connector);
        this.addRoadLinearMarkings(
          group,
          "vertical",
          district.x,
          connectorCenterZ,
          connectorLength,
          connectorWidth,
          roadY + roadHeight / 2 + 0.007,
        );
      }
    }

    return group;
  }

  private createCivicParkFeature(model: CitySceneModel): any | null {
    if (!this.state) {
      throw new Error("Cannot create civic park without renderer state");
    }
    const { THREE } = this.state;
    const width = clamp(model.width * 0.26, 2.2, 4.2);
    const depth = clamp(model.depth * 0.22, 1.9, 3.4);
    const candidates: Array<{ x: number; z: number }> = [
      { x: model.width / 2, z: model.depth / 2 },
      { x: model.width / 2 + width * 0.72, z: model.depth / 2 },
      { x: model.width / 2 - width * 0.72, z: model.depth / 2 },
      { x: model.width / 2, z: model.depth / 2 + depth * 0.72 },
      { x: model.width / 2, z: model.depth / 2 - depth * 0.72 },
    ];

    const intersectsBuilding = (x: number, z: number): boolean => {
      return model.buildings.some((building) => {
        return (
          Math.abs(building.x - x) < building.width / 2 + width / 2 + 0.22 &&
          Math.abs(building.z - z) < building.depth / 2 + depth / 2 + 0.22
        );
      });
    };

    const intersectsRoad = (x: number, z: number): boolean => {
      return model.roads.some((road) => {
        return (
          Math.abs(road.x - x) < road.width / 2 + width / 2 + 0.14 &&
          Math.abs(road.z - z) < road.depth / 2 + depth / 2 + 0.14
        );
      });
    };

    const location = candidates.find((candidate) => {
      return !intersectsBuilding(candidate.x, candidate.z) && !intersectsRoad(candidate.x, candidate.z);
    });
    if (!location) {
      return null;
    }

    const park = new THREE.Group();
    const rng = createSeededRng(stableHash(`${model.signature}|civic-park`));
    const topY = 0.405;
    const parkHeight = 0.07;
    const patchWidth = width * (0.9 + rng() * 0.16);
    const patchDepth = depth * (0.9 + rng() * 0.16);
    const patchRadius = Math.min(patchWidth, patchDepth) * (0.24 + rng() * 0.12);
    const patchShape = this.createRoundedRectShape(patchWidth, patchDepth, patchRadius);
    const patchGeometry = new THREE.ExtrudeGeometry(patchShape, {
      depth: parkHeight,
      bevelEnabled: false,
      curveSegments: 22,
    });
    patchGeometry.rotateX(-Math.PI / 2);
    const patch = new THREE.Mesh(
      patchGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x67be4f,
        roughness: 0.82,
        metalness: 0.02,
      }),
    );
    patch.position.set(location.x, topY, location.z);
    patch.receiveShadow = true;
    patch.castShadow = false;
    park.add(patch);

    const innerPatchWidth = Math.max(0.22, patchWidth - 0.34);
    const innerPatchDepth = Math.max(0.22, patchDepth - 0.34);
    const innerPatchRadius = Math.max(0.1, patchRadius - 0.13);
    const innerPatchShape = this.createRoundedRectShape(innerPatchWidth, innerPatchDepth, innerPatchRadius);
    const innerPatchGeometry = new THREE.ShapeGeometry(innerPatchShape, 20);
    innerPatchGeometry.rotateX(-Math.PI / 2);
    const innerPatch = new THREE.Mesh(
      innerPatchGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x7bd262,
        roughness: 0.78,
        metalness: 0.02,
      }),
    );
    innerPatch.position.set(location.x, topY + parkHeight + 0.008, location.z);
    innerPatch.receiveShadow = true;
    innerPatch.castShadow = false;
    park.add(innerPatch);

    const pathMaterial = new THREE.MeshStandardMaterial({
      color: 0xdfd1ab,
      roughness: 0.8,
      metalness: 0.01,
    });
    const pathAngle = (rng() - 0.5) * 0.5;
    const pathA = new THREE.Mesh(
      new THREE.BoxGeometry(innerPatchWidth * 0.68, 0.012, Math.max(0.12, innerPatchDepth * 0.17)),
      pathMaterial,
    );
    pathA.position.set(location.x, topY + parkHeight + 0.012, location.z + (rng() - 0.5) * innerPatchDepth * 0.15);
    pathA.rotation.y = pathAngle;
    pathA.receiveShadow = true;
    park.add(pathA);
    const pathB = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.12, innerPatchWidth * 0.16), 0.012, innerPatchDepth * 0.56),
      pathMaterial,
    );
    pathB.position.set(location.x + (rng() - 0.5) * innerPatchWidth * 0.16, topY + parkHeight + 0.013, location.z);
    pathB.rotation.y = pathAngle;
    pathB.receiveShadow = true;
    park.add(pathB);

    const treeCount = 6 + Math.floor(rng() * 3);
    for (let index = 0; index < treeCount; index += 1) {
      const radius = 0.18 + rng() * 0.36;
      const angle = rng() * Math.PI * 2;
      const offsetX = Math.cos(angle) * radius * innerPatchWidth * 0.45;
      const offsetZ = Math.sin(angle) * radius * innerPatchDepth * 0.45;
      const tree = this.createLowPolyTree(location.x + offsetX, topY + parkHeight, location.z + offsetZ, rng);
      park.add(tree);
    }

    const shrubCount = 5 + Math.floor(rng() * 4);
    for (let index = 0; index < shrubCount; index += 1) {
      const shrub = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.05 + rng() * 0.03, 0),
        new THREE.MeshStandardMaterial({
          color: rng() > 0.5 ? 0x53b756 : 0x5cc267,
          roughness: 0.76,
          metalness: 0.02,
        }),
      );
      shrub.position.set(
        location.x + (rng() - 0.5) * innerPatchWidth * 0.72,
        topY + parkHeight + 0.045,
        location.z + (rng() - 0.5) * innerPatchDepth * 0.72,
      );
      shrub.castShadow = true;
      shrub.receiveShadow = false;
      park.add(shrub);
    }

    return park;
  }

  private rebuildScene(model: CitySceneModel): void {
    if (!this.state) {
      return;
    }
    const { THREE } = this.state;
    this.clearScene();

    const waterWidth = Math.max(16, model.width + 16);
    const waterDepth = Math.max(16, model.depth + 16);
    this.state.ground.scale.set(waterWidth, waterDepth, 1);
    this.state.ground.position.set(model.width / 2, -0.02, model.depth / 2);
    this.state.ground.receiveShadow = false;
    const groundMaterial = this.state.ground.material;
    if (groundMaterial && typeof groundMaterial === "object" && "color" in groundMaterial) {
      groundMaterial.color?.setHex?.(0x7aaeea);
      groundMaterial.roughness = 0.9;
      groundMaterial.metalness = 0.01;
    }

    const islandSurface = this.createIslandSurface(model);
    this.state.root.add(islandSurface);

    const districtByKey = new Map(model.districts.map((district) => [district.key, district]));

    model.districts.forEach((district, index) => {
      const districtRoadLoop = this.createDistrictLoopRoad(district, model, districtColor(index));
      if (districtRoadLoop) {
        this.state?.root.add(districtRoadLoop);
      }
    });

    model.roads.forEach((road) => {
      const roadGroup = this.createRoadFeature(
        road,
        model.gardens,
        model.roads,
        districtByKey.get(road.districtKey) ?? null,
      );
      this.state?.root.add(roadGroup);
    });

    const civicPark = this.createCivicParkFeature(model);
    if (civicPark) {
      this.state.root.add(civicPark);
    }

    model.gardens.forEach((garden) => {
      const gardenGroup = this.createGardenFeature(garden);
      this.state?.root.add(gardenGroup);
    });

    model.buildings.forEach((building) => {
      const buildingMesh = this.createBuildingMesh(building);
      this.state?.root.add(buildingMesh);
      this.state?.buildingMeshes.set(building.path, buildingMesh);
    });
  }

  private createBuildingMesh(building: CitySceneModel["buildings"][number]): any {
    if (!this.state) {
      return null;
    }
    const { THREE } = this.state;
    const seed = stableHash(`${building.path}|mesh`);
    const rng = createSeededRng(seed);
    const wallColor = new THREE.Color(buildingColor(building.symbolsCount, building.path));
    const sideColor = wallColor.clone();
    const roofColor = wallColor.clone().multiplyScalar(1.01);
    const windowGlow = 0;
    const sideMapsX = this.createBuildingFacadeMaps(building, building.width, "x");
    const sideMapsZ = this.createBuildingFacadeMaps(building, building.depth, "z");

    const sideMaterial = (maps: { albedo: any; emissive: any }, tint: number) => {
      const material = new THREE.MeshStandardMaterial({
        color: sideColor.clone().multiplyScalar(tint),
        roughness: 0.76,
        metalness: 0.02,
        map: maps.albedo,
        emissive: 0x4d8fe0,
        emissiveMap: maps.emissive,
        emissiveIntensity: windowGlow,
      });
      material.userData.baseEmissiveHex = 0x4d8fe0;
      material.userData.baseEmissiveIntensity = windowGlow;
      return material;
    };

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(building.width, building.height, building.depth),
      [
        sideMaterial(sideMapsX, 1),
        sideMaterial(sideMapsX, 1),
        new THREE.MeshStandardMaterial({
          color: roofColor,
          roughness: 0.64,
          metalness: 0.03,
        }),
        new THREE.MeshStandardMaterial({
          color: sideColor.clone().multiplyScalar(0.7),
          roughness: 0.78,
          metalness: 0.02,
        }),
        sideMaterial(sideMapsZ, 1),
        sideMaterial(sideMapsZ, 1),
      ],
    );
    mesh.position.set(building.x, 0.36 + building.height / 2, building.z);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData.path = building.path;

    const plinthHeight = Math.min(0.62, Math.max(0.24, building.height * 0.16));
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(building.width * 1.01, plinthHeight, building.depth * 1.01),
      new THREE.MeshStandardMaterial({
        color: 0x7f8797,
        roughness: 0.78,
        metalness: 0.03,
      }),
    );
    plinth.position.set(0, -building.height / 2 + plinthHeight / 2 + 0.01, 0);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    mesh.add(plinth);

    const roofLipHeight = 0.08;
    const roofLip = new THREE.Mesh(
      new THREE.BoxGeometry(building.width * 1.02, roofLipHeight, building.depth * 1.02),
      new THREE.MeshStandardMaterial({
        color: roofColor.clone().multiplyScalar(0.98),
        roughness: 0.62,
        metalness: 0.03,
      }),
    );
    roofLip.position.set(0, building.height / 2 + roofLipHeight / 2, 0);
    roofLip.castShadow = true;
    roofLip.receiveShadow = false;
    mesh.add(roofLip);

    const roofInsetHeight = 0.06;
    const roofInset = new THREE.Mesh(
      new THREE.BoxGeometry(building.width * 0.84, roofInsetHeight, building.depth * 0.84),
      new THREE.MeshStandardMaterial({
        color: 0xe3e0e6,
        roughness: 0.68,
        metalness: 0.02,
      }),
    );
    roofInset.position.set(0, building.height / 2 + roofLipHeight + roofInsetHeight / 2, 0);
    roofInset.castShadow = true;
    roofInset.receiveShadow = false;
    mesh.add(roofInset);

    if (rng() > 0.45) {
      const unitWidth = Math.max(0.2, Math.min(building.width * 0.28, 0.72));
      const unitDepth = Math.max(0.2, Math.min(building.depth * 0.28, 0.72));
      const unitHeight = 0.08 + rng() * 0.08;
      const hvacUnit = new THREE.Mesh(
        new THREE.BoxGeometry(unitWidth, unitHeight, unitDepth),
        new THREE.MeshStandardMaterial({
          color: 0xc7c8d1,
          roughness: 0.67,
          metalness: 0.04,
        }),
      );
      hvacUnit.position.set(
        (rng() - 0.5) * Math.max(0.2, building.width * 0.32),
        building.height / 2 + roofLipHeight + roofInsetHeight + unitHeight / 2,
        (rng() - 0.5) * Math.max(0.2, building.depth * 0.32),
      );
      hvacUnit.castShadow = true;
      hvacUnit.receiveShadow = false;
      mesh.add(hvacUnit);
    }

    if (building.height >= 5.6 && rng() > 0.58) {
      const mastHeight = Math.min(1.4, Math.max(0.58, building.height * 0.18));
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.03, mastHeight, 6),
        new THREE.MeshStandardMaterial({
          color: 0x7a7f90,
          roughness: 0.55,
          metalness: 0.32,
        }),
      );
      const mastX = (rng() - 0.5) * Math.max(0.16, building.width * 0.24);
      const mastZ = (rng() - 0.5) * Math.max(0.16, building.depth * 0.24);
      mast.position.set(
        mastX,
        building.height / 2 + roofLipHeight + roofInsetHeight + mastHeight / 2 + 0.02,
        mastZ,
      );
      mast.castShadow = true;
      mast.receiveShadow = false;
      mesh.add(mast);

      const tipHeight = 0.22;
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.055, tipHeight, 6),
        new THREE.MeshStandardMaterial({
          color: 0x8d91a0,
          roughness: 0.5,
          metalness: 0.27,
        }),
      );
      tip.position.set(mastX, mast.position.y + mastHeight / 2 + tipHeight / 2 - 0.01, mastZ);
      tip.castShadow = true;
      tip.receiveShadow = false;
      mesh.add(tip);
    }
    return mesh;
  }

  private createRoadFeature(
    road: CitySceneModel["roads"][number],
    gardens: CitySceneModel["gardens"],
    roads: CitySceneModel["roads"],
    district: CitySceneModel["districts"][number] | null,
  ): any {
    if (!this.state) {
      throw new Error("Cannot create road feature without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const roadHeight = ROAD_STANDARD_HEIGHT;
    const roadY = ROAD_STANDARD_CENTER_Y;
    const roadMesh = new THREE.Mesh(
      new THREE.BoxGeometry(road.width, roadHeight, road.depth),
      new THREE.MeshStandardMaterial({
        color: 0x70788a,
        roughness: 0.72,
        metalness: 0.03,
      }),
    );
    roadMesh.position.set(road.x, roadY, road.z);
    roadMesh.receiveShadow = true;
    roadMesh.castShadow = false;
    group.add(roadMesh);

    const topCap = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.12, road.width - 0.04), 0.01, Math.max(0.12, road.depth - 0.04)),
      new THREE.MeshStandardMaterial({
        color: 0x818a9c,
        roughness: 0.62,
        metalness: 0.02,
      }),
    );
    topCap.position.set(road.x, roadY + roadHeight / 2 + 0.004, road.z);
    topCap.castShadow = false;
    topCap.receiveShadow = true;
    group.add(topCap);

    const laneSpan = road.orientation === "horizontal" ? road.width : road.depth;
    const laneWidth = road.orientation === "horizontal" ? road.depth : road.width;
    const stripeY = roadY + roadHeight / 2 + 0.007;

    if (district) {
      this.addDistrictRoadEdgeConnectors(group, road, district, roadY, roadHeight, laneWidth);
    }

    if (laneSpan < 1.9 || laneWidth < 0.55) {
      return group;
    }

    const blockedIntervals = this.computeRoadBlockedIntervals(road, roads);

    this.addRoadLinearMarkings(
      group,
      road.orientation,
      road.x,
      road.z,
      laneSpan,
      laneWidth,
      stripeY,
      blockedIntervals,
    );

    const curbHeight = 0.018;
    const curbWidth = Math.min(0.09, Math.max(0.06, laneWidth * 0.12));
    const curbOffset = laneWidth / 2 + curbWidth * 0.36;
    const curbMaterial = new THREE.MeshStandardMaterial({
      color: 0xd2d7e1,
      roughness: 0.55,
      metalness: 0.04,
    });
    const curbGeometry =
      road.orientation === "horizontal"
        ? new THREE.BoxGeometry(Math.max(0.24, road.width - 0.06), curbHeight, curbWidth)
        : new THREE.BoxGeometry(curbWidth, curbHeight, Math.max(0.24, road.depth - 0.06));
    for (const direction of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeometry, curbMaterial);
      curb.position.set(
        road.orientation === "horizontal" ? road.x : road.x + direction * curbOffset,
        roadY + roadHeight / 2 + curbHeight / 2 - 0.004,
        road.orientation === "horizontal" ? road.z + direction * curbOffset : road.z,
      );
      curb.castShadow = false;
      curb.receiveShadow = true;
      group.add(curb);
    }

    const crosswalkAnchors = this.findCrosswalkAnchors(road, gardens);
    if (crosswalkAnchors.length > 0) {
      const crosswalkMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f7fb,
        roughness: 0.48,
        metalness: 0.03,
      });
      const crosswalkSpan = Math.min(0.95, Math.max(0.58, laneSpan * 0.13));
      const stripeCount = 4;
      const crosswalkGap = laneWidth / (stripeCount * 2 + 1);
      const stripeThickness = Math.max(0.055, Math.min(0.09, crosswalkGap * 0.82));

      for (const anchor of crosswalkAnchors) {
        const anchorOffset = road.orientation === "horizontal" ? anchor - road.x : anchor - road.z;
        if (this.isRoadOffsetBlocked(anchorOffset, blockedIntervals, crosswalkSpan * 0.56)) {
          continue;
        }
        for (let index = 0; index < stripeCount; index += 1) {
          const offset = -laneWidth / 2 + crosswalkGap * (index * 2 + 1);
          const crosswalkGeometry =
            road.orientation === "horizontal"
              ? new THREE.BoxGeometry(crosswalkSpan, 0.01, stripeThickness)
              : new THREE.BoxGeometry(stripeThickness, 0.01, crosswalkSpan);
          const crosswalkStripe = new THREE.Mesh(crosswalkGeometry, crosswalkMaterial);
          crosswalkStripe.position.set(
            road.orientation === "horizontal" ? anchor : road.x + offset,
            stripeY + 0.001,
            road.orientation === "horizontal" ? road.z + offset : anchor,
          );
          crosswalkStripe.castShadow = false;
          crosswalkStripe.receiveShadow = false;
          group.add(crosswalkStripe);
        }
      }
    }

    const lightSeed = stableHash(
      `${road.districtKey}|${road.orientation}|${road.x.toFixed(2)}|${road.z.toFixed(2)}|${laneSpan.toFixed(2)}`,
    );
    const lightRng = createSeededRng(lightSeed);
    if (laneSpan > 2.6 && lightRng() > 0.24) {
      const anchors = [-Math.min(1.2, laneSpan * 0.26), Math.min(1.2, laneSpan * 0.26)];
      const lateralOffset = laneWidth / 2 + 0.24;
      const side = lightRng() < 0.5 ? -1 : 1;
      for (const anchor of anchors) {
        const lightX = road.orientation === "horizontal" ? road.x + anchor : road.x + side * lateralOffset;
        const lightZ = road.orientation === "horizontal" ? road.z + side * lateralOffset : road.z + anchor;
        const streetLight = this.createStreetLight(lightX, roadY + roadHeight / 2, lightZ, road.orientation, side);
        group.add(streetLight);
      }
    }

    return group;
  }

  private addDistrictRoadEdgeConnectors(
    group: any,
    road: CitySceneModel["roads"][number],
    district: CitySceneModel["districts"][number],
    roadY: number,
    roadHeight: number,
    laneWidth: number,
  ): void {
    if (!this.state) {
      return;
    }
    const { THREE } = this.state;
    const connectorMaterial = new THREE.MeshStandardMaterial({
      color: 0x70788a,
      roughness: 0.72,
      metalness: 0.03,
    });
    const connectorTopMaterial = new THREE.MeshStandardMaterial({
      color: 0x818a9c,
      roughness: 0.62,
      metalness: 0.02,
    });
    const loopCenterInset = district.width / 2 + 0.11 + ROAD_STANDARD_WIDTH / 2;
    const loopCenterInsetDepth = district.depth / 2 + 0.11 + ROAD_STANDARD_WIDTH / 2;
    const stripeY = roadY + roadHeight / 2 + 0.007;

    const addConnector = (
      orientation: "horizontal" | "vertical",
      centerX: number,
      centerZ: number,
      span: number,
      width: number,
    ): void => {
      if (span <= 0.08) {
        return;
      }
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(
          orientation === "horizontal" ? span : width,
          roadHeight,
          orientation === "horizontal" ? width : span,
        ),
        connectorMaterial,
      );
      body.position.set(centerX, roadY, centerZ);
      body.receiveShadow = true;
      body.castShadow = false;
      group.add(body);

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(
          orientation === "horizontal" ? Math.max(0.06, span - 0.04) : Math.max(0.06, width - 0.04),
          0.01,
          orientation === "horizontal" ? Math.max(0.06, width - 0.04) : Math.max(0.06, span - 0.04),
        ),
        connectorTopMaterial,
      );
      cap.position.set(centerX, roadY + roadHeight / 2 + 0.004, centerZ);
      cap.receiveShadow = true;
      cap.castShadow = false;
      group.add(cap);

      this.addRoadLinearMarkings(group, orientation, centerX, centerZ, span, width, stripeY);
    };

    if (road.orientation === "horizontal") {
      const leftEnd = road.x - road.width / 2;
      const rightEnd = road.x + road.width / 2;
      const leftTarget = district.x - loopCenterInset;
      const rightTarget = district.x + loopCenterInset;

      const leftSpan = Math.abs(leftEnd - leftTarget);
      const rightSpan = Math.abs(rightTarget - rightEnd);
      addConnector("horizontal", (leftEnd + leftTarget) / 2, road.z, leftSpan, laneWidth);
      addConnector("horizontal", (rightEnd + rightTarget) / 2, road.z, rightSpan, laneWidth);
    } else {
      const topEnd = road.z - road.depth / 2;
      const bottomEnd = road.z + road.depth / 2;
      const topTarget = district.z - loopCenterInsetDepth;
      const bottomTarget = district.z + loopCenterInsetDepth;

      const topSpan = Math.abs(topEnd - topTarget);
      const bottomSpan = Math.abs(bottomTarget - bottomEnd);
      addConnector("vertical", road.x, (topEnd + topTarget) / 2, topSpan, laneWidth);
      addConnector("vertical", road.x, (bottomEnd + bottomTarget) / 2, bottomSpan, laneWidth);
    }
  }

  private addRoadLinearMarkings(
    group: any,
    orientation: "horizontal" | "vertical",
    centerX: number,
    centerZ: number,
    laneSpan: number,
    laneWidth: number,
    stripeY: number,
    blockedIntervals: Array<{ start: number; end: number }> = [],
  ): void {
    if (!this.state || laneSpan <= 0.12 || laneWidth <= 0.08) {
      return;
    }
    const { THREE } = this.state;
    const sideMargin = Math.min(ROAD_MARKING_MARGIN, laneSpan * 0.2);
    const laneSegments = this.buildRoadLaneSegments(laneSpan, sideMargin, blockedIntervals);
    if (laneSegments.length === 0) {
      return;
    }

    const edgeLineWidth = Math.min(ROAD_EDGE_LINE_WIDTH, Math.max(0.024, laneWidth * 0.1));
    const edgeOffset = Math.max(0.01, laneWidth / 2 - edgeLineWidth * 0.62);
    const edgeLineMaterial = new THREE.MeshStandardMaterial({
      color: 0xf6f8fc,
      roughness: 0.5,
      metalness: 0.05,
    });

    for (const direction of [-1, 1]) {
      for (const segment of laneSegments) {
        const segmentLength = segment.end - segment.start;
        if (segmentLength < 0.16) {
          continue;
        }
        const edgeLineGeometry =
          orientation === "horizontal"
            ? new THREE.BoxGeometry(segmentLength, 0.01, edgeLineWidth)
            : new THREE.BoxGeometry(edgeLineWidth, 0.01, segmentLength);
        const edgeCenter = (segment.start + segment.end) / 2;
        const edgeLine = new THREE.Mesh(edgeLineGeometry, edgeLineMaterial);
        edgeLine.position.set(
          orientation === "horizontal" ? centerX + edgeCenter : centerX + direction * edgeOffset,
          stripeY,
          orientation === "horizontal" ? centerZ + direction * edgeOffset : centerZ + edgeCenter,
        );
        edgeLine.castShadow = false;
        edgeLine.receiveShadow = false;
        group.add(edgeLine);
      }
    }

    const dashWidth = Math.min(ROAD_CENTER_DASH_WIDTH, Math.max(0.024, laneWidth * 0.11));
    const dashLength = Math.min(ROAD_DASH_LENGTH, Math.max(0.26, laneSpan * 0.16));
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f4f8,
      roughness: 0.5,
      metalness: 0.05,
    });

    for (const segment of laneSegments) {
      const segmentLength = segment.end - segment.start;
      if (segmentLength < dashLength * 0.68) {
        continue;
      }
      let centerOffset = segment.start + dashLength / 2;
      while (centerOffset <= segment.end - dashLength / 2 + 1e-6) {
        const dashGeometry =
          orientation === "horizontal"
            ? new THREE.BoxGeometry(dashLength, 0.01, dashWidth)
            : new THREE.BoxGeometry(dashWidth, 0.01, dashLength);
        const dash = new THREE.Mesh(dashGeometry, stripeMaterial);
        dash.position.set(
          orientation === "horizontal" ? centerX + centerOffset : centerX,
          stripeY,
          orientation === "horizontal" ? centerZ : centerZ + centerOffset,
        );
        dash.castShadow = false;
        dash.receiveShadow = false;
        group.add(dash);
        centerOffset += dashLength + ROAD_DASH_GAP;
      }
    }
  }

  private addRoadRingMarkings(
    group: any,
    centerX: number,
    centerZ: number,
    outerWidth: number,
    outerDepth: number,
    outerRadius: number,
    laneWidth: number,
    stripeY: number,
  ): void {
    if (!this.state || laneWidth <= 0.08) {
      return;
    }
    const { THREE } = this.state;
    const lineMaterial = new THREE.MeshStandardMaterial({
      color: 0xf6f8fc,
      roughness: 0.5,
      metalness: 0.05,
    });
    const centerMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f4f8,
      roughness: 0.5,
      metalness: 0.05,
    });

    const edgeLineWidth = Math.min(ROAD_EDGE_LINE_WIDTH, Math.max(0.024, laneWidth * 0.1));
    const innerWidth = outerWidth - laneWidth * 2;
    const innerDepth = outerDepth - laneWidth * 2;
    const innerRadius = Math.max(0.08, outerRadius - laneWidth);

    const outerEdgeGeometry = this.createRoundedRingBandGeometry(
      outerWidth,
      outerDepth,
      outerRadius,
      outerWidth - edgeLineWidth * 2,
      outerDepth - edgeLineWidth * 2,
      Math.max(0.08, outerRadius - edgeLineWidth),
    );
    if (outerEdgeGeometry) {
      const outerEdge = new THREE.Mesh(outerEdgeGeometry, lineMaterial);
      outerEdge.position.set(centerX, stripeY, centerZ);
      outerEdge.castShadow = false;
      outerEdge.receiveShadow = false;
      group.add(outerEdge);
    }

    const innerEdgeGeometry = this.createRoundedRingBandGeometry(
      innerWidth + edgeLineWidth * 2,
      innerDepth + edgeLineWidth * 2,
      innerRadius + edgeLineWidth,
      innerWidth,
      innerDepth,
      innerRadius,
    );
    if (innerEdgeGeometry) {
      const innerEdge = new THREE.Mesh(innerEdgeGeometry, lineMaterial);
      innerEdge.position.set(centerX, stripeY, centerZ);
      innerEdge.castShadow = false;
      innerEdge.receiveShadow = false;
      group.add(innerEdge);
    }

    const centerLineWidth = Math.min(ROAD_CENTER_DASH_WIDTH, Math.max(0.024, laneWidth * 0.11));
    const centerWidth = outerWidth - laneWidth;
    const centerDepth = outerDepth - laneWidth;
    const centerRadius = Math.max(0.08, outerRadius - laneWidth / 2);
    const centerGeometry = this.createRoundedRingBandGeometry(
      centerWidth + centerLineWidth,
      centerDepth + centerLineWidth,
      centerRadius + centerLineWidth / 2,
      centerWidth - centerLineWidth,
      centerDepth - centerLineWidth,
      Math.max(0.08, centerRadius - centerLineWidth / 2),
    );
    if (centerGeometry) {
      const centerLine = new THREE.Mesh(centerGeometry, centerMaterial);
      centerLine.position.set(centerX, stripeY, centerZ);
      centerLine.castShadow = false;
      centerLine.receiveShadow = false;
      group.add(centerLine);
    }
  }

  private computeRoadBlockedIntervals(
    road: CitySceneModel["roads"][number],
    roads: CitySceneModel["roads"],
  ): Array<{ start: number; end: number }> {
    const intervals: Array<{ start: number; end: number }> = [];
    for (const other of roads) {
      if (
        other === road ||
        other.orientation === road.orientation ||
        other.districtKey !== road.districtKey
      ) {
        continue;
      }

      if (road.orientation === "horizontal") {
        const crosses = Math.abs(other.z - road.z) <= (road.depth + other.depth) / 2 - 0.01;
        if (!crosses) {
          continue;
        }
        const center = other.x - road.x;
        const half = other.width / 2 + 0.2;
        intervals.push({ start: center - half, end: center + half });
      } else {
        const crosses = Math.abs(other.x - road.x) <= (road.width + other.width) / 2 - 0.01;
        if (!crosses) {
          continue;
        }
        const center = other.z - road.z;
        const half = other.depth / 2 + 0.2;
        intervals.push({ start: center - half, end: center + half });
      }
    }
    return this.mergeRoadIntervals(intervals);
  }

  private mergeRoadIntervals(
    intervals: Array<{ start: number; end: number }>,
  ): Array<{ start: number; end: number }> {
    if (intervals.length === 0) {
      return [];
    }
    const sorted = intervals
      .map((interval) => ({
        start: Math.min(interval.start, interval.end),
        end: Math.max(interval.start, interval.end),
      }))
      .sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of sorted) {
      const previous = merged[merged.length - 1];
      if (!previous || interval.start > previous.end + 1e-6) {
        merged.push({ ...interval });
      } else {
        previous.end = Math.max(previous.end, interval.end);
      }
    }
    return merged;
  }

  private buildRoadLaneSegments(
    laneSpan: number,
    sideMargin: number,
    blockedIntervals: Array<{ start: number; end: number }>,
  ): Array<{ start: number; end: number }> {
    const laneStart = -laneSpan / 2 + sideMargin;
    const laneEnd = laneSpan / 2 - sideMargin;
    const clippedBlocked = this.mergeRoadIntervals(
      blockedIntervals
        .map((interval) => ({
          start: Math.max(laneStart, interval.start),
          end: Math.min(laneEnd, interval.end),
        }))
        .filter((interval) => interval.end - interval.start > 0.02),
    );
    if (clippedBlocked.length === 0) {
      return [{ start: laneStart, end: laneEnd }];
    }

    const clearance = 0.05;
    const segments: Array<{ start: number; end: number }> = [];
    let cursor = laneStart;
    for (const blocked of clippedBlocked) {
      const segmentEnd = blocked.start - clearance;
      if (segmentEnd - cursor > 0.14) {
        segments.push({ start: cursor, end: segmentEnd });
      }
      cursor = Math.max(cursor, blocked.end + clearance);
    }
    if (laneEnd - cursor > 0.14) {
      segments.push({ start: cursor, end: laneEnd });
    }
    return segments;
  }

  private isRoadOffsetBlocked(
    offset: number,
    blockedIntervals: Array<{ start: number; end: number }>,
    margin: number,
  ): boolean {
    return blockedIntervals.some((interval) => {
      return offset >= interval.start - margin && offset <= interval.end + margin;
    });
  }

  private createStreetLight(
    x: number,
    baseY: number,
    z: number,
    orientation: "horizontal" | "vertical",
    side: number,
  ): any {
    if (!this.state) {
      throw new Error("Cannot create street light without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const poleHeight = 0.68;
    const armLength = 0.24;
    const extensionDirection = side >= 0 ? -1 : 1;
    group.position.set(x, 0, z);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.024, poleHeight, 8),
      new THREE.MeshStandardMaterial({
        color: 0xc5cbd8,
        roughness: 0.46,
        metalness: 0.24,
      }),
    );
    pole.position.set(0, baseY + poleHeight / 2, 0);
    pole.castShadow = true;
    pole.receiveShadow = false;
    group.add(pole);

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(
        orientation === "vertical" ? armLength : 0.03,
        0.03,
        orientation === "horizontal" ? armLength : 0.03,
      ),
      new THREE.MeshStandardMaterial({
        color: 0xc7cedb,
        roughness: 0.45,
        metalness: 0.2,
      }),
    );
    arm.position.set(
      orientation === "vertical" ? extensionDirection * armLength * 0.46 : 0,
      baseY + poleHeight - 0.04,
      orientation === "horizontal" ? extensionDirection * armLength * 0.46 : 0,
    );
    arm.castShadow = true;
    group.add(arm);

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xf0f6ff,
        emissive: 0xb7d9ff,
        emissiveIntensity: 0.1,
        roughness: 0.3,
        metalness: 0.12,
      }),
    );
    lamp.position.set(
      orientation === "vertical" ? extensionDirection * armLength * 0.94 : 0,
      baseY + poleHeight - 0.05,
      orientation === "horizontal" ? extensionDirection * armLength * 0.94 : 0,
    );
    lamp.castShadow = false;
    group.add(lamp);

    return group;
  }

  private createToyCar(
    x: number,
    baseY: number,
    z: number,
    orientation: "horizontal" | "vertical",
    styleIndex: number,
  ): any {
    if (!this.state) {
      throw new Error("Cannot create toy car without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const carColors = [0xe95a4f, 0x5ea8ff, 0xf7bc2d, 0x67c77d];
    const bodyColor = carColors[styleIndex % carColors.length]!;
    const length = 0.26;
    const width = 0.13;
    const bodyHeight = 0.07;
    group.position.set(x, baseY + 0.04, z);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(orientation === "horizontal" ? length : width, bodyHeight, orientation === "horizontal" ? width : length),
      new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.58,
        metalness: 0.08,
      }),
    );
    body.position.y = bodyHeight / 2;
    body.castShadow = true;
    group.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(
        orientation === "horizontal" ? length * 0.52 : width * 0.7,
        bodyHeight * 0.65,
        orientation === "horizontal" ? width * 0.74 : length * 0.52,
      ),
      new THREE.MeshStandardMaterial({
        color: 0xe9f2ff,
        roughness: 0.5,
        metalness: 0.06,
      }),
    );
    cabin.position.set(0, bodyHeight * 0.86, 0);
    cabin.castShadow = true;
    group.add(cabin);

    const wheelOffsets: Array<{ x: number; z: number }> =
      orientation === "horizontal"
        ? [
            { x: -length * 0.28, z: -width * 0.48 },
            { x: length * 0.28, z: -width * 0.48 },
            { x: -length * 0.28, z: width * 0.48 },
            { x: length * 0.28, z: width * 0.48 },
          ]
        : [
            { x: -width * 0.48, z: -length * 0.28 },
            { x: width * 0.48, z: -length * 0.28 },
            { x: -width * 0.48, z: length * 0.28 },
            { x: width * 0.48, z: length * 0.28 },
          ];
    for (const offset of wheelOffsets) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.018, 10),
        new THREE.MeshStandardMaterial({
          color: 0x202835,
          roughness: 0.82,
          metalness: 0.06,
        }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(offset.x, 0.02, offset.z);
      wheel.castShadow = true;
      group.add(wheel);
    }

    return group;
  }

  private findCrosswalkAnchors(
    road: CitySceneModel["roads"][number],
    gardens: CitySceneModel["gardens"],
  ): number[] {
    const sameDistrictGardens = gardens.filter((garden) => garden.districtKey === road.districtKey);
    if (sameDistrictGardens.length === 0) {
      return [];
    }
    const anchors: number[] = [];
    const spanHalf = road.orientation === "horizontal" ? road.width / 2 : road.depth / 2;
    const crossHalf = road.orientation === "horizontal" ? road.depth / 2 : road.width / 2;
    const minAnchor = (road.orientation === "horizontal" ? road.x : road.z) - spanHalf + 0.42;
    const maxAnchor = (road.orientation === "horizontal" ? road.x : road.z) + spanHalf - 0.42;

    for (const garden of sameDistrictGardens) {
      const alignedCenter = road.orientation === "horizontal" ? garden.x : garden.z;
      const gardenCrossCenter = road.orientation === "horizontal" ? garden.z : garden.x;
      const gardenCrossHalf = road.orientation === "horizontal" ? garden.depth / 2 : garden.width / 2;
      const roadCrossCenter = road.orientation === "horizontal" ? road.z : road.x;
      const crossDistance = Math.abs(gardenCrossCenter - roadCrossCenter) - (crossHalf + gardenCrossHalf);
      if (crossDistance > 0.72) {
        continue;
      }
      const clampedAnchor = clamp(alignedCenter, minAnchor, maxAnchor);
      if (clampedAnchor !== clampedAnchor) {
        continue;
      }
      anchors.push(clampedAnchor);
    }

    anchors.sort((a, b) => a - b);
    const deduped: number[] = [];
    for (const anchor of anchors) {
      if (deduped.some((existing) => Math.abs(existing - anchor) < 0.9)) {
        continue;
      }
      deduped.push(anchor);
      if (deduped.length >= 2) {
        break;
      }
    }
    return deduped;
  }

  private createGardenFeature(garden: CitySceneModel["gardens"][number]): any {
    if (!this.state) {
      throw new Error("Cannot create garden feature without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const patchHeight = garden.style === "park" ? 0.08 : 0.055;
    const patchColor = garden.style === "park" ? 0x70c64f : 0xbdae89;
    const patchWidth = garden.width * (garden.style === "park" ? 1.3 : 1.06);
    const patchDepth = garden.depth * (garden.style === "park" ? 1.3 : 1.06);
    const patchY = 0.405 + patchHeight / 2;
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(patchWidth, patchHeight, patchDepth),
      new THREE.MeshStandardMaterial({
        color: patchColor,
        roughness: 0.82,
        metalness: 0.02,
      }),
    );
    patch.position.set(garden.x, patchY, garden.z);
    patch.receiveShadow = true;
    patch.castShadow = false;
    group.add(patch);

    const border = new THREE.Mesh(
      new THREE.BoxGeometry(patchWidth + 0.04, 0.012, patchDepth + 0.04),
      new THREE.MeshStandardMaterial({
        color: garden.style === "park" ? 0x4f9e39 : 0xa29270,
        roughness: 0.74,
        metalness: 0.02,
      }),
    );
    border.position.set(garden.x, patchY + patchHeight / 2 + 0.007, garden.z);
    border.castShadow = false;
    border.receiveShadow = true;
    group.add(border);

    const seed = stableHash(`${garden.districtKey}|${garden.x.toFixed(2)}|${garden.z.toFixed(2)}|${garden.style}`);
    const rng = createSeededRng(seed);

    if (garden.style === "park") {
      if (patchWidth > 1.1 && patchDepth > 1.1 && rng() > 0.34) {
        const pathWidth = Math.min(0.24, Math.max(0.12, Math.min(patchWidth, patchDepth) * 0.18));
        const horizontalPath = new THREE.Mesh(
          new THREE.BoxGeometry(patchWidth * 0.88, 0.012, pathWidth),
          new THREE.MeshStandardMaterial({
            color: 0xd8ceab,
            roughness: 0.76,
            metalness: 0.01,
          }),
        );
        horizontalPath.position.set(garden.x, patchY + patchHeight / 2 + 0.01, garden.z);
        horizontalPath.receiveShadow = true;
        group.add(horizontalPath);

        if (rng() > 0.45) {
          const verticalPath = new THREE.Mesh(
            new THREE.BoxGeometry(pathWidth, 0.012, patchDepth * 0.88),
            new THREE.MeshStandardMaterial({
              color: 0xd3c89f,
              roughness: 0.78,
              metalness: 0.01,
            }),
          );
          verticalPath.position.set(garden.x, patchY + patchHeight / 2 + 0.011, garden.z);
          verticalPath.receiveShadow = true;
          group.add(verticalPath);
        }
      }

      const treeCount = Math.max(
        2,
        Math.min(7, Math.round(patchWidth * patchDepth * 0.68) + Math.floor(rng() * 2)),
      );
      for (let index = 0; index < treeCount; index += 1) {
        const treeOffsetX = (rng() - 0.5) * patchWidth * 0.62;
        const treeOffsetZ = (rng() - 0.5) * patchDepth * 0.62;
        const tree = this.createLowPolyTree(
          garden.x + treeOffsetX,
          0.405 + patchHeight,
          garden.z + treeOffsetZ,
          rng,
        );
        group.add(tree);
      }

      if (patchWidth > 1.4 && patchDepth > 1.25 && rng() > 0.6) {
        const playground = this.createPlaygroundFeature(
          {
            ...garden,
            width: patchWidth,
            depth: patchDepth,
          },
          0.405 + patchHeight,
          rng,
        );
        group.add(playground);
      }
    } else {
      const rockCount = 1 + Math.floor(rng() * 3);
      for (let index = 0; index < rockCount; index += 1) {
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.045 + rng() * 0.02, 0),
          new THREE.MeshStandardMaterial({
            color: 0xa28f6d,
            roughness: 0.86,
            metalness: 0.01,
          }),
        );
        rock.position.set(
          garden.x + (rng() - 0.5) * garden.width * 0.58,
          0.405 + patchHeight + 0.04,
          garden.z + (rng() - 0.5) * garden.depth * 0.58,
        );
        rock.castShadow = true;
        group.add(rock);
      }
    }
    return group;
  }

  private createLowPolyTree(x: number, groundY: number, z: number, rng: () => number): any {
    if (!this.state) {
      throw new Error("Cannot create tree without renderer state");
    }
    const { THREE } = this.state;
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);

    const trunkHeight = 0.17 + rng() * 0.12;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.036, trunkHeight, 6),
      new THREE.MeshStandardMaterial({
        color: 0x6e5439,
        roughness: 0.9,
        metalness: 0.01,
      }),
    );
    trunk.position.set(0, groundY + trunkHeight / 2, 0);
    trunk.castShadow = true;
    tree.add(trunk);

    const crownBase = 0.13 + rng() * 0.065;
    if (rng() > 0.42) {
      const crown = new THREE.Mesh(
        new THREE.DodecahedronGeometry(crownBase, 0),
        new THREE.MeshStandardMaterial({
          color: rng() > 0.5 ? 0x38ad4f : 0x41bf62,
          roughness: 0.74,
          metalness: 0.02,
        }),
      );
      crown.position.set(0, groundY + trunkHeight + crownBase * 0.85, 0);
      crown.castShadow = true;
      tree.add(crown);

      const upperCrown = new THREE.Mesh(
        new THREE.DodecahedronGeometry(crownBase * 0.72, 0),
        new THREE.MeshStandardMaterial({
          color: rng() > 0.5 ? 0x42bc62 : 0x4ccd72,
          roughness: 0.72,
          metalness: 0.02,
        }),
      );
      upperCrown.position.set(0, groundY + trunkHeight + crownBase * 1.55, 0);
      upperCrown.castShadow = true;
      tree.add(upperCrown);
    } else {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(crownBase * 0.92, crownBase * 2.2, 8),
        new THREE.MeshStandardMaterial({
          color: 0x2d9650,
          roughness: 0.75,
          metalness: 0.02,
        }),
      );
      cone.position.set(0, groundY + trunkHeight + crownBase * 0.95, 0);
      cone.castShadow = true;
      tree.add(cone);
    }

    return tree;
  }

  private createPlaygroundFeature(
    garden: CitySceneModel["gardens"][number],
    groundY: number,
    rng: () => number,
  ): any {
    if (!this.state) {
      throw new Error("Cannot create playground without renderer state");
    }
    const { THREE } = this.state;
    const playground = new THREE.Group();
    const areaWidth = garden.width * 0.52;
    const areaDepth = garden.depth * 0.5;
    const centerX = garden.x + (rng() - 0.5) * Math.max(0.12, garden.width * 0.2);
    const centerZ = garden.z + (rng() - 0.5) * Math.max(0.12, garden.depth * 0.2);
    const areaY = groundY + 0.01;

    const area = new THREE.Mesh(
      new THREE.BoxGeometry(areaWidth, 0.016, areaDepth),
      new THREE.MeshStandardMaterial({
        color: 0xdfc791,
        roughness: 0.79,
        metalness: 0.01,
      }),
    );
    area.position.set(centerX, areaY, centerZ);
    area.receiveShadow = true;
    playground.add(area);

    const fenceHeight = 0.09;
    const fenceThickness = 0.018;
    const fenceMaterial = new THREE.MeshStandardMaterial({
      color: 0x7f4d30,
      roughness: 0.7,
      metalness: 0.02,
    });
    const fenceSegments = [
      new THREE.BoxGeometry(areaWidth, fenceHeight, fenceThickness),
      new THREE.BoxGeometry(areaWidth, fenceHeight, fenceThickness),
      new THREE.BoxGeometry(fenceThickness, fenceHeight, areaDepth),
      new THREE.BoxGeometry(fenceThickness, fenceHeight, areaDepth),
    ];
    const fenceOffsets: Array<{ x: number; z: number }> = [
      { x: 0, z: areaDepth / 2 },
      { x: 0, z: -areaDepth / 2 },
      { x: areaWidth / 2, z: 0 },
      { x: -areaWidth / 2, z: 0 },
    ];
    for (let index = 0; index < fenceSegments.length; index += 1) {
      const fence = new THREE.Mesh(fenceSegments[index]!, fenceMaterial);
      fence.position.set(centerX + fenceOffsets[index]!.x, areaY + fenceHeight / 2, centerZ + fenceOffsets[index]!.z);
      fence.castShadow = true;
      playground.add(fence);
    }

    const frameWidth = Math.max(0.22, areaWidth * 0.26);
    const frameDepth = Math.max(0.12, areaDepth * 0.22);
    const frameHeight = 0.2;
    const frameY = areaY + 0.01;
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xb95042,
      roughness: 0.52,
      metalness: 0.06,
    });

    for (const sideX of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, frameHeight, 0.02), frameMaterial);
      leg.position.set(centerX + sideX * frameWidth * 0.5, frameY + frameHeight / 2, centerZ - frameDepth * 0.25);
      leg.castShadow = true;
      playground.add(leg);
    }
    const topBar = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth + 0.02, 0.02, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0xb75042,
        roughness: 0.48,
        metalness: 0.07,
      }),
    );
    topBar.position.set(centerX, frameY + frameHeight, centerZ - frameDepth * 0.25);
    topBar.castShadow = true;
    playground.add(topBar);

    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth * 0.34, 0.014, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0xf2bf25,
        roughness: 0.66,
        metalness: 0.02,
      }),
    );
    seat.position.set(centerX, frameY + frameHeight * 0.5, centerZ - frameDepth * 0.25);
    seat.castShadow = true;
    playground.add(seat);

    return playground;
  }

  private drawFramedWindow(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    fillStyle: string,
  ): void {
    const px = Math.round(x);
    const py = Math.round(y);
    const pw = Math.max(2, Math.round(width));
    const ph = Math.max(2, Math.round(height));
    const frame = Math.max(1, Math.round(Math.min(pw, ph) * 0.1));
    context.fillStyle = "rgb(219 227 242)";
    context.fillRect(px, py, pw, ph);

    const innerX = px + frame;
    const innerY = py + frame;
    const innerW = Math.max(1, pw - frame * 2);
    const innerH = Math.max(1, ph - frame * 2);
    context.fillStyle = fillStyle;
    context.fillRect(innerX, innerY, innerW, innerH);
  }

  private createBuildingFacadeMaps(
    building: CitySceneModel["buildings"][number],
    sideSize: number,
    sideAxis: "x" | "z",
  ): { albedo: any; emissive: any } {
    if (!this.state) {
      throw new Error("Cannot create facade maps without renderer state");
    }
    const seed = stableHash(`${building.path}|${sideAxis}|${sideSize.toFixed(2)}`);
    const rng = createSeededRng(seed);
    const facadeTemplate = seed % 5;
    const rows = Math.max(3, Math.min(10, Math.round(building.height / 1.25 + rng() * 0.8)));

    const canvasSize = 256;
    const wallCanvas = document.createElement("canvas");
    wallCanvas.width = canvasSize;
    wallCanvas.height = canvasSize;
    const wallContext = wallCanvas.getContext("2d");
    if (!wallContext) {
      throw new Error("Cannot create facade wall context");
    }
    const wallTone = 248;
    wallContext.fillStyle = `rgb(${wallTone} ${wallTone - 1} ${Math.min(255, wallTone + 2)})`;
    wallContext.fillRect(0, 0, canvasSize, canvasSize);

    const emissiveCanvas = document.createElement("canvas");
    emissiveCanvas.width = canvasSize;
    emissiveCanvas.height = canvasSize;
    const emissiveContext = emissiveCanvas.getContext("2d");
    if (!emissiveContext) {
      throw new Error("Cannot create facade emissive context");
    }
    emissiveContext.fillStyle = "rgb(0 0 0)";
    emissiveContext.fillRect(0, 0, canvasSize, canvasSize);

    const plinthHeight = Math.round(canvasSize * (0.15 + rng() * 0.04));
    const plinthY = canvasSize - plinthHeight;
    wallContext.fillStyle = "rgb(136 143 161)";
    wallContext.fillRect(0, plinthY, canvasSize, plinthHeight);
    wallContext.fillStyle = "rgba(241, 245, 253, 0.32)";
    wallContext.fillRect(0, plinthY, canvasSize, 2);

    const insetX = Math.round(sideAxis === "x" ? 20 + rng() * 8 : 26 + rng() * 9);
    const insetTop = Math.round(16 + rng() * 8);
    const insetBottom = plinthHeight + Math.round(9 + rng() * 5);
    const facadeWidth = Math.max(32, canvasSize - insetX * 2);
    const facadeHeight = Math.max(26, canvasSize - insetTop - insetBottom);
    const rowGap = Math.max(5, Math.round(facadeHeight * 0.04));
    const rowHeight = Math.max(9, (facadeHeight - rowGap * (rows - 1)) / rows);
    const windowFill = "rgb(26 112 222)";

    const drawWindow = (x: number, y: number, width: number, height: number): void => {
      this.drawFramedWindow(wallContext, x, y, width, height, windowFill);
    };

    for (let row = 0; row < rows; row += 1) {
      if (row > 0 && row < rows - 1 && rng() < 0.05) {
        continue;
      }
      const slotY = insetTop + row * (rowHeight + rowGap);
      const windowHeight = Math.max(6, rowHeight * (sideAxis === "x" ? 0.58 : 0.54));
      const y = slotY + (rowHeight - windowHeight) * 0.5;

      if (sideAxis === "x") {
        if (facadeTemplate % 3 === 0) {
          const width = facadeWidth * 0.74;
          drawWindow(insetX + (facadeWidth - width) / 2, y, width, windowHeight);
        } else if (facadeTemplate % 3 === 1) {
          const gap = facadeWidth * 0.08;
          const width = (facadeWidth - gap) * 0.46;
          drawWindow(insetX, y, width, windowHeight);
          drawWindow(insetX + width + gap, y, width, windowHeight);
        } else {
          const cols = 3;
          const gap = facadeWidth * 0.06;
          const width = (facadeWidth - gap * (cols - 1)) / cols;
          for (let col = 0; col < cols; col += 1) {
            if (rng() < 0.08) {
              continue;
            }
            drawWindow(insetX + col * (width + gap), y, width, windowHeight);
          }
        }
      } else if (facadeTemplate % 2 === 0) {
        const cols = facadeWidth > 78 ? 2 : 1;
        const gap = cols === 2 ? facadeWidth * 0.12 : 0;
        const width = cols === 2 ? (facadeWidth - gap) / 2 : facadeWidth * 0.34;
        for (let col = 0; col < cols; col += 1) {
          const x =
            cols === 2
              ? insetX + col * (width + gap)
              : insetX + (facadeWidth - width) / 2 + (rng() - 0.5) * Math.max(0, facadeWidth * 0.08);
          drawWindow(x, y, width, windowHeight * 0.92);
        }
      } else {
        const width = facadeWidth * 0.28;
        const x = insetX + (facadeWidth - width) / 2 + (rng() - 0.5) * Math.max(0, facadeWidth * 0.14);
        drawWindow(x, y, width, windowHeight * 0.9);
      }
    }

    const doorCount = sideAxis === "x" && facadeWidth > 94 ? 2 : 1;
    const doorWidth = Math.max(11, Math.min(24, facadeWidth * (doorCount === 2 ? 0.16 : 0.2)));
    const doorHeight = Math.max(12, Math.round(plinthHeight * 0.58));
    const doorY = canvasSize - Math.round(plinthHeight * 0.2) - doorHeight;
    for (let index = 0; index < doorCount; index += 1) {
      const doorX =
        doorCount === 1
          ? insetX + (facadeWidth - doorWidth) / 2
          : insetX + (facadeWidth - doorWidth * 2) * (index === 0 ? 0.2 : 0.8);
      wallContext.fillStyle = "rgb(203 207 217)";
      wallContext.fillRect(Math.round(doorX), doorY, Math.round(doorWidth), doorHeight);
      wallContext.fillStyle = "rgba(122, 130, 146, 0.36)";
      wallContext.fillRect(Math.round(doorX), doorY, 2, doorHeight);
    }

    const albedo = new this.state.THREE.CanvasTexture(wallCanvas);
    albedo.wrapS = this.state.THREE.ClampToEdgeWrapping;
    albedo.wrapT = this.state.THREE.ClampToEdgeWrapping;
    albedo.colorSpace = this.state.THREE.SRGBColorSpace;
    albedo.magFilter = this.state.THREE.NearestFilter;
    albedo.minFilter = this.state.THREE.NearestFilter;
    albedo.generateMipmaps = false;
    albedo.needsUpdate = true;

    const emissive = new this.state.THREE.CanvasTexture(emissiveCanvas);
    emissive.wrapS = this.state.THREE.ClampToEdgeWrapping;
    emissive.wrapT = this.state.THREE.ClampToEdgeWrapping;
    emissive.colorSpace = this.state.THREE.SRGBColorSpace;
    emissive.magFilter = this.state.THREE.NearestFilter;
    emissive.minFilter = this.state.THREE.NearestFilter;
    emissive.generateMipmaps = false;
    emissive.needsUpdate = true;

    return { albedo, emissive };
  }

  private fitLightsAndShadows(model: CitySceneModel): void {
    if (!this.state) {
      return;
    }
    const centerX = model.width / 2;
    const centerZ = model.depth / 2;
    const span = Math.max(model.width, model.depth);
    const lightHeight = Math.max(32, model.maxHeight + span * 0.72);
    const lightOffset = Math.max(10, span * 0.42);

    this.state.keyLight.position.set(centerX + lightOffset, lightHeight, centerZ + lightOffset * 0.62);
    this.state.keyLightTarget.position.set(centerX, 0.34, centerZ);
    this.state.keyLightTarget.updateMatrixWorld(true);
    this.state.keyLight.target.updateMatrixWorld(true);

    const shadowCamera = this.state.keyLight.shadow.camera;
    const half = Math.max(16, span * 0.68);
    shadowCamera.left = -half;
    shadowCamera.right = half;
    shadowCamera.top = half;
    shadowCamera.bottom = -half;
    shadowCamera.near = 0.5;
    shadowCamera.far = Math.max(210, model.maxHeight + span * 2.9);
    if (typeof shadowCamera.updateProjectionMatrix === "function") {
      shadowCamera.updateProjectionMatrix();
    }
    this.state.keyLight.shadow.needsUpdate = true;
  }

  private positionCamera(model: CitySceneModel): void {
    if (!this.state) {
      return;
    }
    const centerX = model.width / 2;
    const centerZ = model.depth / 2;
    const radius = Math.max(model.width, model.depth) * 0.84;
    const height = Math.max(12.5, model.maxHeight + 10.5);
    this.state.camera.position.set(centerX + radius * 0.98, height, centerZ + radius * 0.76);
    this.state.controls.target.set(centerX, 0.42, centerZ);
    this.state.controls.update();
  }

  private applySelection(): void {
    if (!this.state) {
      return;
    }
    for (const [path, mesh] of this.state.buildingMeshes.entries()) {
      const selected = this.selectedPath === path;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material || typeof material !== "object") {
          continue;
        }
        const baseHex =
          material.userData && typeof material.userData.baseEmissiveHex === "number"
            ? material.userData.baseEmissiveHex
            : 0x000000;
        const baseIntensity =
          material.userData && typeof material.userData.baseEmissiveIntensity === "number"
            ? material.userData.baseEmissiveIntensity
            : 0;
        if (typeof material.emissive?.setHex === "function") {
          material.emissive.setHex(selected ? 0xffbe4f : baseHex);
        }
        if ("emissiveIntensity" in material) {
          material.emissiveIntensity = selected ? Math.max(baseIntensity, 0.26) : baseIntensity;
        }
      }
      mesh.scale.set(selected ? 1.06 : 1, selected ? 1.02 : 1, selected ? 1.06 : 1);
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.state || !this.pickHandler || event.button !== 0) {
      return;
    }
    const rect = this.state.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    this.state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.state.raycaster.setFromCamera(this.state.pointer, this.state.camera);
    const meshes = [...this.state.buildingMeshes.values()];
    const hits = this.state.raycaster.intersectObjects(meshes, false) as Array<{
      object?: { userData?: { path?: unknown } };
    }>;
    const pickedPath = hits[0]?.object?.userData?.path;
    if (typeof pickedPath === "string" && pickedPath.length > 0) {
      this.pickHandler(pickedPath);
    }
  }

  private clearGroup(group: any): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      this.disposeObject(child);
    }
  }

  private disposeObject(object: any): void {
    if (!object) {
      return;
    }
    if (Array.isArray(object.children)) {
      for (const child of object.children) {
        this.disposeObject(child);
      }
    }
    if (object.geometry && typeof object.geometry.dispose === "function") {
      object.geometry.dispose();
    }
    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        disposeMaterialWithTextures(material);
      }
    } else if (object.material) {
      disposeMaterialWithTextures(object.material);
    }
  }

  private disposeState(): void {
    if (!this.state) {
      return;
    }
    if (this.state.animationFrame !== null) {
      cancelAnimationFrame(this.state.animationFrame);
      this.state.animationFrame = null;
    }
    this.state.renderer.domElement.removeEventListener("pointerdown", this.state.onPointerDown);
    this.clearGroup(this.state.root);
    this.state.renderer.dispose();
    this.state = null;
    this.currentSignature = "";
  }
}
