class LobbiesController < ApplicationController
  def create
    name = player_name
    return redirect_to root_path, alert: "Please enter a name." if name.blank?

    lobby = Lobby.create!
    player = add_player(lobby, name)
    lobby.update!(host_token: player.token)
    redirect_to lobby_path(lobby.code)
  end

  def join
    name = player_name
    return redirect_to root_path, alert: "Please enter a name." if name.blank?

    lobby = Lobby.find_by_code(params[:code])
    return redirect_to root_path, alert: "Lobby not found. Check the code." if lobby.nil?
    return redirect_to root_path, alert: "That race is already underway." unless lobby.waiting?

    add_player(lobby, name)
    redirect_to lobby_path(lobby.code)
  end

  def show
    @lobby = Lobby.find_by_code(params[:code])
    return redirect_to root_path, alert: "Lobby not found." if @lobby.nil?

    @player = @lobby.players.find_by(token: cookies.signed[:player_token])
    if @player.nil?
      # Direct link visitors get a spectator-turned-racer slot while the lobby is open.
      return redirect_to root_path(code: @lobby.code), alert: "Enter a name to join lobby #{@lobby.code}." unless @lobby.waiting?
      return redirect_to root_path(code: @lobby.code) if cookies.signed[:player_name].blank?

      @player = add_player(@lobby, cookies.signed[:player_name])
    end
  end

  private

  def player_name
    params[:name].to_s.strip.first(20)
  end

  def add_player(lobby, name)
    token = SecureRandom.hex(16)
    player = lobby.players.create!(token: token, name: name, color: Player.next_color(lobby))
    cookies.signed[:player_token] = { value: token, expires: 1.day }
    cookies.signed[:player_name] = { value: name, expires: 1.day }
    player
  end
end
