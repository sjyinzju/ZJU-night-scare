import Phaser from "phaser";
import { CampusScene } from "./game/CampusScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "preview",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0b1110",
  scene: CampusScene,
  physics: { default: "arcade", arcade: { debug: false } },
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false },
});

const timer = window.setInterval(() => {
  const scene = game.scene.getScene("CampusScene") as CampusScene | undefined;
  if (!scene?.scene.isActive()) return;
  window.clearInterval(timer);

  const camera = scene.cameras.main;
  camera.stopFollow();
  camera.setZoom(0.29);
  camera.centerOn(1160, 1060);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    dragging = true;
    lastX = pointer.x;
    lastY = pointer.y;
  });
  scene.input.on("pointerup", () => { dragging = false; });
  scene.input.on("pointerout", () => { dragging = false; });
  scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
    if (!dragging) return;
    camera.scrollX -= (pointer.x - lastX) / camera.zoom;
    camera.scrollY -= (pointer.y - lastY) / camera.zoom;
    lastX = pointer.x;
    lastY = pointer.y;
  });
  scene.input.on("wheel", (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
    camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.88 : 1.12), 0.22, 1.25));
  });
}, 40);
