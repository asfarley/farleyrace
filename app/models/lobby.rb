class Lobby < ApplicationRecord
  TOTAL_LAPS = 3
  CODE_ALPHABET = %w[A B C D E F G H J K L M N P Q R S T U V W X Y Z 2 3 4 5 6 7 8 9].freeze

  has_many :players, dependent: :destroy

  validates :code, presence: true, uniqueness: true

  before_validation :ensure_code_and_seed, on: :create

  def self.find_by_code(code)
    find_by(code: code.to_s.strip.upcase)
  end

  def host
    players.find_by(token: host_token)
  end

  def waiting?  = status == "waiting"
  def racing?   = status == "racing"

  def roster
    players.order(:created_at).map do |p|
      {
        id: p.id,
        name: p.name,
        color: p.color,
        connected: p.connected,
        host: p.token == host_token,
        lap: p.lap,
        finish_position: p.finish_position,
        finish_time_ms: p.finish_time_ms
      }
    end
  end

  def broadcast(payload)
    ActionCable.server.broadcast("lobby_#{code}", payload)
  end

  def broadcast_roster
    broadcast(type: "roster", status: status, players: roster)
  end

  def reset_race!
    transaction do
      players.where(connected: false).destroy_all
      players.update_all(lap: 0, finish_position: nil, finish_time_ms: nil)
      update!(status: "waiting", race_started_at: nil)
    end
  end

  private

  def ensure_code_and_seed
    self.seed ||= SecureRandom.random_number(2**31)
    self.code ||= generate_unique_code
  end

  def generate_unique_code
    10.times do
      candidate = Array.new(6) { CODE_ALPHABET.sample }.join
      return candidate unless Lobby.exists?(code: candidate)
    end
    raise "could not generate a unique lobby code"
  end
end
