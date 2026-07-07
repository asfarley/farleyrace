// Thin DOM layer for everything that isn't the 3D scene: roster, countdown,
// speed/lap/time readouts, race feed and the results panel.
export class Hud {
  constructor(shell) {
    this.el = {
      lobbyPanel: shell.querySelector("#lobby-panel"),
      roster: shell.querySelector("#roster"),
      startBtn: shell.querySelector("#start-race"),
      waitingMsg: shell.querySelector("#waiting-msg"),
      hud: shell.querySelector("#hud"),
      speed: shell.querySelector("#speed-value"),
      lap: shell.querySelector("#lap-value"),
      lapTotal: shell.querySelector("#lap-total"),
      time: shell.querySelector("#hud-time"),
      feed: shell.querySelector("#race-feed"),
      countdown: shell.querySelector("#countdown"),
      wrongWay: shell.querySelector("#wrong-way"),
      finishBanner: shell.querySelector("#finish-banner"),
      finishText: shell.querySelector("#finish-text"),
      results: shell.querySelector("#results-panel"),
      resultsList: shell.querySelector("#results-list"),
      backBtn: shell.querySelector("#back-to-lobby"),
      resultsWaiting: shell.querySelector("#results-waiting"),
      connectionLost: shell.querySelector("#connection-lost"),
      copyLink: shell.querySelector("#copy-link")
    };
  }

  renderRoster(players, isHost) {
    this.el.roster.innerHTML = "";
    for (const p of players) {
      const li = document.createElement("li");
      if (!p.connected) li.classList.add("offline");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = p.color;
      const name = document.createElement("span");
      name.textContent = p.name;
      li.append(swatch, name);
      if (p.host) {
        const badge = document.createElement("span");
        badge.className = "host-badge";
        badge.textContent = "HOST";
        li.append(badge);
      }
      this.el.roster.append(li);
    }
    this.el.startBtn.hidden = !isHost;
    this.el.waitingMsg.hidden = isHost;
  }

  showLobby() {
    this.el.lobbyPanel.hidden = false;
    this.el.hud.hidden = true;
    this.el.results.hidden = true;
    this.el.wrongWay.hidden = true;
  }

  showRace() {
    this.el.lobbyPanel.hidden = true;
    this.el.results.hidden = true;
    this.el.hud.hidden = false;
  }

  setCountdown(text) {
    this.el.countdown.hidden = text == null;
    if (text != null) this.el.countdown.textContent = text;
  }

  // Checkered flag banner shown to the local player when they cross the line.
  showFinishBanner(won) {
    this.el.finishText.textContent = won ? "VICTORY!" : "FINISH";
    this.el.finishBanner.classList.toggle("victory", won);
    this.el.finishBanner.hidden = false;
  }

  hideFinishBanner() {
    this.el.finishBanner.hidden = true;
  }

  update({ speedKmh, lap, totalLaps, raceMs, wrongWay }) {
    this.el.speed.textContent = Math.round(speedKmh);
    this.el.lap.textContent = Math.min(lap + 1, totalLaps);
    this.el.lapTotal.textContent = totalLaps;
    this.el.time.textContent = raceMs >= 0 ? formatMs(raceMs) : "0:00.0";
    this.el.wrongWay.hidden = !wrongWay;
  }

  feed(message) {
    const item = document.createElement("div");
    item.className = "feed-item";
    item.textContent = message;
    this.el.feed.prepend(item);
    setTimeout(() => item.remove(), 6000);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }

  showResults(results, isHost) {
    this.el.hud.hidden = true;
    this.el.wrongWay.hidden = true;
    this.hideFinishBanner();
    this.el.results.hidden = false;
    this.el.backBtn.hidden = !isHost;
    this.el.resultsWaiting.hidden = isHost;
    this.el.resultsList.innerHTML = "";
    for (const r of results) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = r.name;
      name.style.color = r.color;
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = formatMs(r.time_ms);
      li.append(name, time);
      this.el.resultsList.append(li);
    }
  }

  setConnectionLost(lost) {
    this.el.connectionLost.hidden = !lost;
  }
}

export function formatMs(ms) {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
