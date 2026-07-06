// On-screen driving controls for touch devices: translucent icon buttons,
// steering on the left thumb, pedals on the right. Multi-touch works — each
// button tracks its own pointer.
export function isMobileDevice() {
  return (
    window.matchMedia?.("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    "ontouchstart" in window
  );
}

const ICONS = {
  left: `<svg viewBox="0 0 24 24"><path d="M15 4 L7 12 L15 20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  right: `<svg viewBox="0 0 24 24"><path d="M9 4 L17 12 L9 20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gas: `<svg viewBox="0 0 24 24"><path d="M12 20 L12 5 M5 11 L12 4 L19 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  brake: `<svg viewBox="0 0 24 24"><polygon points="8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  handbrake: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><text x="12" y="16.2" text-anchor="middle" font-size="11.5" font-weight="bold" fill="currentColor" font-family="sans-serif">P</text></svg>`
};

export class TouchControls {
  constructor(shell) {
    this.pressed = new Set();

    this.root = document.createElement("div");
    this.root.id = "touch-controls";
    this.root.hidden = true;
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());

    const steer = document.createElement("div");
    steer.className = "touch-cluster steer";
    steer.append(this.button("left"), this.button("right"));

    const pedals = document.createElement("div");
    pedals.className = "touch-cluster pedals";
    pedals.append(this.button("handbrake"), this.button("brake"), this.button("gas"));

    this.root.append(steer, pedals);
    shell.append(this.root);
  }

  button(name) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `touch-btn ${name}`;
    el.setAttribute("aria-label", name);
    el.innerHTML = ICONS[name];
    const press = (e) => {
      e.preventDefault();
      this.pressed.add(name);
      el.classList.add("active");
      try { el.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    };
    const release = () => {
      this.pressed.delete(name);
      el.classList.remove("active");
    };
    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    return el;
  }

  read() {
    const p = this.pressed;
    return {
      throttle: p.has("gas") ? 1 : 0,
      brake: p.has("brake") ? 1 : 0,
      steer: (p.has("left") ? -1 : 0) + (p.has("right") ? 1 : 0),
      handbrake: p.has("handbrake")
    };
  }

  setVisible(visible) {
    this.root.hidden = !visible;
  }
}
