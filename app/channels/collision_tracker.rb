# Server-authoritative car-vs-car collision detection.
#
# Physics is simulated on each client (see app/javascript/game/vehicle.js), so
# the server never owns car positions — but it *sees* every player's state at
# 15 Hz as it relays it through LobbyChannel. That's enough to detect when two
# cars overlap and to hand each client an impulse to apply to its own car,
# keeping the bump consistent for both without moving authority off the client.
#
# Each car is modelled as two circles strung along its length (not one), so a
# hit to a car's rear quarter lands off its centre of mass and imparts a spin —
# the rotational impulse is what makes a PIT manoeuvre possible. Sideways slip
# is transmitted too, so a car sliding into another carries its real momentum.
#
# State lives in-process keyed by lobby code. ActionCable here runs in a single
# Puma process (async adapter in dev, one Redis-backed container in prod), so
# every connection for a given lobby shares this instance; a mutex guards the
# concurrent state messages arriving on different connection threads.
class CollisionTracker
  BODY_OFFSET = 1.2       # circle centres sit this far fore/aft of the car centre
  CIRCLE_RADIUS = 1.05    # radius of each of a car's two body circles, metres
  RESTITUTION = 0.35      # bounciness; 0 = cars stick, 1 = perfectly elastic
  INV_MASS = 1.0          # cars are equal mass; absolute scale is arbitrary
  # Moment of inertia for a 4.2 x 2.0 m slab of unit mass: (L^2 + W^2) / 12.
  INV_INERTIA = 12.0 / (4.2**2 + 2.0**2)
  PAIR_COOLDOWN = 0.35    # s to suppress repeat impulses for the same pair
  STALE_AFTER = 3.0       # s after which a silent player is dropped

  Entry = Struct.new(:x, :z, :heading, :vx, :vz, :t)

  def self.shared
    @shared ||= new
  end

  def initialize
    @mutex = Mutex.new
    @lobbies = Hash.new { |h, k| h[k] = { players: {}, pairs: {} } }
  end

  # Record a player's latest kinematics and return the collisions this update
  # triggered. Each collision is a hash with an `:a`/`:b` correction for the two
  # players involved (linear + angular velocity delta and a de-penetration nudge,
  # all in world space).
  def update(code, id, x:, z:, heading:, speed:, lateral:)
    now = monotonic
    # Rebuild world velocity from forward speed + lateral slip so a sideways
    # slide carries its true momentum into the collision.
    fwd_x = Math.sin(heading)
    fwd_z = Math.cos(heading)
    vx = fwd_x * speed - fwd_z * lateral
    vz = fwd_z * speed + fwd_x * lateral

    @mutex.synchronize do
      lobby = @lobbies[code]
      prune(lobby, now)
      lobby[:players][id] = Entry.new(x, z, heading, vx, vz, now)

      collisions = []
      lobby[:players].each do |other_id, other|
        next if other_id == id
        hit = resolve(id, lobby[:players][id], other_id, other, lobby[:pairs], now)
        collisions << hit if hit
      end
      collisions
    end
  end

  def remove(code, id)
    @mutex.synchronize do
      lobby = @lobbies[code]
      lobby[:players].delete(id)
      lobby[:pairs].reject! { |pair, _| pair.include?(id) }
      @lobbies.delete(code) if lobby[:players].empty?
    end
  end

  def clear(code)
    @mutex.synchronize { @lobbies.delete(code) }
  end

  private

  def resolve(id_a, a, id_b, b, pairs, now)
    contact = closing_contact(a, b)
    return nil unless contact

    # One impulse per pair per cooldown: the correction takes a network round
    # trip to show up in reported positions, so without this we'd re-fire every
    # 15 Hz tick while the cars are still overlapping (and pile spin on spin).
    key = id_a < id_b ? [ id_a, id_b ] : [ id_b, id_a ]
    last = pairs[key]
    return nil if last && now - last < PAIR_COOLDOWN

    nx, nz, px, pz, vrel = contact.values_at(:nx, :nz, :px, :pz, :vrel)
    depth = contact[:depth]

    # Contact arm from each car's centre to the contact point. When the hit
    # lands off-centre, arm x normal is non-zero and the impulse spins the car.
    rax = px - a.x
    raz = pz - a.z
    rbx = px - b.x
    rbz = pz - b.z
    ran = cross(rax, raz, nx, nz) # arm-cross-normal, scalar
    rbn = cross(rbx, rbz, nx, nz)

    denom = 2 * INV_MASS + INV_INERTIA * (ran**2 + rbn**2)
    j = -(1 + RESTITUTION) * vrel / denom
    push = depth / 2.0 # split the overlap between the two cars
    pairs[key] = now

    {
      a: correction(id_a, j, ran, push, nx, nz, 1),
      b: correction(id_b, j, rbn, push, nx, nz, -1)
    }
  end

  # The deepest overlap among the four circle pairs of the two cars at which the
  # cars are actually closing, or nil. A deeper pair that's already separating
  # is skipped in favour of a shallower closing one — otherwise a glancing PIT,
  # where one circle pair separates while another bites, would be missed.
  # Returns the collision normal (from b toward a), contact point, depth, and
  # the closing speed along the normal.
  def closing_contact(a, b)
    a_circles = body_circles(a)
    b_circles = body_circles(b)
    min_dist = CIRCLE_RADIUS * 2
    best = nil

    a_circles.each do |ca|
      b_circles.each do |cb|
        dx = ca[0] - cb[0]
        dz = ca[1] - cb[1]
        dist = Math.hypot(dx, dz)
        next if dist >= min_dist

        depth = min_dist - dist
        next if best && depth <= best[:depth]

        if dist < 1e-4
          nx = 1.0
          nz = 0.0
        else
          nx = dx / dist
          nz = dz / dist
        end
        vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz
        next if vrel >= 0 # separating at this pair; not a real hit

        best = {
          nx: nx, nz: nz,
          px: (ca[0] + cb[0]) / 2.0,
          pz: (ca[1] + cb[1]) / 2.0,
          depth: depth, vrel: vrel
        }
      end
    end
    best
  end

  def body_circles(e)
    fx = Math.sin(e.heading) * BODY_OFFSET
    fz = Math.cos(e.heading) * BODY_OFFSET
    [ [ e.x + fx, e.z + fz ], [ e.x - fx, e.z - fz ] ]
  end

  # Planar cross product (treating z as the second axis): r.x*n.z - r.z*n.x.
  def cross(rx, rz, nx, nz)
    rx * nz - rz * nx
  end

  # sign is +1 for car a (impulse along +n) and -1 for car b (along -n). The
  # yaw-rate delta is negated because heading grows clockwise in this world
  # (heading increases as forward rotates from +z toward +x).
  def correction(id, j, rn, push, nx, nz, sign)
    {
      id: id,
      dvx: (sign * j * INV_MASS * nx).round(3),
      dvz: (sign * j * INV_MASS * nz).round(3),
      dw: (-sign * j * INV_INERTIA * rn).round(3),
      dx: (sign * push * nx).round(3),
      dz: (sign * push * nz).round(3)
    }
  end

  def prune(lobby, now)
    lobby[:players].reject! { |_, e| now - e.t > STALE_AFTER }
    lobby[:pairs].reject! { |_, t| now - t > STALE_AFTER }
  end

  def monotonic
    Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end
end
