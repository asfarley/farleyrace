// Deterministic PRNG (mulberry32). Every client seeds this with the lobby's
// seed so terrain, track and scenery are identical for all players.
export function createRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise with cosine interpolation, built on a seeded lattice.
export function createNoise2D(seed) {
  const hash = (x, y) => {
    let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);

  const single = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };

  // Fractal brownian motion: octaves of value noise, output in [-1, 1].
  return function fbm(x, y, octaves = 4) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += (single(x * freq, y * freq) * 2 - 1) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}
