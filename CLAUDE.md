# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Rails 8.1 3D multiplayer racing game: Three.js on the client, ActionCable for real-time state sync, SQLite for lobbies/players. No accounts — players are identified by a signed cookie token and share a 6-character lobby code.

## Commands

Requires Ruby 3.4.2 (`.ruby-version`) — Ruby 3.3.x crashes Rails 8.1 with a SyntaxError.

```sh
bin/setup            # install deps, prepare DB, start server
bin/rails server     # run locally at http://localhost:3000
bin/ci               # everything CI runs: rubocop, bundler-audit, importmap audit, brakeman
bin/rubocop          # Ruby style (rubocop-rails-omakase)
bin/brakeman --no-pager
```

There is no test suite. CI (`config/ci.rb`, `.github/workflows/ci.yml`) is lint + security scans only.

To test multiplayer locally, open two browser windows against the same lobby code.

Deploy is Kamal to race.asfarley.com (see `config/deploy.yml` header comment): `kamal deploy`, with `KAMAL_REGISTRY_PASSWORD` set to a GHCR token. Production uses a Redis accessory for ActionCable; development uses the async adapter.

## Architecture

The core design principle: **levels are never transmitted**. Each lobby gets a random `seed` (on the `Lobby` record); every client deterministically regenerates the identical terrain, track, and trees from that seed using the seeded RNG in `app/javascript/game/rng.js`. Anything that affects world geometry must be derived from the seed the same way on all clients — never use `Math.random()` for world content.

### Server (thin)

- `app/models/lobby.rb`, `player.rb` — the only two models. Lobby owns the race lifecycle status (`waiting`/`racing`), the seed, host token, and roster broadcasting.
- `app/controllers/lobbies_controller.rb` — create/join/show; assigns the signed `player_token` cookie. Late visitors to a waiting lobby get a slot via the invite link.
- `app/channels/lobby_channel.rb` — all real-time logic. Relays per-player vehicle `state` messages (high-frequency, not persisted) to the lobby stream, and **owns race authority**: countdown start, lap counting (clients report `lap` crossings, server assigns finish positions/times), host promotion on disconnect, and back-to-lobby reset.

### Client (`app/javascript/game/`, loaded via importmap, no build step)

- `game.js` — orchestrator. Owns the phase state machine (`lobby → countdown → racing → finished`), the render loop, fixed 120 Hz physics stepping, sending local state at 15 Hz, and rendering remote cars ~120 ms in the past with interpolation between snapshots.
- `terrain.js` / `track.js` — seed-derived world: fractal value-noise heightfield flattened along the road corridor; closed-loop Catmull-Rom track painted onto the terrain texture.
- `vehicle.js` — bicycle-model car physics (grip budget, drag, terrain slope gravity, grass vs asphalt surface response).
- `network.js` — thin ActionCable wrapper for `LobbyChannel`.
- `car_models.js` — Kenney Car Kit GLBs from `public/models/cars/` (CC0), assigned per player id, with a procedural box-car fallback.
- `audio.js` — Web Audio synthesized engine note + internet radio streaming.

Three.js and its addons are vendored in `vendor/javascript/` and pinned in `config/importmap.rb` (no npm/node). New game modules under `app/javascript/game/` are auto-pinned via `pin_all_from`.
