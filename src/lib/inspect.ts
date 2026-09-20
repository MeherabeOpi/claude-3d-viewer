import * as THREE from "three";

export type ModelStats = {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  size: { x: number; y: number; z: number };
};

/** Walks the loaded object once and gathers everything the info panel shows. */
export function inspect(object: THREE.Object3D): ModelStats {
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const materials = new Set<string>();
  const textures = new Set<string>();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute("position");
    if (position) vertices += position.count;

    if (geometry.index) {
      triangles += geometry.index.count / 3;
    } else if (position) {
      triangles += position.count / 3;
    }

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material.uuid);
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null;
        if (texture && (texture as THREE.Texture).isTexture) {
          textures.add(texture.uuid);
        }
      }
    }
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());

  return {
    meshes,
    vertices,
    triangles: Math.round(triangles),
    materials: materials.size,
    textures: textures.size,
    size: { x: size.x, y: size.y, z: size.z },
  };
}

/**
 * Recenters the model on the origin and scales it into a predictable box so
 * that a 2 mm dental crown and a 40 m building both frame the same way.
 */
export function normalize(object: THREE.Object3D, targetSize = 2): number {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 1;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / longest;

  object.position.sub(center);
  object.updateMatrixWorld(true);

  const wrapper = object;
  wrapper.scale.setScalar(scale);
  wrapper.position.multiplyScalar(scale);
  wrapper.updateMatrixWorld(true);

  return scale;
}

/** Frees GPU memory held by a model that is being replaced. */
export function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null;
        if (texture && (texture as THREE.Texture).isTexture) texture.dispose();
      }
      material.dispose();
    }
  });
}
