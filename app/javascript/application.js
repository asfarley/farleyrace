// Entry point: boot the 3D game whenever the page carries a game shell.
const shell = document.getElementById("game-shell");
if (shell) {
  import("game/game").then(({ Game }) => new Game(shell));
}
