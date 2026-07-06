import * as THREE from "three";
import { createRng } from "game/rng";

// A closed racing circuit generated from the lobby seed: jittered control
// points around a ring, smoothed into a Catmull-Rom loop, then densely
// sampled. All track queries (distance, progress, start grid) work off the
// sample table.
export const TRACK_WIDTH = 16;
export const SAMPLE_COUNT = 512;

export function generateTrack(seed) {
  const rng = createRng(seed);

  const controlCount = 10 + Math.floor(rng() * 4);
  const baseRadius = 250 + rng() * 60;
  const points = [];
  for (let i = 0; i < controlCount; i++) {
    const angle = (i / controlCount) * Math.PI * 2;
    const radius = baseRadius * (0.62 + rng() * 0.55);
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }

  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal", 0.6);

  const samples = [];
  let length = 0;
  let prev = null;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    if (prev) length += p.distanceTo(prev);
    samples.push({
      x: p.x,
      z: p.z,
      dirX: tangent.x,
      dirZ: tangent.z,
      dist: length
    });
    prev = p;
  }
  const closing = Math.hypot(samples[0].x - prev.x, samples[0].z - prev.z);
  return new Track(samples, length + closing);
}

export class Track {
  constructor(samples, totalLength) {
    this.samples = samples;
    this.count = samples.length;
    this.totalLength = totalLength;
    this.width = TRACK_WIDTH;

    // Coarse spatial grid of candidate sample indices, so nearest-sample
    // queries don't scan all samples for every terrain vertex and wheel.
    this.cell = 40;
    this.grid = new Map();
    samples.forEach((s, i) => {
      const keys = this._cellsAround(s.x, s.z, 2);
      for (const k of keys) {
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(i);
      }
    });
  }

  _cellsAround(x, z, spread) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const keys = [];
    for (let i = -spread; i <= spread; i++) {
      for (let j = -spread; j <= spread; j++) {
        keys.push(`${cx + i},${cz + j}`);
      }
    }
    return keys;
  }

  // Returns { index, distance } of the closest track sample. Falls back to a
  // full scan far away from the track (rare: scenery placement, resets).
  nearest(x, z) {
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const candidates = this.grid.get(key);
    let best = -1, bestD = Infinity;
    const scan = (indices) => {
      for (const i of indices) {
        const s = this.samples[i];
        const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    if (candidates) scan(candidates);
    if (best === -1) scan(this.samples.map((_, i) => i));
    return { index: best, distance: Math.sqrt(bestD) };
  }

  distanceToCenter(x, z) {
    return this.nearest(x, z).distance;
  }

  onTrack(x, z) {
    return this.distanceToCenter(x, z) <= this.width / 2 + 1;
  }

  // Race progress in [0, 1) for lap/wrong-way logic.
  progressAt(x, z) {
    return this.nearest(x, z).index / this.count;
  }

  startPose() {
    const s = this.samples[0];
    return { x: s.x, z: s.z, heading: Math.atan2(s.dirX, s.dirZ) };
  }

  // Two-column starting grid placed behind the start line.
  gridSlot(slot) {
    const spacing = 9;
    const back = 12 + Math.floor(slot / 2) * spacing;
    const side = (slot % 2 === 0 ? -1 : 1) * this.width * 0.22;
    const idx = (this.count - Math.round(back / (this.totalLength / this.count)) + this.count) % this.count;
    const s = this.samples[idx];
    // Perpendicular offset for the two columns.
    const px = -s.dirZ, pz = s.dirX;
    return {
      x: s.x + px * side,
      z: s.z + pz * side,
      heading: Math.atan2(s.dirX, s.dirZ)
    };
  }
}
