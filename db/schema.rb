# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_07_05_000002) do
  create_table "lobbies", force: :cascade do |t|
    t.string "code", null: false
    t.datetime "created_at", null: false
    t.string "host_token"
    t.datetime "race_started_at"
    t.integer "seed", null: false
    t.string "status", default: "waiting", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_lobbies_on_code", unique: true
  end

  create_table "players", force: :cascade do |t|
    t.string "color", null: false
    t.boolean "connected", default: false, null: false
    t.datetime "created_at", null: false
    t.integer "finish_position"
    t.integer "finish_time_ms"
    t.integer "lap", default: 0, null: false
    t.integer "lobby_id", null: false
    t.string "name", null: false
    t.string "token", null: false
    t.datetime "updated_at", null: false
    t.index ["lobby_id"], name: "index_players_on_lobby_id"
    t.index ["token"], name: "index_players_on_token", unique: true
  end

  add_foreign_key "players", "lobbies"
end
