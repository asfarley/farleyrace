class Player < ApplicationRecord
  COLORS = %w[#e63946 #457b9d #2a9d8f #f4a261 #9b5de5 #f15bb5 #00bbf9 #fee440].freeze

  belongs_to :lobby

  validates :token, :name, :color, presence: true

  def self.next_color(lobby)
    used = lobby.players.pluck(:color)
    COLORS.find { |c| !used.include?(c) } || COLORS[lobby.players.count % COLORS.size]
  end

  def host?
    token == lobby.host_token
  end
end
