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

function districtColor(index: number): number {
  const colors = [0xa8d07a, 0x9bc5eb, 0xf0c483, 0xbec6f2, 0x95d7b0];
  return colors[index % colors.length]!;
}

function buildingColor(symbolCount: number, path: string): number {
  const hash = stableHash(path);
  const wallPalette = [0xf2edf4, 0xe8ecf7, 0xdde4f5, 0xcfdaf0];
  const accentPalette = [0x5b79bc, 0x6a8bcf];

  // Rare blue accent tower amid mostly light buildings.
  if (symbolCount >= 8 && hash % 9 === 0) {
    return accentPalette[hash % accentPalette.length]!;
  }

  const symbolTier = symbolCount <= 2 ? 0 : symbolCount <= 6 ? 1 : symbolCount <= 12 ? 2 : 3;
  const paletteIndex = (symbolTier + (hash % 3)) % wallPalette.length;
  return wallPalette[paletteIndex]!;
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

    const hemisphere = new THREE.HemisphereLight(0xb5d9ff, 0x5f8f55, 0.78);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.84);
    keyLight.position.set(26, 38, 15);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0002;
    keyLight.shadow.normalBias = 0.025;
    keyLight.shadow.radius = 2;
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

    const fillLight = new THREE.DirectionalLight(0xa4c8ff, 0.28);
    fillLight.position.set(-18, 16, -20);
    scene.add(fillLight);

    const root = new THREE.Group();
    scene.add(root);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x86c257,
        roughness: 0.94,
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
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.75, 0.9);
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

  private rebuildScene(model: CitySceneModel): void {
    if (!this.state) {
      return;
    }
    const { THREE } = this.state;
    this.clearScene();

    const groundWidth = Math.max(12, model.width + 7);
    const groundDepth = Math.max(12, model.depth + 7);
    this.state.ground.scale.set(groundWidth, groundDepth, 1);
    this.state.ground.position.set(model.width / 2, 0, model.depth / 2);

    model.districts.forEach((district, index) => {
      const districtMesh = new THREE.Mesh(
        new THREE.BoxGeometry(district.width, 0.36, district.depth),
        new THREE.MeshStandardMaterial({
          color: districtColor(index),
          roughness: 0.72,
          metalness: 0.03,
        }),
      );
      districtMesh.position.set(district.x, 0.18, district.z);
      districtMesh.receiveShadow = true;
      this.state?.root.add(districtMesh);
    });

    model.roads.forEach((road) => {
      const roadGroup = this.createRoadFeature(road, model.gardens);
      this.state?.root.add(roadGroup);
    });

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
    const color = new THREE.Color(buildingColor(building.symbolsCount, building.path));
    const sideColor = color.clone().multiplyScalar(0.92);
    const roofColor = color.clone().multiplyScalar(1.03);
    const windowGlow = 0.015 + Math.min(0.03, building.symbolsCount / 280);
    const sideMapsX = this.createBuildingFacadeMaps(building, building.width, "x");
    const sideMapsZ = this.createBuildingFacadeMaps(building, building.depth, "z");

    const sideMaterial = (maps: { albedo: any; emissive: any }) => {
      const material = new THREE.MeshStandardMaterial({
        color: sideColor,
        roughness: 0.64,
        metalness: 0.04,
        map: maps.albedo,
        emissive: 0x4f89df,
        emissiveMap: maps.emissive,
        emissiveIntensity: windowGlow,
      });
      material.userData.baseEmissiveHex = 0x4f89df;
      material.userData.baseEmissiveIntensity = windowGlow;
      return material;
    };

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(building.width, building.height, building.depth),
      [
        sideMaterial(sideMapsX),
        sideMaterial(sideMapsX),
        new THREE.MeshStandardMaterial({
          color: roofColor,
          roughness: 0.55,
          metalness: 0.08,
        }),
        new THREE.MeshStandardMaterial({
          color: sideColor.clone().multiplyScalar(0.75),
          roughness: 0.66,
          metalness: 0.06,
        }),
        sideMaterial(sideMapsZ),
        sideMaterial(sideMapsZ),
      ],
    );
    mesh.position.set(building.x, 0.36 + building.height / 2, building.z);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData.path = building.path;
    return mesh;
  }

  private createRoadFeature(
    road: CitySceneModel["roads"][number],
    gardens: CitySceneModel["gardens"],
  ): any {
    if (!this.state) {
      throw new Error("Cannot create road feature without renderer state");
    }
    const { THREE } = this.state;
    const group = new THREE.Group();
    const roadHeight = 0.055;
    const roadY = 0.388;
    const roadMesh = new THREE.Mesh(
      new THREE.BoxGeometry(road.width, roadHeight, road.depth),
      new THREE.MeshStandardMaterial({
        color: 0x6d7381,
        roughness: 0.92,
        metalness: 0.02,
      }),
    );
    roadMesh.position.set(road.x, roadY, road.z);
    roadMesh.receiveShadow = true;
    roadMesh.castShadow = false;
    group.add(roadMesh);

    const laneSpan = road.orientation === "horizontal" ? road.width : road.depth;
    const laneWidth = road.orientation === "horizontal" ? road.depth : road.width;
    if (laneSpan < 1.9 || laneWidth < 0.55) {
      return group;
    }

    const sideMargin = Math.min(0.3, laneSpan * 0.16);
    const dashLength = Math.min(0.58, Math.max(0.35, laneSpan * 0.12));
    const dashGap = Math.min(0.5, Math.max(0.28, laneSpan * 0.08));
    const stripeWidth = Math.min(0.12, Math.max(0.075, laneWidth * 0.11));
    const usableLength = laneSpan - sideMargin * 2;
    const dashCount = Math.max(1, Math.floor((usableLength + dashGap) / (dashLength + dashGap)));
    const startCenter = -usableLength / 2 + dashLength / 2;
    const stripeY = roadY + roadHeight / 2 + 0.006;
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f4f8,
      roughness: 0.55,
      metalness: 0.04,
    });

    const edgeLineWidth = Math.min(0.06, Math.max(0.04, laneWidth * 0.1));
    const edgeLineLength = Math.max(0.5, laneSpan - sideMargin * 2);
    const edgeOffset = Math.max(0.01, laneWidth / 2 - edgeLineWidth * 0.8);
    const edgeLineMaterial = new THREE.MeshStandardMaterial({
      color: 0xecf0f7,
      roughness: 0.52,
      metalness: 0.05,
    });
    const edgeLineGeometry =
      road.orientation === "horizontal"
        ? new THREE.BoxGeometry(edgeLineLength, 0.01, edgeLineWidth)
        : new THREE.BoxGeometry(edgeLineWidth, 0.01, edgeLineLength);

    for (const direction of [-1, 1]) {
      const edgeLine = new THREE.Mesh(edgeLineGeometry, edgeLineMaterial);
      edgeLine.position.set(
        road.orientation === "horizontal" ? road.x : road.x + direction * edgeOffset,
        stripeY,
        road.orientation === "horizontal" ? road.z + direction * edgeOffset : road.z,
      );
      edgeLine.castShadow = false;
      edgeLine.receiveShadow = false;
      group.add(edgeLine);
    }

    for (let index = 0; index < dashCount; index += 1) {
      const centerOffset = startCenter + index * (dashLength + dashGap);
      if (Math.abs(centerOffset) > laneSpan / 2 - dashLength / 2 - sideMargin + 1e-6) {
        continue;
      }
      const stripeGeometry =
        road.orientation === "horizontal"
          ? new THREE.BoxGeometry(dashLength, 0.01, stripeWidth)
          : new THREE.BoxGeometry(stripeWidth, 0.01, dashLength);
      const stripeMesh = new THREE.Mesh(stripeGeometry, stripeMaterial);
      stripeMesh.position.set(
        road.orientation === "horizontal" ? road.x + centerOffset : road.x,
        stripeY,
        road.orientation === "horizontal" ? road.z : road.z + centerOffset,
      );
      stripeMesh.castShadow = false;
      stripeMesh.receiveShadow = false;
      group.add(stripeMesh);
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
    const patchHeight = garden.style === "park" ? 0.09 : 0.06;
    const patchColor = garden.style === "park" ? 0x6fbb4e : 0xb8b08f;
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(garden.width, patchHeight, garden.depth),
      new THREE.MeshStandardMaterial({
        color: patchColor,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    patch.position.set(garden.x, 0.405 + patchHeight / 2, garden.z);
    patch.receiveShadow = true;
    patch.castShadow = false;
    group.add(patch);

    if (garden.style === "park") {
      const seed = stableHash(`${garden.districtKey}|${garden.x.toFixed(2)}|${garden.z.toFixed(2)}`);
      const rng = createSeededRng(seed);
      const treeCount = 1 + Math.floor(rng() * 3);
      for (let index = 0; index < treeCount; index += 1) {
        const treeOffsetX = (rng() - 0.5) * garden.width * 0.62;
        const treeOffsetZ = (rng() - 0.5) * garden.depth * 0.62;
        const trunkHeight = 0.16 + rng() * 0.08;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.04, trunkHeight, 6),
          new THREE.MeshStandardMaterial({
            color: 0x6d553e,
            roughness: 0.9,
            metalness: 0.01,
          }),
        );
        trunk.position.set(
          garden.x + treeOffsetX,
          0.405 + patchHeight + trunkHeight / 2,
          garden.z + treeOffsetZ,
        );
        trunk.castShadow = true;
        trunk.receiveShadow = false;
        group.add(trunk);

        const leafRadius = 0.11 + rng() * 0.06;
        const leaves = new THREE.Mesh(
          new THREE.DodecahedronGeometry(leafRadius, 0),
          new THREE.MeshStandardMaterial({
            color: rng() < 0.45 ? 0x4ea35f : 0x5ebf74,
            roughness: 0.78,
            metalness: 0.02,
          }),
        );
        leaves.position.set(
          garden.x + treeOffsetX,
          0.405 + patchHeight + trunkHeight + leafRadius * 0.86,
          garden.z + treeOffsetZ,
        );
        leaves.castShadow = true;
        leaves.receiveShadow = false;
        group.add(leaves);
      }
    }
    return group;
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
    const columns = Math.max(1, Math.min(6, Math.round(sideSize / 0.58 + rng() * 0.9)));
    const rows = Math.max(2, Math.min(9, Math.round(building.height / 1.72 + rng() * 1.3)));

    const canvasSize = 192;
    const wallCanvas = document.createElement("canvas");
    wallCanvas.width = canvasSize;
    wallCanvas.height = canvasSize;
    const wallContext = wallCanvas.getContext("2d");
    if (!wallContext) {
      throw new Error("Cannot create facade wall context");
    }
    wallContext.fillStyle = "rgb(252 252 255)";
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

    const insetX = Math.round(16 + rng() * 8);
    const insetY = Math.round(14 + rng() * 10);
    const gridWidth = canvasSize - insetX * 2;
    const gridHeight = canvasSize - insetY * 2;
    const gapX = Math.max(6, Math.round(6 + rng() * 8));
    const gapY = Math.max(7, Math.round(7 + rng() * 8));
    const cellWidth = Math.max(12, (gridWidth - gapX * (columns - 1)) / columns);
    const cellHeight = Math.max(10, (gridHeight - gapY * (rows - 1)) / rows);
    const style = seed % 4;

    const densityBase = 0.12 + Math.min(0.16, building.symbolsCount / 220);
    const prominentRow = style === 1 ? Math.floor(rng() * rows) : -1;
    const sparseColumn = style === 2 ? Math.floor(rng() * columns) : -1;
    const bandEvery = style === 3 ? 3 : 0;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        let probability = densityBase;
        if (row === prominentRow) {
          probability += 0.2;
        }
        if (sparseColumn >= 0 && col === sparseColumn) {
          probability *= 0.4;
        }
        if (bandEvery > 0 && row % bandEvery !== 0) {
          probability *= 0.55;
        }
        if (rng() > probability) {
          continue;
        }

        const wideWindow = rng() < 0.24;
        const tallWindow = !wideWindow && rng() < 0.18;
        const widthFactor = wideWindow ? 0.72 + rng() * 0.2 : 0.24 + rng() * 0.24;
        const heightFactor = tallWindow ? 0.72 + rng() * 0.2 : wideWindow ? 0.28 + rng() * 0.2 : 0.38 + rng() * 0.34;
        const windowWidth = Math.max(5, cellWidth * widthFactor);
        const windowHeight = Math.max(6, cellHeight * heightFactor);
        const baseX = insetX + col * (cellWidth + gapX);
        const baseY = insetY + row * (cellHeight + gapY);
        const jitterX = (cellWidth - windowWidth) * (0.22 + rng() * 0.56);
        const jitterY = (cellHeight - windowHeight) * (0.18 + rng() * 0.62);
        const x = Math.round(baseX + jitterX);
        const y = Math.round(baseY + jitterY);

        wallContext.fillStyle = rng() < 0.3 ? "rgb(55 134 233)" : "rgb(36 113 215)";
        wallContext.fillRect(x, y, Math.round(windowWidth), Math.round(windowHeight));

        const litChance = 0.2 + Math.min(0.12, building.symbolsCount / 300);
        if (rng() < litChance) {
          emissiveContext.fillStyle = "rgb(92 170 255)";
          emissiveContext.fillRect(x, y, Math.round(windowWidth), Math.round(windowHeight));
        }
      }
    }

    const albedo = new this.state.THREE.CanvasTexture(wallCanvas);
    albedo.wrapS = this.state.THREE.ClampToEdgeWrapping;
    albedo.wrapT = this.state.THREE.ClampToEdgeWrapping;
    albedo.colorSpace = this.state.THREE.SRGBColorSpace;
    albedo.magFilter = this.state.THREE.NearestFilter;
    albedo.minFilter = this.state.THREE.LinearMipmapLinearFilter;
    albedo.needsUpdate = true;

    const emissive = new this.state.THREE.CanvasTexture(emissiveCanvas);
    emissive.wrapS = this.state.THREE.ClampToEdgeWrapping;
    emissive.wrapT = this.state.THREE.ClampToEdgeWrapping;
    emissive.colorSpace = this.state.THREE.SRGBColorSpace;
    emissive.magFilter = this.state.THREE.NearestFilter;
    emissive.minFilter = this.state.THREE.LinearMipmapLinearFilter;
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
    const lightHeight = Math.max(26, model.maxHeight + span * 0.46);
    const lightOffset = Math.max(14, span * 0.58);

    this.state.keyLight.position.set(centerX + lightOffset, lightHeight, centerZ + lightOffset * 0.8);
    this.state.keyLightTarget.position.set(centerX, 0.2, centerZ);
    this.state.keyLightTarget.updateMatrixWorld(true);
    this.state.keyLight.target.updateMatrixWorld(true);

    const shadowCamera = this.state.keyLight.shadow.camera;
    const half = Math.max(20, span * 0.78);
    shadowCamera.left = -half;
    shadowCamera.right = half;
    shadowCamera.top = half;
    shadowCamera.bottom = -half;
    shadowCamera.near = 0.5;
    shadowCamera.far = Math.max(180, model.maxHeight + span * 2.6);
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
    const radius = Math.max(model.width, model.depth) * 0.95;
    const height = Math.max(16, model.maxHeight + 15);
    this.state.camera.position.set(centerX + radius, height, centerZ + radius * 0.86);
    this.state.controls.target.set(centerX, 0.5, centerZ);
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
