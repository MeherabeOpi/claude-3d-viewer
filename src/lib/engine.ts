import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { disposeObject, normalize } from "./inspect";

export type BackdropName = "studio" | "dusk" | "light" | "void";

export const BACKDROPS: Record<BackdropName, { label: string; top: string; bottom: string; grid: number }> = {
  studio: { label: "Studio", top: "#26303f", bottom: "#0b0e14", grid: 0x3b4655 },
  dusk: { label: "Dusk", top: "#3c2a4d", bottom: "#100a16", grid: 0x4d3c60 },
  light: { label: "Light", top: "#f4f6fa", bottom: "#d5dae4", grid: 0x9aa4b4 },
  void: { label: "Void", top: "#000000", bottom: "#000000", grid: 0x2a2a2a },
};

type ReadyModel = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  actions: THREE.AnimationAction[];
  radius: number;
  floorY: number;
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly grid: THREE.GridHelper;
  private readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;

  private model: ReadyModel | null = null;
  private frame = 0;
  private wireframe = false;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(3, 2, 4);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLight.position.set(4, 7, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0008;
    this.keyLight.shadow.normalBias = 0.02;
    const shadowCamera = this.keyLight.shadow.camera;
    shadowCamera.near = 0.1;
    shadowCamera.far = 40;
    shadowCamera.left = -5;
    shadowCamera.right = 5;
    shadowCamera.top = 5;
    shadowCamera.bottom = -5;
    this.scene.add(this.keyLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const rim = new THREE.DirectionalLight(0x93b6ff, 0.8);
    rim.position.set(-5, 2, -4);
    this.scene.add(rim);

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.visible = false;
    this.scene.add(this.shadowCatcher);

    this.grid = new THREE.GridHelper(20, 40, 0x4a5568, 0x39414f);
    this.grid.visible = false;
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.5;
    this.scene.add(this.grid);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.85;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 200;
    this.controls.autoRotateSpeed = 1.6;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const tick = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(tick);
      const delta = this.clock.getDelta();
      this.model?.mixer?.update(delta);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private resize() {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  setModel(object: THREE.Object3D, animations: THREE.AnimationClip[]) {
    this.clearModel();

    const root = new THREE.Group();
    root.add(object);
    normalize(object, 2);

    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });

    this.scene.add(root);

    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const floorY = box.isEmpty() ? -1 : box.min.y;

    this.shadowCatcher.position.y = floorY - 0.001;
    this.grid.position.y = floorY - 0.001;

    let mixer: THREE.AnimationMixer | null = null;
    const actions: THREE.AnimationAction[] = [];
    if (animations.length > 0) {
      mixer = new THREE.AnimationMixer(object);
      for (const clip of animations) actions.push(mixer.clipAction(clip));
    }

    this.model = { root, mixer, actions, radius: sphere.radius || 1, floorY };
    this.applyWireframe();
    this.resetView();
    return this.model.actions.length;
  }

  private clearModel() {
    if (!this.model) return;
    this.model.mixer?.stopAllAction();
    this.scene.remove(this.model.root);
    disposeObject(this.model.root);
    this.model = null;
  }

  resetView() {
    const radius = this.model?.radius ?? 1.5;
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(fov / 2)) * 1.25;
    this.camera.position.set(distance * 0.55, distance * 0.42, distance * 0.78);
    this.camera.near = Math.max(distance / 500, 0.01);
    this.camera.far = distance * 40;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setView(axis: "front" | "back" | "left" | "right" | "top" | "bottom") {
    const radius = this.model?.radius ?? 1.5;
    const fov = (this.camera.fov * Math.PI) / 180;
    const d = (radius / Math.sin(fov / 2)) * 1.2;
    const positions: Record<string, [number, number, number]> = {
      front: [0, 0, d],
      back: [0, 0, -d],
      left: [-d, 0, 0],
      right: [d, 0, 0],
      top: [0, d, 0.0001],
      bottom: [0, -d, 0.0001],
    };
    this.camera.position.set(...positions[axis]);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }

  setGrid(on: boolean) {
    this.grid.visible = on;
  }

  setShadow(on: boolean) {
    this.shadowCatcher.visible = on;
  }

  setExposure(value: number) {
    this.renderer.toneMappingExposure = value;
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    this.applyWireframe();
  }

  private applyWireframe() {
    this.model?.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        const target = material as THREE.MeshStandardMaterial;
        if (target && "wireframe" in target) target.wireframe = this.wireframe;
      }
    });
  }

  setBackdrop(name: BackdropName) {
    const grid = BACKDROPS[name].grid;
    const materials = Array.isArray(this.grid.material)
      ? this.grid.material
      : [this.grid.material];
    for (const material of materials) {
      (material as THREE.MeshBasicMaterial).color?.setHex(grid);
    }
    this.shadowCatcher.material.opacity = name === "light" ? 0.22 : 0.35;
  }

  playClip(index: number | null) {
    if (!this.model?.mixer) return;
    for (const action of this.model.actions) action.stop();
    if (index === null) return;
    const action = this.model.actions[index];
    if (action) action.reset().play();
  }

  setTimeScale(scale: number) {
    if (this.model?.mixer) this.model.mixer.timeScale = scale;
  }

  /** Renders one frame at higher resolution and returns it as a PNG data URL. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
