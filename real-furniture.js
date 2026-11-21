import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const modelFiles = {
  sofa: 'SheenWoodLeatherSofa.glb',
  chair: 'SheenChair.glb',
};

const sofaFabric = new Set(['Brown', 'Paisley', 'Striped', 'Frame_Fabric']);

function cloneMaterial(material, kind, tint) {
  const clone = material.clone();
  const isUpholstery = kind === 'chair' ? material.name.startsWith('fabric ') : sofaFabric.has(material.name);
  if (isUpholstery) {
    clone.color.copy(tint);
    // The sofa's original color maps contain printed patterns. Keep the texture detail in the normal maps.
    if (kind === 'sofa') clone.map = null;
    clone.normalScale.multiplyScalar(kind === 'sofa' ? 0.4 : 0.8);
    clone.sheenColor?.copy(tint).multiplyScalar(0.3);
  }
  return clone;
}

function disposeTemplate(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const images = new Set();

  root.traverse((object) => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (!value?.isTexture) continue;
        textures.add(value);
        images.add(value.source?.data);
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  for (const data of images) data?.close?.();
}

export function createFurnitureAssets(onReady) {
  const loader = new GLTFLoader();
  const models = new Map();
  let disposed = false;

  async function load(kind, file) {
    let root;
    try {
      const assetUrl = `${import.meta.env?.BASE_URL ?? '/'}assets/${file}`;
      root = (await loader.loadAsync(assetUrl)).scene;
    } catch (error) {
      console.warn(`Could not load the detailed ${kind} model.`, error);
      return;
    }

    if (disposed) {
      disposeTemplate(root);
      return;
    }

    // Both source models are Y-up and face +Z. Exclude the chair's material-example label.
    const bounds = new THREE.Box3();
    const meshBounds = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!object.isMesh || object.name === 'SheenChair_label') return;
      bounds.union(meshBounds.setFromObject(object, true));
    });
    const origin = bounds.getCenter(new THREE.Vector3());
    origin.y = bounds.min.y;
    models.set(kind, { root, origin, size: bounds.getSize(new THREE.Vector3()) });
    onReady?.(kind);
  }

  for (const [kind, file] of Object.entries(modelFiles)) void load(kind, file);

  return {
    create(item) {
      const model = models.get(item.kind);
      if (!model) return null;

      const w = Math.max(0.07, Number(item.width) || 0.6);
      const d = Math.max(0.07, Number(item.depth) || 0.6);
      const h = Math.max(0.008, Number(item.height) || 0.75);
      const color = new THREE.Color(item.color || '#c8b99e');
      const clone = model.root.clone(true);
      clone.getObjectByName('SheenChair_label')?.removeFromParent();
      clone.position.sub(model.origin);
      clone.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry = object.geometry.clone();
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => cloneMaterial(material, item.kind, color))
          : cloneMaterial(object.material, item.kind, color);
        object.castShadow = object.name !== 'Fringe';
        object.receiveShadow = true;
      });

      const fit = new THREE.Group();
      fit.scale.set(w / model.size.x, h / model.size.y, d / model.size.z);
      fit.add(clone);

      const group = new THREE.Group();
      group.add(fit);
      group.userData.itemId = item.id;
      group.userData.locked = Boolean(item.locked || item.type === 'fixed');
      group.userData.dimensions = { w, d, h };
      return group;
    },
    dispose() {
      disposed = true;
      for (const { root } of models.values()) disposeTemplate(root);
      models.clear();
    },
  };
}
