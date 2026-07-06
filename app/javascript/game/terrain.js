import * as THREE from "three";
import { createNoise2D, createRng } from "game/rng";

// The level is a single displaced ground mesh. Rolling hills come from
// fractal value noise; the corridor around the track is flattened onto a
// low-frequency elevation so the road stays drivable. The road surface
// itself is painted onto the ground texture from the track's sample table.
export const WORLD_SIZE = 1400;
const MESH_SEGMENTS = 220;
const TEXTURE_SIZE = 2048;
const CORRIDOR = 26;   // half-width of the flattened band around the track
const FALLOFF = 55;    // distance over which hills fade back in

export class Terrain {
  constructor(seed, track) {
    this.track = track;
    this.noise = createNoise2D(seed ^ 0x9e3779b9);
    this.detailNoise = createNoise2D(seed ^ 0x51ab3c);
  }

  // Gentle base elevation the track is allowed to follow.
  baseHeight(x, z) {
    return this.noise(x / 420, z / 420, 3) * 10;
  }

  // Full terrain height: base + hill detail that fades out near the track.
  heightAt(x, z) {
    const base = this.baseHeight(x, z);
    const hills = this.detailNoise(x / 160, z / 160, 4) * 14;
    const d = this.track.distanceToCenter(x, z);
    const t = smoothstep((d - CORRIDOR) / FALLOFF);
    return base + hills * t;
  }

  // Finite-difference surface normal/slope used by vehicle physics.
  slopeAt(x, z) {
    const e = 1.2;
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return { hx, hz };
  }

  buildMesh() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, MESH_SEGMENTS, MESH_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({ map: this.buildTexture() });
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Paints grass, the asphalt road, curbs, centerline and the start/finish
  // line onto one big canvas mapped over the whole world.
  buildTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext("2d");
    const scale = TEXTURE_SIZE / WORLD_SIZE;
    const toPx = (x) => (x + WORLD_SIZE / 2) * scale;

    // Grass base with mottling for depth perception.
    ctx.fillStyle = "#4c7a3d";
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const rng = createRng(0xbeef);
    for (let i = 0; i < 9000; i++) {
      const x = rng() * TEXTURE_SIZE, y = rng() * TEXTURE_SIZE;
      const g = 100 + rng() * 50;
      ctx.fillStyle = `rgba(${g * 0.55}, ${g}, ${g * 0.45}, 0.35)`;
      ctx.beginPath();
      ctx.arc(x, y, 2 + rng() * 8, 0, Math.PI * 2);
      ctx.fill();
    }

    const path = new Path2D();
    const samples = this.track.samples;
    path.moveTo(toPx(samples[0].x), toPx(samples[0].z));
    for (let i = 1; i < samples.length; i++) path.lineTo(toPx(samples[i].x), toPx(samples[i].z));
    path.closePath();

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Dirt shoulder, then curb stripe band, then asphalt on top.
    ctx.strokeStyle = "#6b5a3e";
    ctx.lineWidth = (this.track.width + 10) * scale;
    ctx.stroke(path);

    ctx.strokeStyle = "#d8d8d8";
    ctx.lineWidth = (this.track.width + 3) * scale;
    ctx.stroke(path);
    ctx.strokeStyle = "#cc3333";
    ctx.setLineDash([12, 12]);
    ctx.lineWidth = (this.track.width + 3) * scale;
    ctx.stroke(path);
    ctx.setLineDash([]);

    ctx.strokeStyle = "#3a3a40";
    ctx.lineWidth = this.track.width * scale;
    ctx.stroke(path);

    // Center dashes.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 0.6 * scale;
    ctx.setLineDash([6 * scale, 9 * scale]);
    ctx.stroke(path);
    ctx.setLineDash([]);

    this.paintStartLine(ctx, scale, toPx);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  paintStartLine(ctx, scale, toPx) {
    const s = this.track.samples[0];
    const px = -s.dirZ, pz = s.dirX; // perpendicular to driving direction
    const half = this.track.width / 2;
    const squares = 8;
    const step = (half * 2) / squares;
    const depth = 3;
    for (let i = 0; i < squares; i++) {
      for (let j = 0; j < 2; j++) {
        const off = -half + i * step;
        const along = (j - 0.5) * depth;
        ctx.fillStyle = (i + j) % 2 === 0 ? "#ffffff" : "#111111";
        ctx.save();
        ctx.translate(toPx(s.x + px * (off + step / 2) + s.dirX * along),
                      toPx(s.z + pz * (off + step / 2) + s.dirZ * along));
        ctx.rotate(Math.atan2(pz, px));
        ctx.fillRect(-step * scale / 2, -depth * scale / 2, step * scale, depth * scale);
        ctx.restore();
      }
    }
  }
}

function smoothstep(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
