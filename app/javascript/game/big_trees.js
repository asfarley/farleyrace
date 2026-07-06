import * as THREE from "three";
import { createRng } from "game/rng";

// Large trackside trees: a tapered trunk with angled branch limbs, each limb
// tipped with leaf clusters. Trees stand just off the shoulder and their
// track-side limb is extra long and low-angled, so the canopy overhangs the
// road. Everything is seeded, so all players see the same forest.
const TREE_COUNT = 26;
const CANOPY_CLEARANCE = 6.5; // limbs start above this height — cars and the chase camera pass under

const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4028 });
const leafMats = [
  new THREE.MeshLambertMaterial({ color: 0x2d6b2f }),
  new THREE.MeshLambertMaterial({ color: 0x3d7d33 }),
  new THREE.MeshLambertMaterial({ color: 0x4f8f3b })
];

export function addTrackTrees(scene, track, terrain, seed) {
  const rng = createRng(seed ^ 0x774ee5a1);
  const group = new THREE.Group();
  group.name = "track-trees";

  const stride = Math.floor(track.count / TREE_COUNT);
  for (let i = 0; i < TREE_COUNT; i++) {
    let idx = (i * stride + Math.floor(rng() * stride * 0.6)) % track.count;
    // Keep the start/finish straight and its banner clear.
    if (idx < 14 || idx > track.count - 14) continue;

    const s = track.samples[idx];
    const side = rng() < 0.5 ? -1 : 1;
    const px = -s.dirZ * side, pz = s.dirX * side; // outward from the centerline
    const dist = track.width / 2 + 3.5 + rng() * 3;
    const x = s.x + px * dist;
    const z = s.z + pz * dist;

    const tree = buildBigTree(rng);
    tree.position.set(x, terrain.heightAt(x, z), z);
    // The tree's local +x is its "long limb" side; aim it back at the track:
    // Ry maps +x to (cos ry, 0, -sin ry), which must equal (-px, -pz).
    tree.rotation.y = Math.atan2(pz, -px);
    group.add(tree);
  }

  scene.add(group);
  return group;
}

// One tree: trunk, 4-6 limbs (the +x limb reaches furthest), leaf blobs on
// every limb tip plus a crown. ~500 tris each.
export function buildBigTree(rng) {
  const tree = new THREE.Group();
  const height = 11 + rng() * 5;
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
    // Limb 0 points along local +x (the track side) and reaches further and
    // flatter than the rest — that's the overhang.
    const overhanging = l === 0;
    const yaw = overhanging ? 0 : (l / limbs) * Math.PI * 2 + rng() * 0.8;
    const len = overhanging ? 7 + rng() * 3 : 3.5 + rng() * 2.5;
    const tilt = overhanging ? 1.15 + rng() * 0.2 : 0.5 + rng() * 0.5; // from vertical
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
    const blobs = overhanging ? 3 : 2;
    for (let b = 0; b < blobs; b++) {
      const f = 1 - b * 0.28;
      addLeaves(tipX * f + (rng() - 0.5) * 1.5,
                tipY - (1 - f) * 1.2 + (rng() - 0.5),
                tipZ * f + (rng() - 0.5) * 1.5,
                (overhanging ? 2.6 : 2.1) * (0.75 + rng() * 0.4));
    }
  }

  // Crown on top of the trunk.
  addLeaves((rng() - 0.5) * 1.5, height + 0.5, (rng() - 0.5) * 1.5, 2.8 + rng() * 0.8);
  return tree;
}
