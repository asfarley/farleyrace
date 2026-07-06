import * as THREE from "three";
import { generateTrack } from "game/track";
import { Terrain, WORLD_SIZE } from "game/terrain";
import { Vehicle, buildCarMesh, animateCarMesh, poseOnTerrain } from "game/vehicle";
import { Input } from "game/input";
import { TouchControls, isMobileDevice } from "game/touch";
import { Hud } from "game/hud";
import { LobbyClient } from "game/network";
import { createRng } from "game/rng";

const STATE_SEND_HZ = 15;
const INTERP_DELAY_MS = 120;

export class Game {
  constructor(shell) {
    this.shell = shell;
    this.code = shell.dataset.code;
    this.seed = parseInt(shell.dataset.seed, 10);
    this.playerId = parseInt(shell.dataset.playerId, 10);
    this.isHost = shell.dataset.host === "true";
    this.totalLaps = parseInt(shell.dataset.totalLaps, 10);
    this.playerColor = shell.dataset.playerColor;

    this.phase = "lobby"; // lobby | countdown | racing | finished
    this.players = [];
    this.remotes = new Map(); // id -> {mesh, buffer:[], lastState}
    this.lap = 0;
    this.halfwayPassed = false;
    this.lastProgress = 0;
    this.wrongWayTime = 0;
    this.raceStartMs = null;
    this.finished = false;
    this.sendAccum = 0;

    this.hud = new Hud(shell);
    this.input = new Input();
    this.touch = isMobileDevice() ? new TouchControls(shell) : null;
    if (this.touch) shell.classList.add("touch-mode");
    this.buildWorld();
    this.connect();
    this.bindUi();
    this.hud.showLobby();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
    window.__game = this; // debugging/testing handle
  }

  // ------------------------------------------------------------- world

