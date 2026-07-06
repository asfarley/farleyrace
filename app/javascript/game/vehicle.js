import * as THREE from "three";
import { attachCarModel } from "game/car_models";

// Arcade-grounded car physics on a heightfield. The car is simulated in the
// ground plane (x, z, heading) with proper inertia: velocity is a free 2D
// vector, and tires apply limited lateral force to pull it toward the car's
// facing — exceed the grip budget and the car slides. Gravity acts along the
// terrain slope, so hills load and unload the car.
const PARAMS = {
  engineForce: 6200,      // N at full throttle
  brakeForce: 9800,       // N
  reverseForce: 3200,     // N
  mass: 1150,             // kg
  dragCoeff: 1.8,         // quadratic aero drag
  rollingResist: 55,      // linear rolling resistance
  maxSteer: 0.62,         // rad, at standstill
  wheelbase: 2.7,         // m
  gripOnTrack: 11.5,      // max lateral accel, m/s^2
  gripOffTrack: 5.0,
  engineOffTrackMult: 0.45,
  topSpeed: 52,           // m/s (~187 km/h)
  yawDamp: 2.2            // 1/s decay of collision-imparted spin
};

export class Vehicle {
  constructor({ x = 0, z = 0, heading = 0 } = {}) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = 0; // world-frame velocity
    this.vz = 0;
    this.steer = 0;      // smoothed steering state, -1..1
    this.yaw = 0;        // collision-imparted yaw rate (rad/s), decays to 0
    this.frozen = true;  // locked until the countdown ends
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  // Signed speed along the car's facing (negative when reversing).
  get forwardSpeed() {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }

  // Signed speed across the car (positive to the car's right). Transmitted so
  // the server can factor sideways slip into collisions (e.g. a PIT nudge).
  get lateralSpeed() {
    return -this.vx * Math.cos(this.heading) + this.vz * Math.sin(this.heading);
  }

  placeAt({ x, z, heading }) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = 0;
    this.steer = 0;
    this.yaw = 0;
  }

  // Applies a server-detected collision: a world-frame velocity change, a spin
  // (yaw-rate delta, which is what lets a rear-quarter hit spin the car out in
  // a PIT), and a small de-penetration nudge so the cars stop overlapping. The
  // deltas already account for this car's share of the bump (equal masses).
  applyImpulse({ dvx = 0, dvz = 0, dw = 0, dx = 0, dz = 0 }) {
    if (this.frozen) return;
    this.vx += dvx;
    this.vz += dvz;
    this.yaw += dw;
    this.x += dx;
    this.z += dz;
  }

  update(dt, input, terrain, track) {
    if (this.frozen) return;

    // Forward is (sin h, cos h); the car's right side is forward rotated
    // -90° about +y, i.e. (-fwdZ, fwdX). Getting this backwards flips the
    // steering direction relative to the chase camera.
    const fwdX = Math.sin(this.heading), fwdZ = Math.cos(this.heading);
    const rightX = -fwdZ, rightZ = fwdX;

    const onTrack = track.onTrack(this.x, this.z);
    const grip = onTrack ? PARAMS.gripOnTrack : PARAMS.gripOffTrack;
    const engineMult = onTrack ? 1 : PARAMS.engineOffTrackMult;

    // Velocity in the car frame.
    let vFwd = this.vx * fwdX + this.vz * fwdZ;
    let vLat = this.vx * rightX + this.vz * rightZ;

    // --- Longitudinal forces ---
    let force = 0;
    if (input.throttle > 0) {
      const speedRatio = Math.min(1, Math.abs(vFwd) / PARAMS.topSpeed);
      force += input.throttle * PARAMS.engineForce * engineMult * (1 - speedRatio * speedRatio);
    }
    if (input.brake > 0) {
      if (vFwd > 0.5) {
        force -= input.brake * PARAMS.brakeForce;
      } else {
        force -= input.brake * PARAMS.reverseForce; // reverse gear
      }
    }
    force -= PARAMS.dragCoeff * vFwd * Math.abs(vFwd);
    force -= PARAMS.rollingResist * vFwd * (onTrack ? 1 : 2.5);

    let aFwd = force / PARAMS.mass;

    // --- Lateral tire forces ---
    // Tires try to cancel sideways velocity within their grip budget; the
    // handbrake slashes that budget so the rear steps out.
    const gripLimit = input.handbrake ? grip * 0.35 : grip;
    const wantedLat = -vLat / dt;
    const aLat = THREE.MathUtils.clamp(wantedLat, -gripLimit, gripLimit);
    this.sliding = Math.abs(wantedLat) > gripLimit * 1.05;

    // --- Slope: gravity pulls the car downhill ---
    const { hx, hz } = terrain.slopeAt(this.x, this.z);
    const g = 9.81;
    const axSlope = -hx * g, azSlope = -hz * g;

    this.vx += (fwdX * aFwd + rightX * aLat + axSlope) * dt;
    this.vz += (fwdZ * aFwd + rightZ * aLat + azSlope) * dt;

    // --- Steering / yaw (bicycle model) ---
    const steerTarget = input.steer;
    const steerSpeed = 6;
    this.steer += THREE.MathUtils.clamp(steerTarget - this.steer, -steerSpeed * dt, steerSpeed * dt);
    // Less steering authority at speed to keep the car stable.
    const effSteer = this.steer * PARAMS.maxSteer / (1 + Math.abs(vFwd) * 0.035);
    vFwd = this.vx * fwdX + this.vz * fwdZ;
    if (Math.abs(vFwd) > 0.3) {
      // Positive steer = turn right = heading decreases (heading grows
      // toward +x, which is the car's left).
      this.heading -= (vFwd / PARAMS.wheelbase) * Math.tan(effSteer) * dt;
    }

    // Collision-imparted spin, integrated on top of steering and bled off so a
    // PIT hit produces a recoverable slew rather than an endless rotation.
    if (this.yaw !== 0) {
      this.heading += this.yaw * dt;
      this.yaw *= Math.max(0, 1 - PARAMS.yawDamp * dt);
      if (Math.abs(this.yaw) < 0.02) this.yaw = 0;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Soft world boundary: bounce back inside.
    const limit = 660;
    if (Math.abs(this.x) > limit) { this.x = Math.sign(this.x) * limit; this.vx *= -0.4; }
    if (Math.abs(this.z) > limit) { this.z = Math.sign(this.z) * limit; this.vz *= -0.4; }
  }
}

