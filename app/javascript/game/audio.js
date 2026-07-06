// Game audio: a synthesized engine note and a streaming internet radio.
//
// The engine is a stack of detuned oscillators at harmonic multiples of a
// base frequency (0.5x, 1x, 2x, 3x, 4x — saw/square for the growl, sines for
// body), pushed through a lowpass filter. RPM follows speed through a crude
// gearbox, so the note rises and drops back on each "shift".
const HARMONICS = [
  { mult: 0.5, type: "square", gain: 0.30 },
  { mult: 1.0, type: "sawtooth", gain: 0.42 },
  { mult: 2.0, type: "sawtooth", gain: 0.22 },
  { mult: 3.0, type: "sine", gain: 0.18 },
  { mult: 4.0, type: "sine", gain: 0.08 }
];

const GEAR_SPAN = 9;    // m/s of road speed per gear
const IDLE_RPM = 0.12;  // normalized rpm floor

class EngineSound {
  constructor(ctx) {
    this.ctx = ctx;
    this.rpm = IDLE_RPM;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 600;
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);

    this.oscs = HARMONICS.map((h) => {
      const osc = ctx.createOscillator();
      osc.type = h.type;
      osc.frequency.value = 60 * h.mult;
      // A few cents of random detune keeps the stack from sounding sterile.
      osc.detune.value = (Math.random() - 0.5) * 14;
      const gain = ctx.createGain();
      gain.gain.value = h.gain;
      osc.connect(gain);
      gain.connect(this.filter);
      osc.start();
      return { osc, mult: h.mult };
    });
  }

  update(speed, throttle, muted, dt) {
    // Crude gearbox: rpm climbs across each gear's speed span, drops on the
    // shift. Throttle blips the target so revving at a standstill works.
    const gearFrac = Math.min(speed, GEAR_SPAN * 5 - 0.01) % GEAR_SPAN / GEAR_SPAN;
    const target = Math.min(1, IDLE_RPM + gearFrac * 0.72 + throttle * 0.16);
    const k = 1 - Math.exp(-dt * (target > this.rpm ? 5.5 : 3));
    this.rpm += (target - this.rpm) * k;

    const now = this.ctx.currentTime;
    const f0 = 46 + this.rpm * 210;
    for (const { osc, mult } of this.oscs) {
      osc.frequency.setTargetAtTime(f0 * mult, now, 0.03);
    }
    this.filter.frequency.setTargetAtTime(350 + this.rpm * 2600, now, 0.05);
    const volume = muted ? 0 : 0.05 + this.rpm * 0.08 + throttle * 0.05;
    this.master.gain.setTargetAtTime(volume, now, 0.08);
  }

  silence() {
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }
}

const STATIONS = [
  { name: "Groove Salad", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  { name: "Underground 80s", url: "https://ice1.somafm.com/u80s-128-mp3" },
  { name: "Fluid", url: "https://ice1.somafm.com/fluid-128-mp3" },
  { name: "Radio Paradise", url: "https://stream.radioparadise.com/mp3-128" }
];

class Radio {
  constructor() {
    this.audio = new Audio();
    this.audio.volume = 0.45;
    this.audio.preload = "none";
    this.index = 0;
    this.playing = false;
  }

  get station() {
    return STATIONS[this.index];
  }

  play() {
    this.audio.src = this.station.url;
    this.playing = true;
    return this.audio.play().catch(() => {
      this.playing = false;
      throw new Error("stream unavailable");
    });
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.playing = false;
  }

  next() {
    this.index = (this.index + 1) % STATIONS.length;
    if (this.playing) return this.play();
    return Promise.resolve();
  }
}

// Owns the AudioContext (created on the first user gesture, per browser
// autoplay rules), the engine synth, the radio, and their toolbar buttons.
export class GameAudio {
  constructor(shell) {
    this.engineMuted = false;
    this.engine = null;
    this.radio = new Radio();

    this.el = {
      engineBtn: shell.querySelector("#engine-toggle"),
      radioBtn: shell.querySelector("#radio-toggle"),
      radioNext: shell.querySelector("#radio-next")
    };

    const unlock = () => {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.engine = new EngineSound(this.ctx);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    this.el.engineBtn.addEventListener("click", () => {
      this.engineMuted = !this.engineMuted;
      this.el.engineBtn.textContent = this.engineMuted ? "🔇 Engine" : "🔊 Engine";
      this.el.engineBtn.classList.toggle("off", this.engineMuted);
    });

    this.el.radioBtn.addEventListener("click", () => {
      if (this.radio.playing) {
        this.radio.stop();
        this.renderRadio();
      } else {
        this.renderRadio("connecting…");
        this.radio.play().then(() => this.renderRadio()).catch(() => this.renderRadio("unavailable"));
      }
    });

    this.el.radioNext.addEventListener("click", () => {
      this.renderRadio(this.radio.playing ? "connecting…" : undefined);
      this.radio.next().then(() => this.renderRadio()).catch(() => this.renderRadio("unavailable"));
    });

    this.renderRadio();
  }

  renderRadio(note) {
    const { radioBtn, radioNext } = this.el;
    if (note) {
      radioBtn.textContent = `📻 ${this.radio.station.name} — ${note}`;
    } else if (this.radio.playing) {
      radioBtn.textContent = `📻 ${this.radio.station.name}`;
    } else {
      radioBtn.textContent = "📻 Radio off";
    }
    radioBtn.classList.toggle("off", !this.radio.playing);
    radioNext.hidden = !this.radio.playing;
  }

  // Called every frame from the game loop. `driving` covers the countdown
  // too, so engines idle (and rev on throttle blips) on the grid.
  updateEngine(vehicle, driving, throttle, dt) {
    if (!this.engine) return;
    if (driving) {
      this.engine.update(vehicle.speed, throttle, this.engineMuted, dt);
    } else {
      this.engine.silence();
    }
  }
}
