import * as THREE from "three";
import { GLTFLoader } from "GLTFLoader";

// Kenney Car Kit (kenney.nl, CC0) vehicles. Each player is assigned a model
// by player id, so every client picks the same car for the same player. The
// kit shares one texture atlas across the whole car, so per-player identity
// comes from the model itself (plus the color swatch in the UI) rather than
// a body tint.
export const CAR_MODELS = [
  "race", "sedan-sports", "hatchback-sports", "police",
  "taxi", "race-future", "suv", "van"
];

export function modelForPlayer(playerId) {
  return CAR_MODELS[Math.abs(playerId) % CAR_MODELS.length];
}

const TARGET_LENGTH = 4.3; // match the physics car's footprint (m)

const loader = new GLTFLoader();
const templates = new Map();

function loadTemplate(name) {
  if (!templates.has(name)) {
    templates.set(name, loader.loadAsync(`/models/cars/${name}.glb`).then((gltf) => gltf.scene));
  }
  return templates.get(name);
}

// Populates `car` with the named Kenney model: scaled to the physics
// footprint, sitting on y=0, shadows on, and wheels rigged into
// car.userData.wheels ({front: steering pivots, all: spinning meshes,
// radius}) — the same contract the primitive car exposes.
export function attachCarModel(car, name) {
  return loadTemplate(name).then((template) => {
    const model = template.clone(true);

    const wheels = { front: [], all: [] };
    const wheelNodes = [];
    model.traverse((node) => {
      if (node.isMesh) { node.castShadow = true; }
      if (/^wheel/.test(node.name)) wheelNodes.push(node);
    });
    for (const node of wheelNodes) {
      // Give each front wheel a pivot so steering (pivot yaw) and rolling
      // (wheel x-spin) compose cleanly.
      if (/front/.test(node.name)) {
        const pivot = new THREE.Group();
        pivot.position.copy(node.position);
        node.position.set(0, 0, 0);
        node.parent.add(pivot);
        pivot.add(node);
        wheels.front.push(pivot);
      }
      wheels.all.push(node);
    }

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = TARGET_LENGTH / size.z;
    model.scale.setScalar(scale);
    box.setFromObject(model);
    model.position.y -= box.min.y;

    // Wheel spin rate depends on the real rolling radius.
    wheels.radius = (wheelNodes[0]?.position.y ?? 0.3) * scale || 0.42;

    car.add(model);
    car.userData.wheels = wheels;
    return car;
  });
}