// Builds a car: a Kenney Car Kit model when a model name is given (loaded
// async into the returned group), falling back to the primitive box car if
// the model can't be fetched.
export function buildCarMesh(colorHex, modelName) {
  const car = new THREE.Group();
  if (modelName) {
    attachCarModel(car, modelName).catch((e) => {
      console.warn(`car model ${modelName} failed to load, using fallback`, e);
      buildPrimitiveCar(car, colorHex);
    });
  } else {
    buildPrimitiveCar(car, colorHex);
  }
  return car;
}

// A stylized low-poly car assembled from boxes: body, cabin, wheels, lights.
function buildPrimitiveCar(car, colorHex) {
  const color = new THREE.Color(colorHex);

  const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 80 });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x16181d });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x9fd3e8, shininess: 100 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.2), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  car.add(body);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.2), bodyMat);
  hood.position.set(0, 0.9, 1.35);
  car.add(hood);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 1.9), glassMat);
  cabin.position.set(0, 1.05, -0.25);
  cabin.castShadow = true;
  car.add(cabin);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.45), darkMat);
  spoiler.position.set(0, 1.05, -2.0);
  car.add(spoiler);
  const spoilerLegL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), darkMat);
  spoilerLegL.position.set(-0.6, 0.9, -2.0);
  car.add(spoilerLegL);
  const spoilerLegR = spoilerLegL.clone();
  spoilerLegR.position.x = 0.6;
  car.add(spoilerLegR);

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), lightMat);
    headlight.position.set(side * 0.6, 0.62, 2.11);
    car.add(headlight);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xd23b2f }));
    tail.position.set(side * 0.6, 0.62, -2.11);
    car.add(tail);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = { front: [], all: [], radius: 0.42 };
  const positions = [
    [-1.0, 0.42, 1.45, true], [1.0, 0.42, 1.45, true],
    [-1.0, 0.42, -1.45, false], [1.0, 0.42, -1.45, false]
  ];
  for (const [wx, wy, wz, isFront] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.castShadow = true;
    pivot.add(wheel);
    car.add(pivot);
    wheels.all.push(wheel);
    if (isFront) wheels.front.push(pivot);
  }

  car.userData.wheels = wheels;
  return car;
}

// Spins wheels with speed and turns the front pivots with the steering state.
export function animateCarMesh(mesh, { forwardSpeed = 0, steer = 0 }, dt) {
  const wheels = mesh.userData.wheels;
  if (!wheels) return;
  const spin = (forwardSpeed / (wheels.radius || 0.42)) * dt;
  for (const w of wheels.all) w.rotateX(spin);
  // Negative: positive (right) steer swings the wheels toward -x, matching
  // the yaw convention in Vehicle#update.
  for (const p of wheels.front) p.rotation.y = -steer * 0.5;
}

// Positions a car mesh on the terrain: height from the heightfield, pitch and
// roll from the local slope so cars visibly lean on hills.
export function poseOnTerrain(mesh, terrain, x, z, heading) {
  const y = terrain.heightAt(x, z);
  mesh.position.set(x, y, z);
  const { hx, hz } = terrain.slopeAt(x, z);
  const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
  const pitch = Math.atan2(hx * fwdX + hz * fwdZ, 1);
  const roll = Math.atan2(hx * fwdZ - hz * fwdX, 1);
  mesh.rotation.set(pitch, heading, roll, "YXZ");
}
