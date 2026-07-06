// Top-down track map in the corner of the race HUD. The track outline is
// pre-rendered once to an offscreen canvas; each frame just re-blits it and
// draws a dot per car.
const CSS_SIZE = 160; // must match #minimap in application.css

export class Minimap {
  constructor(canvas, track) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = CSS_SIZE * this.dpr;
    canvas.width = this.size;
    canvas.height = this.size;
    this.ctx = canvas.getContext("2d");

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }
    const pad = this.size * 0.12;
    const scale = (this.size - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const ox = (this.size - (maxX - minX) * scale) / 2 - minX * scale;
    const oz = (this.size - (maxZ - minZ) * scale) / 2 - minZ * scale;
    this.mapX = (x) => x * scale + ox;
    this.mapZ = (z) => z * scale + oz;

    this.base = document.createElement("canvas");
    this.base.width = this.base.height = this.size;
    this.drawTrack(this.base.getContext("2d"), track, scale);
  }

  drawTrack(ctx, track, scale) {
    ctx.beginPath();
    track.samples.forEach((s, i) => {
      i === 0 ? ctx.moveTo(this.mapX(s.x), this.mapZ(s.z))
              : ctx.lineTo(this.mapX(s.x), this.mapZ(s.z));
    });
    ctx.closePath();
    ctx.lineJoin = ctx.lineCap = "round";
    const roadPx = Math.max(track.width * scale, 3 * this.dpr);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = roadPx + 2 * this.dpr;
    ctx.stroke();
    ctx.strokeStyle = "rgba(212, 219, 228, 0.95)";
    ctx.lineWidth = roadPx;
    ctx.stroke();

    // Start/finish notch, perpendicular to the first sample's direction.
    const s0 = track.samples[0];
    const px = -s0.dirZ, pz = s0.dirX;
    const half = (track.width / 2) * scale;
    ctx.beginPath();
    ctx.moveTo(this.mapX(s0.x) + px * half, this.mapZ(s0.z) + pz * half);
    ctx.lineTo(this.mapX(s0.x) - px * half, this.mapZ(s0.z) - pz * half);
    ctx.strokeStyle = "#e8483f";
    ctx.lineWidth = 2 * this.dpr;
    ctx.stroke();
  }

  // dots: [{x, z, color, isLocal}] in world coords; draw order = array order,
  // so callers put the local player last to keep it on top.
  update(dots) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.base, 0, 0);
    for (const d of dots) {
      const r = (d.isLocal ? 5 : 4) * this.dpr;
      const x = clamp(this.mapX(d.x), r, this.size - r);
      const y = clamp(this.mapZ(d.z), r, this.size - r);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.strokeStyle = d.isLocal ? "#ffffff" : "rgba(0, 0, 0, 0.6)";
      ctx.stroke();
    }
  }
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
