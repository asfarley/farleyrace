import * as THREE from "three";
import { createRng } from "game/rng";
import { bigTreeTemplates, createTree } from "game/tree_models";

// Large trackside trees just off the shoulder, tall enough that cars and the
// chase camera pass under the canopy. Placement (and every other rng draw)
// happens synchronously so all players derive the same forest from the seed;
// the GLB models fill the placements in whenever they finish loading.
const TREE_COUNT = 26;

export function addTrackTrees(scene, track, terrain, seed) {
  const rng = createRng(seed ^ 0x774ee5a1);
  const group = new THREE.Group();
  group.name = "track-trees";

  const spots = [];
  const stride = Math.floor(track.count / TREE_COUNT);
  for (let i = 0; i < TREE_COUNT; i++) {
    const idx = (i * stride + Math.floor(rng() * stride * 0.6)) % track.count;
    // Keep the start/finish straight and its banner clear.
    if (idx < 14 || idx > track.count - 14) continue;

    const s = track.samples[idx];
    const side = rng() < 0.5 ? -1 : 1;
    const px = -s.dirZ * side, pz = s.dirX * side; // outward from the centerline
    const dist = track.width / 2 + 4.5 + rng() * 3;
    const x = s.x + px * dist;
    const z = s.z + pz * dist;
    spots.push({
      x, y: terrain.heightAt(x, z), z,
      variant: rng(),
      height: 12 + rng() * 5,
      yaw: rng() * Math.PI * 2
    });
  }

  bigTreeTemplates().then((templates) => {
    for (const spot of spots) {
      const tree = createTree(templates[Math.floor(spot.variant * templates.length)], spot.height, true);
      tree.position.set(spot.x, spot.y, spot.z);
      tree.rotation.y = spot.yaw;
      group.add(tree);
    }
  }).catch(() => {
    // Model fetch failed (offline?) — fall back to the procedural trees.
    const fallbackRng = createRng(seed ^ 0x3c6ef372);
    for (const spot of spots) {
      const tree = buildBigTree(fallbackRng, spot.height);
      tree.position.set(spot.x, spot.y, spot.z);
      tree.rotation.y = spot.yaw;
      group.add(tree);
    }
  });

  scene.add(group);
  return group;
}

// Procedural fallback tree: tapered trunk, angled limbs, leaf blobs. Only
// used when the GLB models can't be fetched.
const CANOPY_CLEARANCE = 6.5;
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4028 });
const leafMats = [
  new THREE.MeshLambertMaterial({ color: 0x2d6b2f }),
  new THREE.MeshLambertMaterial({ color: 0x3d7d33 }),
  new THREE.MeshLambertMaterial({ color: 0x4f8f3b })
];

export function buildBigTree(rng, height = 11 + rng() * 5) {
  const tree = new THREE.Group();
  const trunkR = 0.5 + rng() * 0.25;

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.55, trunkR, height, 7), trunkMat);
  trunk.position.y = height / 2;
  trunk.castShadow = true;
  tree.add(trunk);

  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const addLeaves = (x, y, z, r) => {
    const leaves = new THREE.Mesh(leafGeo, leafMats[Math.floor(rng() * leafMats.length)]);
    leaves.position.set(x, y, z);
    leaves.scale.set(r, r * (0.65 + rng() * 0.2), r);
    leaves.rotation.y = rng() * Math.PI;
    leaves.castShadow = true;
    tree.add(leaves);
  };

  const limbs = 4 + Math.floor(rng() * 3);
  for (let l = 0; l < limbs; l++) {
    const yaw = (l / limbs) * Math.PI * 2 + rng() * 0.8;
    const len = 3.5 + rng() * 2.5;
    const tilt = 0.5 + rng() * 0.5; // from vertical
    const baseY = CANOPY_CLEARANCE + rng() * (height - CANOPY_CLEARANCE - 1);

    const limbR = 0.16 + len * 0.022;
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(limbR * 0.6, limbR, len, 5), trunkMat);
    limb.castShadow = true;
    // Cylinder is y-aligned; pivot it from its base at the trunk.
    limb.position.y = len / 2;
    const pivot = new THREE.Group();
    pivot.position.y = baseY;
    pivot.rotation.y = yaw;
    pivot.rotation.z = -tilt;
    pivot.add(limb);
    tree.add(pivot);

    // Leaf clusters at the limb tip (world-ish coords via the pivot's angles).
    const tipX = Math.cos(yaw) * Math.sin(tilt) * len;
    const tipZ = -Math.sin(yaw) * Math.sin(tilt) * len;
    const tipY = baseY + Math.cos(tilt) * len;
    for (let b = 0; b < 2; b++) {
      const f = 1 - b * 0.28;
      addLeaves(tipX * f + (rng() - 0.5) * 1.5,
                tipY - (1 - f) * 1.2 + (rng() - 0.5),
                tipZ * f + (rng() - 0.5) * 1.5,
                2.1 * (0.75 + rng() * 0.4));
    }
  }

  // Crown on top of the trunk.
  addLeaves((rng() - 0.5) * 1.5, height + 0.5, (rng() - 0.5) * 1.5, 2.8 + rng() * 0.8);
  return tree;
}
