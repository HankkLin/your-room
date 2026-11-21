import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import decoderJs from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import decoderWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import { glbUrl } from './src/shopify/product-assets.js';
import { ASSET_REPRESENTATION_TIERS } from './src/spatial/product-scene-object.js';
import { classifyFurnitureArchetype, FURNITURE_ARCHETYPES } from './src/spatial/furniture-archetypes.js';

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
  const draco = new DRACOLoader().setDecoderPath({ js: decoderJs, wasm: decoderWasm });
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const models = new Map();
  let disposed = false;

  async function load(key, url, merchant = false) {
    // A pending or failed URL keeps the generic preview and avoids re-fetching on every render.
    models.set(key, null);
    let root;
    try {
      root = (await loader.loadAsync(url)).scene;
    } catch (error) {
      console.warn('Could not load furniture model.', error);
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
      if (!object.isMesh || (!merchant && object.name === 'SheenChair_label')) return;
      bounds.union(meshBounds.setFromObject(object, true));
    });
    const origin = bounds.getCenter(new THREE.Vector3());
    origin.y = bounds.min.y;
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || !size.toArray().every((axis) => Number.isFinite(axis) && axis > 0)) {
      disposeTemplate(root);
      return;
    }
    models.set(key, { root, origin, size, merchant });
    onReady?.(key);
  }

  for (const [kind, file] of Object.entries(modelFiles)) {
    void load(kind, `${import.meta.env?.BASE_URL ?? '/'}assets/${file}`);
  }

  return {
    hasFailedModelUrl(url) {
      return Boolean(url && models.has(url) && models.get(url) === null);
    },
    create(item) {
      const url = glbUrl(item.modelUrl);
      if (url && !models.has(url)) void load(url, url, true);
      const verifiedModel = url ? models.get(url) : null;
      const archetype = classifyFurnitureArchetype(item, item.kind);
      const repKey =
        archetype === FURNITURE_ARCHETYPES.SOFA
          ? 'sofa'
          : archetype === FURNITURE_ARCHETYPES.ARMCHAIR
            ? 'chair'
            : null;
      const representativeModel = repKey ? models.get(repKey) : null;
      const model = verifiedModel || representativeModel;
      if (!model) return null;

      const w = Math.max(0.07, Number(item.width) || 0.6);
      const d = Math.max(0.07, Number(item.depth) || 0.6);
      const h = Math.max(0.008, Number(item.height) || 0.75);
      const color = new THREE.Color(item.color || '#c8b99e');
      const clone = model.root.clone(true);
      if (!model.merchant) clone.getObjectByName('SheenChair_label')?.removeFromParent();
      const copyMaterial = (material) => model.merchant ? material.clone() : cloneMaterial(material, item.kind, color);
      clone.position.sub(model.origin);
      clone.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry = object.geometry.clone();
        object.material = Array.isArray(object.material)
          ? object.material.map(copyMaterial)
          : copyMaterial(object.material);
        object.castShadow = object.name !== 'Fringe';
        object.receiveShadow = true;
      });

      const fit = new THREE.Group();
      fit.scale.set(w / model.size.x, h / model.size.y, d / model.size.z);
      if (model.merchant) fit.scale.setScalar(Math.min(fit.scale.x, fit.scale.y, fit.scale.z));
      fit.add(clone);

      const group = new THREE.Group();
      group.add(fit);
      if (model.merchant) group.userData.modelUrl = url;
      group.userData.assetRepresentation = model.merchant
        ? ASSET_REPRESENTATION_TIERS.VERIFIED_3D_ASSET
        : ASSET_REPRESENTATION_TIERS.REPRESENTATIVE_3D_ASSET;
      group.userData.dimensionSource = item.dimensionSource || item.dimensionsSource || 'estimated';
      group.userData.itemId = item.id;
      group.userData.locked = Boolean(item.locked || item.type === 'fixed');
      group.userData.dimensions = { w, d, h };
      return group;
    },
    dispose() {
      disposed = true;
      draco.dispose();
      for (const model of models.values()) if (model) disposeTemplate(model.root);
      models.clear();
    },
  };
}
