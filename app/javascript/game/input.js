// Keyboard state → normalized driving input {throttle, brake, steer, handbrake}.
export class Input {
  constructor() {
    this.keys = new Set();
    this._down = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    };
    this._up = (e) => this.keys.delete(e.code);
    window.addEventListener("keydown", this._down);
    window.addEventListener("keyup", this._up);
    window.addEventListener("blur", () => this.keys.clear());
  }

  read() {
    const k = this.keys;
    return {
      throttle: k.has("KeyW") || k.has("ArrowUp") ? 1 : 0,
      brake: k.has("KeyS") || k.has("ArrowDown") ? 1 : 0,
      steer: (k.has("KeyA") || k.has("ArrowLeft") ? -1 : 0) + (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0),
      handbrake: k.has("Space")
    };
  }
}
