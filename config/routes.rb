Rails.application.routes.draw do
  root "home#index"

  post "lobbies",       to: "lobbies#create", as: :lobbies
  post "lobbies/join",  to: "lobbies#join",   as: :join_lobbies
  get  "lobbies/:code", to: "lobbies#show",   as: :lobby

  mount ActionCable.server => "/cable"

  get "up" => "rails/health#show", as: :rails_health_check
end
