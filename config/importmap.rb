# Pin npm packages by running ./bin/importmap

pin "application"
pin "three", to: "three.module.js" # vendored in vendor/javascript
pin "@rails/actioncable", to: "actioncable.esm.js" # ships with the actioncable gem
pin_all_from "app/javascript/game", under: "game"
