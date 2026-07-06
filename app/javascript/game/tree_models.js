import * as THREE from "three";
import { GLTFLoader } from "GLTFLoader";

// Quaternius tree models (quaternius.com, CC0) from public/models/trees/.
// A GLB may hold several tree variants side by side; each variant becomes a
// template group standing on y=0, centered at the origin, with its natural
// height in userData.height. Templates are cloned per placement — clones
// share geometry and materials, so many trees cost only draw calls.
const loader = new GLTFLoader();
const packs = new Map();

function loadPack(file) {
  if (!packs.has(file)) {
    packs.set(file, loader.loadAsync(`/models/trees/${file}.glb`).then((gltf) => {
      // Structure is scene > RootNode > one node per tree variant.
      const root = gltf.scene.children[0] ?? gltf.scene;
      const variants = root.children.length ? [...root.children] : [root];
      return variants.map(normalizeVariant);
    }));
  }
  return packs.get(file);
}

function normalizeVariant(node) {
  node.traverse((child) => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      // Foliage ships as alpha-blended; switch to alpha-tested so leaves
      // depth-sort correctly against each other and the terrain.
      if (mat.transparent) {
        mat.transparent = false;
        mat.alphaTest = 0.5;
        mat.depthWrite = true;
      }
    }
  });

  const template = new THREE.Group();
  template.add(node);
  const box = new THREE.Box3().setFromObject(template);
  const center = box.getCenter(new THREE.Vector3());
  node.position.x -= center.x;
  node.position.z -= center.z;
  node.position.y -= box.min.y;
  template.userData.height = box.max.y - box.min.y;
  return template;
}

// Big textured trees for the trackside forest (5 variants, ~2-9k tris each).
export function bigTreeTemplates() {
  return loadPack("forest-trees");
}

// Cheaper mix for the 140 background trees: a textured pine plus flat-shaded
// deciduous variants (~2-3k tris each).
export function scatterTreeTemplates() {
  return Promise.all([
    loadPack("pine"),
    loadPack("common-tree-a"),
    loadPack("common-tree-b"),
    loadPack("autumn-tree")
  ]).then((lists) => lists.flat());
}

// Clone a template scaled to the given height (m). Shadows are opt-in — only
// trackside trees cast them.
export function createTree(template, height, castShadow = false) {
  const tree = template.clone(true);
  tree.scale.setScalar(height / template.userData.height);
  if (castShadow) {
    tree.traverse((node) => { if (node.isMesh) node.castShadow = true; });
  }
  return tree;
}
