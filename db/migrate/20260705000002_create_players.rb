class CreatePlayers < ActiveRecord::Migration[8.1]
  def change
    create_table :players do |t|
      t.references :lobby, null: false, foreign_key: true
      t.string :token, null: false
      t.string :name, null: false
      t.string :color, null: false
      t.boolean :connected, null: false, default: false
      t.integer :lap, null: false, default: 0
      t.integer :finish_position
      t.integer :finish_time_ms
      t.timestamps
    end
    add_index :players, :token, unique: true
  end
end
