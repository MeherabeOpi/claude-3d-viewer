export type Format =
  | "gltf"
  | "glb"
  | "obj"
  | "fbx"
  | "stl"
  | "ply"
  | "dae"
  | "3mf"
  | "usdz"
  | "3dm";

/** Extensions we can actually parse into a scene. */
export const MODEL_EXTENSIONS: Format[] = [
  "glb",
  "gltf",
  "obj",
  "fbx",
  "stl",
  "ply",
  "dae",
  "3mf",
  "usdz",
];

/** Companion files that are not models themselves but are needed by one. */
export const SIDECAR_EXTENSIONS = [
  "bin",
  "mtl",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "ktx2",
  "hdr",
  "tga",
  "bmp",
];

export const ACCEPT_ATTRIBUTE = [...MODEL_EXTENSIONS, ...SIDECAR_EXTENSIONS]
  .map((e) => `.${e}`)
  .join(",");

export function extensionOf(nameOrUrl: string): string {
  const clean = nameOrUrl.split(/[?#]/)[0];
  const last = clean.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot === -1 ? "" : last.slice(dot + 1).toLowerCase();
}

export function isModelFile(nameOrUrl: string): boolean {
  return (MODEL_EXTENSIONS as string[]).includes(extensionOf(nameOrUrl));
}

export function baseName(nameOrUrl: string): string {
  const clean = nameOrUrl.split(/[?#]/)[0];
  return decodeURIComponent(clean.split("/").pop() ?? clean);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
