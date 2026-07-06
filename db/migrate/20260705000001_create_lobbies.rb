class CreateLobbies < ActiveRecord::Migration[8.1]
  def change
    create_table :lobbies do |t|
      t.string :code, null: false
      t.integer :seed, null: false
      t.string :status, null: false, default: "waiting"
      t.string :host_token
      t.datetime :race_started_at
      t.timestamps
    end
    add_index :lobbies, :code, unique: true
  end
end
