class LobbyChannel < ApplicationCable::Channel
  def subscribed
    @lobby = Lobby.find_by_code(params[:code])
    @player = @lobby&.players&.find_by(token: player_token)
    return reject if @lobby.nil? || @player.nil?

    stream_from stream_name
    @player.update!(connected: true)
    @lobby.broadcast_roster
  end

  def unsubscribed
    return if @player.nil?

    @player.update!(connected: false)
    promote_new_host if @player.host?
    @lobby.reload.broadcast_roster
  end

  # High-frequency vehicle state relay. Not persisted; fanned out to the
  # other players who run interpolation on it. The lobby row is cached from
  # subscribe time, so re-check the DB until we've seen the race start (a
  # page reload re-subscribes, so the cached answer can't go stale the other
  # way mid-race).
  def state(data)
    return if @lobby.nil?

    @racing = @lobby.reload.racing? unless @racing
    return unless @racing

    @lobby.broadcast(type: "state", id: @player.id, s: data["s"])
  end

  def start_race(_data = {})
    return unless @player.host? && @lobby.reload.waiting?
    return if @lobby.players.where(connected: true).count < 1

    starts_at = 4.seconds.from_now
    @lobby.update!(status: "racing", race_started_at: starts_at)
    @lobby.broadcast(type: "countdown", starts_at_ms: (starts_at.to_f * 1000).to_i, total_laps: Lobby::TOTAL_LAPS)
  end

  # Client reports crossing the finish line; server owns lap counts,
  # finish order, and race completion.
  def lap(_data = {})
    return unless @lobby&.reload&.racing? && @player.finish_position.nil?

    @player.increment!(:lap)
    if @player.lap >= Lobby::TOTAL_LAPS
      position = @lobby.players.where.not(finish_position: nil).count + 1
      time_ms = ((Time.current - @lobby.race_started_at) * 1000).to_i
      @player.update!(finish_position: position, finish_time_ms: time_ms)
      @lobby.broadcast(type: "finished", id: @player.id, position: position, time_ms: time_ms, name: @player.name)
      finish_race if @lobby.players.where(connected: true, finish_position: nil).none?
    else
      @lobby.broadcast(type: "lap", id: @player.id, lap: @player.lap)
    end
  end

  def back_to_lobby(_data = {})
    return unless @player.host?

    @lobby.reload.reset_race!
    @lobby.broadcast(type: "race_reset")
    @lobby.broadcast_roster
  end

  private

  def stream_name
    "lobby_#{@lobby.code}"
  end

  def finish_race
    @lobby.update!(status: "finished")
    results = @lobby.players.where.not(finish_position: nil).order(:finish_position).map do |p|
      { id: p.id, name: p.name, color: p.color, position: p.finish_position, time_ms: p.finish_time_ms }
    end
    @lobby.broadcast(type: "race_over", results: results)
  end

  def promote_new_host
    successor = @lobby.players.where(connected: true).where.not(id: @player.id).order(:created_at).first
    @lobby.update!(host_token: successor&.token || @lobby.host_token)
  end
end
