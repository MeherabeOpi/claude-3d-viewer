import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { USDZLoader } from "three/examples/jsm/loaders/USDZLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { extensionOf, isModelFile } from "./formats";

export type LoadResult = {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Total bytes of every file that went into the model, when known. */
  bytes: number;
};

export type ProgressHandler = (ratio: number, note: string) => void;

const DEFAULT_MATERIAL = () =>
  new THREE.MeshStandardMaterial({
    color: 0xb9c0cc,
    metalness: 0.15,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

export function proxied(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

/** Wraps a bundle of local files so relative references inside a model resolve. */
function makeFileManager(files: File[]) {
  const objectUrls: string[] = [];
  const byName = new Map<string, File>();

  for (const file of files) {
    const withPath = file as File & { webkitRelativePath?: string };
    const relative = (withPath.webkitRelativePath || file.name).toLowerCase();
    byName.set(relative, file);
    byName.set(file.name.toLowerCase(), file);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    const normalized = decodeURIComponent(url.split(/[?#]/)[0]).toLowerCase();
    const candidates = [
      normalized,
      normalized.replace(/^\.\//, ""),
      normalized.split("/").pop() ?? normalized,
    ];
    for (const candidate of candidates) {
      const match = byName.get(candidate);
      if (match) {
        const objectUrl = URL.createObjectURL(match);
        objectUrls.push(objectUrl);
        return objectUrl;
      }
    }
    return url;
  });

  const dispose = () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
  return { manager, dispose };
}

function configureGltf(
  loader: GLTFLoader,
  renderer: THREE.WebGLRenderer | null,
  manager: THREE.LoadingManager,
) {
  const draco = new DRACOLoader(manager).setDecoderPath("/draco/");
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (renderer) {
    const ktx2 = new KTX2Loader(manager)
      .setTranscoderPath("/basis/")
      .detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }
  return loader;
}

async function parseByExtension(opts: {
  ext: string;
  url: string;
  manager: THREE.LoadingManager;
  renderer: THREE.WebGLRenderer | null;
  mtlUrl?: string;
  onProgress?: ProgressHandler;
}): Promise<{ object: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const { ext, url, manager, renderer, mtlUrl, onProgress } = opts;
  const progress = (event: ProgressEvent) => {
    if (!onProgress) return;
    const ratio =
      event.lengthComputable && event.total > 0 ? event.loaded / event.total : 0;
    onProgress(ratio, "Downloading");
  };

  switch (ext) {
    case "glb":
    case "gltf": {
      const loader = configureGltf(new GLTFLoader(manager), renderer, manager);
      const gltf = await loader.loadAsync(url, progress);
      return { object: gltf.scene, animations: gltf.animations ?? [] };
    }
    case "fbx": {
      const object = await new FBXLoader(manager).loadAsync(url, progress);
      return { object, animations: object.animations ?? [] };
    }
    case "obj": {
      const loader = new OBJLoader(manager);
      if (mtlUrl) {
        try {
          const materials = await new MTLLoader(manager).loadAsync(mtlUrl);
          materials.preload();
          loader.setMaterials(materials);
        } catch {
          // A missing or broken .mtl must not stop the geometry from showing.
        }
      }
      const object = await loader.loadAsync(url, progress);
      return { object, animations: [] };
    }
    case "stl": {
      const geometry = await new STLLoader(manager).loadAsync(url, progress);
      geometry.computeVertexNormals();
      return {
        object: new THREE.Mesh(geometry, DEFAULT_MATERIAL()),
        animations: [],
      };
    }
    case "ply": {
      const geometry = await new PLYLoader(manager).loadAsync(url, progress);
      geometry.computeVertexNormals();
      const material = DEFAULT_MATERIAL();
      if (geometry.hasAttribute("color")) {
        material.vertexColors = true;
        material.color.set(0xffffff);
      }
      return { object: new THREE.Mesh(geometry, material), animations: [] };
    }
    case "dae": {
      const collada = await new ColladaLoader(manager).loadAsync(url, progress);
      if (!collada?.scene) throw new Error("That COLLADA file has no scene.");
      return { object: collada.scene, animations: collada.scene.animations ?? [] };
    }
    case "3mf": {
      const object = await new ThreeMFLoader(manager).loadAsync(url, progress);
      return { object, animations: [] };
    }
    case "usdz": {
      const object = await new USDZLoader(manager).loadAsync(url, progress);
      return { object, animations: [] };
    }
    default:
      throw new Error(`Unsupported file type ".${ext}".`);
  }
}

/** Loads a model from a set of files the visitor dropped or picked. */
export async function loadFromFiles(
  files: File[],
  renderer: THREE.WebGLRenderer | null,
  onProgress?: ProgressHandler,
): Promise<LoadResult> {
  const root = files.find((f) => isModelFile(f.name));
  if (!root) {
    throw new Error(
      "No model file in that selection. Supported: .glb, .gltf, .obj, .fbx, .stl, .ply, .dae, .3mf, .usdz",
    );
  }

  const { manager, dispose } = makeFileManager(files);
  const rootUrl = URL.createObjectURL(root);
  const mtl = files.find((f) => extensionOf(f.name) === "mtl");
  const mtlUrl = mtl ? URL.createObjectURL(mtl) : undefined;

  try {
    const { object, animations } = await parseByExtension({
      ext: extensionOf(root.name),
      url: rootUrl,
      manager,
      renderer,
      mtlUrl,
      onProgress,
    });
    const bytes = files.reduce((total, f) => total + f.size, 0);
    return { object, animations, bytes };
  } finally {
    URL.revokeObjectURL(rootUrl);
    if (mtlUrl) URL.revokeObjectURL(mtlUrl);
    dispose();
  }
}

/**
 * Loads a model from a remote URL. Tries the origin directly first and falls
 * back to our same-origin proxy when the host sends no CORS headers.
 */
export async function loadFromUrl(
  url: string,
  renderer: THREE.WebGLRenderer | null,
  onProgress?: ProgressHandler,
): Promise<LoadResult> {
  const ext = extensionOf(url);
  if (!isModelFile(url)) {
    throw new Error(
      `That link does not end in a supported model extension (got ".${ext || "?"}").`,
    );
  }

  const attempt = async (viaProxy: boolean) => {
    const manager = new THREE.LoadingManager();
    if (viaProxy) {
      manager.setURLModifier((requested) => {
        if (requested.startsWith("data:") || requested.startsWith("blob:")) {
          return requested;
        }
        if (requested.startsWith("/draco/") || requested.startsWith("/basis/")) {
          return requested;
        }
        if (requested.startsWith(window.location.origin)) return requested;
        return proxied(requested);
      });
    }
    return parseByExtension({
      ext,
      url,
      manager,
      renderer,
      mtlUrl: ext === "obj" ? url.replace(/\.obj(\?|#|$)/i, ".mtl$1") : undefined,
      onProgress,
    });
  };

  let result: { object: THREE.Object3D; animations: THREE.AnimationClip[] };
  try {
    result = await attempt(false);
  } catch {
    onProgress?.(0, "Retrying through proxy");
    result = await attempt(true);
  }

  return { ...result, bytes: await probeSize(url) };
}

/**
 * Reports a remote model's size. Edge networks compress responses and drop
 * `content-length`, so ask for a single byte and read the total back out of
 * `content-range`, falling back to a plain HEAD.
 */
async function probeSize(url: string): Promise<number> {
  // Same-origin models are fetched directly; the proxy only takes absolute
  // remote URLs and would answer a relative path with a 400 whose body length
  // would then be reported as the model size.
  const sameOrigin =
    url.startsWith("/") ||
    (typeof window !== "undefined" && url.startsWith(window.location.origin));
  const target = sameOrigin ? url : proxied(url);

  try {
    const ranged = await fetch(target, { headers: { Range: "bytes=0-0" } });
    if (ranged.ok || ranged.status === 206) {
      const total = ranged.headers.get("content-range")?.split("/")[1];
      if (total && Number(total) > 0) return Number(total);
    }

    const head = await fetch(target, { method: "HEAD" });
    if (!head.ok) return 0;
    return Number(head.headers.get("content-length") ?? 0);
  } catch {
    return 0;
  }
}
