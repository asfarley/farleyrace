import { createConsumer } from "@rails/actioncable";

// ActionCable client for the lobby. The server relays vehicle state between
// players and owns the race lifecycle (roster, countdown, laps, results).
export class LobbyClient {
  constructor(code, handlers) {
    this.handlers = handlers;
    this.consumer = createConsumer();
    this.subscription = this.consumer.subscriptions.create(
      { channel: "LobbyChannel", code },
      {
        connected: () => handlers.onConnected?.(),
        disconnected: () => handlers.onDisconnected?.(),
        rejected: () => handlers.onRejected?.(),
        received: (data) => this.dispatch(data)
      }
    );
  }

  dispatch(data) {
    switch (data.type) {
      case "roster":    return this.handlers.onRoster?.(data);
      case "state":     return this.handlers.onState?.(data);
      case "countdown": return this.handlers.onCountdown?.(data);
      case "lap":       return this.handlers.onLap?.(data);
      case "finished":  return this.handlers.onFinished?.(data);
      case "race_over": return this.handlers.onRaceOver?.(data);
      case "race_reset": return this.handlers.onRaceReset?.(data);
    }
  }

  sendState(state) {
    this.subscription.perform("state", { s: state });
  }

  startRace() {
    this.subscription.perform("start_race");
  }

  reportLap() {
    this.subscription.perform("lap");
  }

  backToLobby() {
    this.subscription.perform("back_to_lobby");
  }
}
