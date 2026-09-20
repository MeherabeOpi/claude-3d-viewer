import type * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { upload } from "@vercel/blob/client";
import { extensionOf, isModelFile } from "./formats";

export type Packed = {
  blob: Blob;
  filename: string;
  /** True when the model was re-encoded to glTF rather than sent as-is. */
  reencoded: boolean;
};

/**
 * Produces a single self-contained file to share.
 *
 * A model the visitor opened locally may be several files (a .gltf beside its
 * .bin and textures, an .obj beside its .mtl), and formats like .fbx or .stl
 * are not something every browser can open. Exporting the loaded scene to a
 * binary glTF collapses all of that into one file with its textures embedded,
 * so the recipient fetches exactly one URL.
 */
export async function packForSharing(
  files: File[] | null,
  object: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<Packed> {
  // A lone .glb is already one self-contained file. Re-exporting it would only
  // throw away whatever compression it arrived with (Draco, Meshopt, KTX2).
  if (files && files.length === 1 && extensionOf(files[0].name) === "glb") {
    return { blob: files[0], filename: files[0].name, reencoded: false };
  }

  const exporter = new GLTFExporter();
  const parsed = await exporter.parseAsync(object, {
    binary: true,
    onlyVisible: false,
    animations,
  });

  if (!(parsed instanceof ArrayBuffer)) {
    throw new Error("Could not package that model for sharing.");
  }

  const root = files?.find((f) => isModelFile(f.name)) ?? files?.[0];
  const base = (root?.name ?? "model").replace(/\.[^.]+$/, "");
  return {
    blob: new Blob([parsed], { type: "model/gltf-binary" }),
    filename: `${base || "model"}.glb`,
    reencoded: true,
  };
}

/** Uploads a packed model and returns its public URL. */
export async function uploadModel(
  packed: Packed,
  onProgress: (percentage: number) => void,
): Promise<string> {
  const safe =
    packed.filename
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-80) || "model.glb";

  const result = await upload(`models/${safe}`, packed.blob, {
    access: "public",
    handleUploadUrl: "/api/upload",
    contentType: "model/gltf-binary",
    onUploadProgress: ({ percentage }) => onProgress(percentage),
  });

  return result.url;
}