  buildWorld() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x87b5d9, 300, 900);

    this.track = generateTrack(this.seed);
    this.terrain = new Terrain(this.seed, this.track);
    this.scene.add(this.terrain.buildMesh());

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a5f2f, 0.9);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
    this.sun.position.set(180, 260, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 60;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 50, far: 600 });
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.addScenery();
    this.addStartBanner();

    // Own car.
    const start = this.track.gridSlot(0);
    this.vehicle = new Vehicle(start);
    this.carMesh = buildCarMesh(this.playerColor);
    this.scene.add(this.carMesh);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    this.camTarget = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container = this.shell.querySelector("#game-canvas");
    this.container.appendChild(this.renderer.domElement);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  addScenery() {
    const rng = createRng(this.seed ^ 0x7f4a7c15);
    const treeTrunk = new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6);
    const treeTop = new THREE.ConeGeometry(2.4, 5.5, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    const rockGeo = new THREE.DodecahedronGeometry(1.6, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8b8d92 });

    const treeGroup = new THREE.Group();
    let placed = 0, tries = 0;
    while (placed < 140 && tries < 2000) {
      tries++;
      const x = (rng() - 0.5) * WORLD_SIZE * 0.85;
      const z = (rng() - 0.5) * WORLD_SIZE * 0.85;
      if (this.track.distanceToCenter(x, z) < 34) continue;
      const y = this.terrain.heightAt(x, z);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(treeTrunk, trunkMat);
      trunk.position.y = 1.2;
      const shade = 0.25 + rng() * 0.3;
      const top = new THREE.Mesh(treeTop, new THREE.MeshLambertMaterial({
        color: new THREE.Color(0.1, shade, 0.12)
      }));
      top.position.y = 4.5;
      tree.add(trunk, top);
      const sc = 0.7 + rng() * 1.1;
      tree.scale.setScalar(sc);
      tree.position.set(x, y, z);
      treeGroup.add(tree);
      placed++;
    }
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * WORLD_SIZE * 0.85;
      const z = (rng() - 0.5) * WORLD_SIZE * 0.85;
      if (this.track.distanceToCenter(x, z) < 26) continue;
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, this.terrain.heightAt(x, z) + 0.4, z);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.scale.setScalar(0.4 + rng() * 1.4);
      treeGroup.add(rock);
    }
    this.scene.add(treeGroup);
  }

  addStartBanner() {
    const s = this.track.samples[0];
    const px = -s.dirZ, pz = s.dirX;
    const half = this.track.width / 2 + 1.5;
    const group = new THREE.Group();
    const pillarGeo = new THREE.CylinderGeometry(0.35, 0.35, 8, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, mat);
      const x = s.x + px * half * side, z = s.z + pz * half * side;
      pillar.position.set(x, this.terrain.heightAt(x, z) + 4, z);
      group.add(pillar);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 1.4, 0.2),
      new THREE.MeshLambertMaterial({ color: 0xcc2222 })
    );
    banner.position.set(s.x, this.terrain.heightAt(s.x, s.z) + 7.6, s.z);
    banner.rotation.y = Math.atan2(px, pz);
    group.add(banner);
    this.scene.add(group);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ------------------------------------------------------------- network

  connect() {
    this.client = new LobbyClient(this.code, {
      onConnected: () => this.hud.setConnectionLost(false),
      onDisconnected: () => this.hud.setConnectionLost(true),
      onRejected: () => { window.location.href = "/"; },
      onRoster: (data) => this.handleRoster(data),
      onState: (data) => this.handleRemoteState(data),
      onCountdown: (data) => this.handleCountdown(data),
      onLap: (data) => this.handleRemoteLap(data),
      onFinished: (data) => this.handleFinished(data),
      onRaceOver: (data) => {
        this.touch?.setVisible(false);
        this.hud.showResults(data.results, this.isHost);
      },
      onRaceReset: () => window.location.reload()
    });
  }

  handleRoster({ players }) {
    this.players = players;
    const me = players.find((p) => p.id === this.playerId);
    if (me) this.isHost = me.host;
    this.hud.renderRoster(players, this.isHost && this.phase === "lobby");

    // Sync remote car meshes with the roster.
    for (const p of players) {
      if (p.id !== this.playerId && !this.remotes.has(p.id)) this.addRemote(p);
    }
    for (const [id, remote] of this.remotes) {
      const player = players.find((p) => p.id === id);
      if (!player || !player.connected) {
        this.scene.remove(remote.mesh);
        this.remotes.delete(id);
      }
    }

    // My own grid slot follows my roster position.
    if (this.phase === "lobby") {
      const slot = players.findIndex((p) => p.id === this.playerId);
      if (slot >= 0) this.vehicle.placeAt(this.track.gridSlot(slot));
      players.forEach((p, i) => {
        const remote = this.remotes.get(p.id);
        if (remote && remote.buffer.length === 0) {
          const pose = this.track.gridSlot(i);
          poseOnTerrain(remote.mesh, this.terrain, pose.x, pose.z, pose.heading);
        }
      });
    }
  }

  addRemote(player) {
    const mesh = buildCarMesh(player.color);
    this.scene.add(mesh);
    this.remotes.set(player.id, { mesh, buffer: [], lastState: null });
  }

  handleRemoteState({ id, s }) {
    if (id === this.playerId) return;
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.buffer.push({ t: performance.now(), ...s });
    if (remote.buffer.length > 30) remote.buffer.shift();
    remote.lastState = s;
  }

  handleCountdown({ starts_at_ms, total_laps }) {
    this.totalLaps = total_laps;
    this.phase = "countdown";
    this.raceStartMs = starts_at_ms;
    this.finished = false;
    this.lap = 0;
    this.halfwayPassed = false;
    this.hud.showRace();
    this.touch?.setVisible(true);

    const slot = this.players.findIndex((p) => p.id === this.playerId);
    this.vehicle.placeAt(this.track.gridSlot(Math.max(slot, 0)));
    this.vehicle.frozen = true;
    this.lastProgress = this.track.progressAt(this.vehicle.x, this.vehicle.z);
  }

  handleRemoteLap({ id, lap }) {
    const p = this.players.find((pl) => pl.id === id);
    if (p) this.hud.feed(`${p.name} — lap ${Math.min(lap + 1, this.totalLaps)}`);
  }

  handleFinished({ id, position, name }) {
    const suffix = ["st", "nd", "rd"][position - 1] || "th";
    this.hud.feed(`🏁 ${name} finished ${position}${suffix}`);
    if (id === this.playerId) this.finished = true;
  }

  // ------------------------------------------------------------- loop

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.25);
    const now = Date.now();

    if (this.phase === "countdown") {
      const remaining = this.raceStartMs - now;
      if (remaining <= 0) {
        this.phase = "racing";
        this.vehicle.frozen = false;
        this.hud.setCountdown("GO!");
        setTimeout(() => this.hud.setCountdown(null), 900);
      } else {
        this.hud.setCountdown(String(Math.ceil(remaining / 1000)));
      }
    }

    if (this.phase === "racing" || this.phase === "countdown") {
      // Fixed-timestep substepping keeps the car's simulated speed
      // independent of the render framerate.
      const input = this.finished ? { throttle: 0, brake: 0.4, steer: 0, handbrake: false } : this.readInput();
      const step = 1 / 120;
      this.physicsAccum = (this.physicsAccum ?? 0) + dt;
      while (this.physicsAccum >= step) {
        this.vehicle.update(step, input, this.terrain, this.track);
        this.physicsAccum -= step;
      }
      this.trackProgress(dt);
      this.broadcastState(dt);
      this.hud.update({
        speedKmh: this.vehicle.speed * 3.6,
        lap: this.lap,
        totalLaps: this.totalLaps,
        raceMs: now - this.raceStartMs,
        wrongWay: this.wrongWayTime > 1.2
      });
    }

    poseOnTerrain(this.carMesh, this.terrain, this.vehicle.x, this.vehicle.z, this.vehicle.heading);
    animateCarMesh(this.carMesh, { forwardSpeed: this.vehicle.forwardSpeed, steer: this.vehicle.steer }, dt);
    this.updateRemotes(dt);
    this.updateCamera(dt);

    // Keep the shadow camera centred on the action.
    this.sun.target.position.set(this.vehicle.x, 0, this.vehicle.z);
    this.sun.position.set(this.vehicle.x + 180, 260, this.vehicle.z + 120);

    this.renderer.render(this.scene, this.camera);
  }

  // Keyboard and touch controls are both live; whichever is pressed wins.
  readInput() {
    const kb = this.input.read();
    const t = this.touch?.read();
    if (!t) return kb;
    return {
      throttle: Math.max(kb.throttle, t.throttle),
      brake: Math.max(kb.brake, t.brake),
      steer: THREE.MathUtils.clamp(kb.steer + t.steer, -1, 1),
      handbrake: kb.handbrake || t.handbrake
    };
  }

  trackProgress(dt) {
    if (this.phase !== "racing" || this.finished) return;
    const p = this.track.progressAt(this.vehicle.x, this.vehicle.z);
    let delta = p - this.lastProgress;
    if (delta > 0.5) delta -= 1;   // wrapped backwards over the line
    if (delta < -0.5) delta += 1;  // wrapped forwards over the line

    if (p > 0.4 && p < 0.6) this.halfwayPassed = true;

    // Crossing the start line forward with the halfway checkpoint ticked.
    if (delta > 0 && this.lastProgress > 0.9 && p < 0.1 && this.halfwayPassed) {
      this.lap += 1;
      this.halfwayPassed = false;
      this.client.reportLap();
      if (this.lap < this.totalLaps) this.hud.feed(`Lap ${this.lap + 1}/${this.totalLaps}`);
    }

    if (delta < -0.00001 && this.vehicle.speed > 3) {
      this.wrongWayTime += dt;
    } else if (delta > 0.00001) {
      this.wrongWayTime = 0;
    }
    this.lastProgress = p;
  }

  broadcastState(dt) {
    this.sendAccum += dt;
    if (this.sendAccum < 1 / STATE_SEND_HZ) return;
    this.sendAccum = 0;
    this.client.sendState({
      x: round2(this.vehicle.x),
      z: round2(this.vehicle.z),
      h: round3(this.vehicle.heading),
      v: round2(this.vehicle.forwardSpeed),
      st: round2(this.vehicle.steer)
    });
  }

  // Remote cars render slightly in the past and interpolate between buffered
  // snapshots, which hides network jitter.
  updateRemotes(dt) {
    const renderT = performance.now() - INTERP_DELAY_MS;
    for (const remote of this.remotes.values()) {
      const buf = remote.buffer;
      if (buf.length === 0) continue;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= renderT && buf[i + 1].t >= renderT) {
          a = buf[i];
          b = buf[i + 1];
          break;
        }
      }
      let x, z, h;
      if (b.t > a.t && renderT >= a.t && renderT <= b.t) {
        const f = (renderT - a.t) / (b.t - a.t);
        x = a.x + (b.x - a.x) * f;
        z = a.z + (b.z - a.z) * f;
        h = lerpAngle(a.h, b.h, f);
      } else {
        // Ahead of the newest snapshot: extrapolate briefly along heading.
        const last = buf[buf.length - 1];
        const age = Math.min((renderT - last.t) / 1000, 0.25);
        x = last.x + Math.sin(last.h) * last.v * Math.max(age, 0);
        z = last.z + Math.cos(last.h) * last.v * Math.max(age, 0);
        h = last.h;
      }
      poseOnTerrain(remote.mesh, this.terrain, x, z, h);
      animateCarMesh(remote.mesh, { forwardSpeed: remote.lastState?.v ?? 0, steer: remote.lastState?.st ?? 0 }, dt);
    }
  }

  updateCamera(dt) {
    if (this.phase === "lobby") {
      // Slow flyover while waiting in the lobby.
      const t = performance.now() / 20000;
      const r = 320;
      this.camera.position.set(Math.cos(t) * r, 150, Math.sin(t) * r);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    const v = this.vehicle;
    const fwdX = Math.sin(v.heading), fwdZ = Math.cos(v.heading);
    const targetPos = new THREE.Vector3(
      v.x - fwdX * 11,
      this.terrain.heightAt(v.x, v.z) + 5.5,
      v.z - fwdZ * 11
    );
    const k = 1 - Math.exp(-6 * dt);
    this.camera.position.lerp(targetPos, k);
    // Never let the camera clip below the ground.
    const minY = this.terrain.heightAt(this.camera.position.x, this.camera.position.z) + 2;
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    this.camTarget.lerp(new THREE.Vector3(v.x + fwdX * 6, this.terrain.heightAt(v.x, v.z) + 1.6, v.z + fwdZ * 6), k);
    this.camera.lookAt(this.camTarget);
  }

  // ------------------------------------------------------------- ui

  bindUi() {
    this.hud.el.startBtn.addEventListener("click", () => this.client.startRace());
    this.hud.el.backBtn.addEventListener("click", () => this.client.backToLobby());
    this.hud.el.copyLink.addEventListener("click", async () => {
      const url = `${window.location.origin}/?code=${this.code}`;
      try {
        await navigator.clipboard.writeText(url);
        this.hud.el.copyLink.textContent = "Copied!";
      } catch {
        this.hud.el.copyLink.textContent = url;
      }
      setTimeout(() => { this.hud.el.copyLink.textContent = "Copy invite link"; }, 2000);
    });
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
