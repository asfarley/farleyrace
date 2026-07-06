module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :player_token

    def connect
      self.player_token = cookies.signed[:player_token]
      reject_unauthorized_connection if player_token.blank?
    end
  end
end
