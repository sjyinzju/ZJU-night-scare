import * as THREE from "three";
import { assetUrl } from "../assetPath";
import { playLibraryThunder, playTheaterLightOff, startLibraryStorm, stopLibraryStorm } from "../audio/proceduralAudio";
import type { AABB } from "./buildRoom";
import {
  THEATER_MAIN_DOOR_VISUAL_NAME,
  THEATER_BACKSTAGE_DOOR_VISUAL_NAME,
  THEATER_BACKSTAGE_REAR_DOOR_VISUAL_NAME,
  theaterFloorHeightAt,
  type TheaterGameplayMeta,
  type TheaterModal,
  type TheaterSnapshot,
  type TheaterStage,
} from "./theaterData";
import { groundTheaterActor } from "./theaterGeometry";

interface TheaterGameplayRuntimeOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Object3D;
  meta: TheaterGameplayMeta;
  ghost: THREE.Object3D;
  photoFrame: THREE.Object3D;
  ambientLight: THREE.AmbientLight;
  fillLight: THREE.HemisphereLight;
  nearFillLight: THREE.PointLight;
  setPaused: (paused: boolean) => void;
  getCameraLook: () => { yaw: number; pitch: number };
  setCameraLook: (yaw: number, pitch: number) => void;
  setLookInputLocked: (locked: boolean) => void;
  onPickup: (itemId: string, name: string) => void;
  onModal: (modal: TheaterModal) => void;
  onStateChange: (snapshot: TheaterSnapshot) => void;
  onChaseHit: () => void;
}

const distanceSquared = (a: THREE.Vector3, b: { x: number; z: number }) => (
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2
);

function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();
  });
}

function setOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 0.98;
      material.needsUpdate = true;
    }
  });
}

function prepareFilmMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.side = THREE.DoubleSide;
      if (material instanceof THREE.MeshStandardMaterial) {
        // Keep the imported prop physical and readable under the foyer's red
        // tubes without adding the old floating objective sphere.
        material.color.lerp(new THREE.Color(0x8b8178), 0.24);
        material.emissive.setHex(0x210305);
        material.emissiveIntensity = 0.22;
      }
      material.needsUpdate = true;
    }
  });
}

function makeGlow(color: number, radius = 0.16): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  mesh.renderOrder = 12;
  return mesh;
}

function makeDoorCollider(meta: TheaterGameplayMeta["mainDoor"], isActive: () => boolean): AABB {
  const rotated = Math.abs(Math.sin(meta.yaw ?? 0)) > 0.5;
  const halfX = (rotated ? meta.depth : meta.width) * 0.5;
  const halfZ = (rotated ? meta.width : meta.depth) * 0.5;
  return {
    minX: meta.x - halfX,
    maxX: meta.x + halfX,
    minZ: meta.z - halfZ,
    maxZ: meta.z + halfZ,
    isActive,
  };
}

function makeFoyerColliders(meta: TheaterGameplayMeta): AABB[] {
  const bounds = meta.foyerBounds;
  const thickness = 0.28;
  return [
    { minX: bounds.minX - thickness, maxX: bounds.minX + thickness, minZ: bounds.minZ, maxZ: bounds.dividerZ },
    { minX: bounds.maxX - thickness, maxX: bounds.maxX + thickness, minZ: bounds.minZ, maxZ: bounds.dividerZ },
    { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ - thickness, maxZ: bounds.minZ + thickness },
    { minX: bounds.minX, maxX: bounds.doorwayMinX, minZ: bounds.dividerZ - thickness, maxZ: bounds.dividerZ + thickness },
    { minX: bounds.doorwayMaxX, maxX: bounds.maxX, minZ: bounds.dividerZ - thickness, maxZ: bounds.dividerZ + thickness },
  ];
}

export class TheaterGameplayRuntime {
  readonly colliders: AABB[];

  private readonly options: TheaterGameplayRuntimeOptions;
  private readonly meta: TheaterGameplayMeta;
  private stage: TheaterStage = "foyer-reel";
  private elapsed = 0;
  private stageElapsed = 0;
  private chaseHit = false;
  private lastSnapshotKey = "";
  private readonly filmObject: THREE.Object3D;
  private readonly mirrorGuideLight = new THREE.PointLight(0xff0718, 0, 3.2, 1.9);
  private readonly consoleGlow = makeGlow(0xb80513, 0.13);
  private readonly audienceGlow = makeGlow(0xff1428, 0.2);
  private readonly backstageDoor: THREE.Object3D;
  private readonly backstageRearDoor: THREE.Object3D;
  /** Authored door-leaf meshes filling the foyer doorway; follow mainDoor. */
  private readonly mainDoorMeshes: THREE.Object3D[] = [];
  private readonly stageFlashPlane: THREE.Mesh;
  private readonly projectionPlane: THREE.Mesh;
  private readonly mirrorLights: THREE.PointLight[] = [];
  private readonly stageLights: THREE.SpotLight[] = [];
  private readonly stageTargets: THREE.Object3D[] = [];
  private readonly environmentFixtureGroup = new THREE.Group();
  private readonly environmentLights: Array<{
    zone: "foyer" | "backstage" | "hall";
    row: number;
    light: THREE.PointLight;
    baseIntensity: number;
  }> = [];
  private readonly environmentPanelMaterials = new Map<"foyer" | "backstage" | "hall", Map<number, THREE.MeshBasicMaterial>>();
  private readonly hallRows: number[] = [];
  private readonly lightningLight: THREE.PointLight;
  private readonly ghost: THREE.Object3D;
  private readonly ghostFootOffset: number;
  private readonly photoFrame: THREE.Object3D;
  private projectionTexture?: THREE.Texture;
  private pendingProjectionTexture?: THREE.Texture;
  private projectionFade: "idle" | "out" | "in" = "idle";
  private projectionFadeElapsed = 0;
  private projectionFadeStartOpacity = 0.96;
  private projectionRequestId = 0;
  private stageFlashTexture?: THREE.Texture;
  private nextLightningAt = 2.2;
  private lightningUntil = 0;
  private stormActive = true;
  private blackoutRowsOff = 0;
  private cameraAlignStartYaw = 0;
  private cameraAlignStartPitch = 0;
  private cameraAlignTargetYaw = 0;
  private cameraAlignTargetPitch = 0;
  private finaleViewLocked = false;
  private disposed = false;
  private mainDoorClosed = true;

  constructor(options: TheaterGameplayRuntimeOptions) {
    this.options = options;
    this.meta = options.meta;
    const authoredFilm = options.root.getObjectByName(options.meta.film.objectName);
    if (authoredFilm) authoredFilm.visible = false;
    this.filmObject = authoredFilm?.clone(true) ?? this.makeFilmFallback();
    this.filmObject.name = "theater_film_reel_runtime";
    cloneMaterials(this.filmObject);
    prepareFilmMaterials(this.filmObject);
    options.scene.add(this.filmObject);
    this.placeFilmOnCounter();
    this.filmObject.visible = true;

    const backstageDoor = options.root.getObjectByName(THEATER_BACKSTAGE_DOOR_VISUAL_NAME);
    if (!backstageDoor) throw new Error("Theater authored backstage door was not preserved");
    this.backstageDoor = backstageDoor;
    const backstageRearDoor = options.root.getObjectByName(THEATER_BACKSTAGE_REAR_DOOR_VISUAL_NAME);
    if (!backstageRearDoor) throw new Error("Theater authored backstage rear door was not preserved");
    this.backstageRearDoor = backstageRearDoor;
    this.collectMainDoorMeshes();
    this.setMainDoorVisible(true);
    this.backstageDoor.visible = true;
    this.backstageRearDoor.visible = true;

    this.consoleGlow.position.set(options.meta.consoleSwitch.x, options.meta.consoleSwitch.y, options.meta.consoleSwitch.z);
    this.mirrorGuideLight.position.set(options.meta.mirror.x, options.meta.mirror.y, options.meta.mirror.z);
    this.audienceGlow.position.set(options.meta.audienceCenter.x, options.meta.audienceCenter.y, options.meta.audienceCenter.z);
    this.consoleGlow.visible = false;
    this.audienceGlow.visible = false;
    options.scene.add(this.consoleGlow, this.mirrorGuideLight, this.audienceGlow);

    this.stageFlashPlane = this.makeImagePlane(options.meta.stageFlash.width, options.meta.stageFlash.height);
    this.stageFlashPlane.position.set(options.meta.stageFlash.x, options.meta.stageFlash.y, options.meta.stageFlash.z);
    this.stageFlashPlane.rotation.y = options.meta.stageFlash.yaw ?? 0;
    this.stageFlashPlane.visible = false;
    options.scene.add(this.stageFlashPlane);
    this.loadTexture(options.meta.stageFlash.image).then((texture) => {
      if (this.disposed) {
        texture.dispose();
        return;
      }
      this.stageFlashTexture = texture;
      (this.stageFlashPlane.material as THREE.MeshBasicMaterial).map = texture;
      (this.stageFlashPlane.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }).catch(() => undefined);

    this.projectionPlane = this.makeImagePlane(options.meta.projection.width, options.meta.projection.height);
    this.projectionPlane.position.set(options.meta.projection.x, options.meta.projection.y, options.meta.projection.z);
    this.projectionPlane.rotation.y = options.meta.projection.yaw ?? 0;
    this.projectionPlane.visible = false;
    (this.projectionPlane.material as THREE.MeshBasicMaterial).opacity = 0;
    options.scene.add(this.projectionPlane);

    for (const point of options.meta.mirrorBulbs) {
      const light = new THREE.PointLight(0xffd0a8, 0, 3.2, 1.9);
      light.position.set(point.x, point.y, point.z);
      // Register all ten lights once. Switching .visible for each bulb
      // recompiles the scene shaders for ten different NUM_POINT_LIGHTS values.
      light.visible = true;
      this.mirrorLights.push(light);
      options.scene.add(light);
    }

    this.createEnvironmentLighting();

    this.ghost = options.ghost;
    cloneMaterials(this.ghost);
    this.ghost.position.set(options.meta.ghost.x, options.meta.ghost.y, options.meta.ghost.z);
    this.ghost.rotation.y = options.meta.ghost.yaw ?? 0;
    this.ghostFootOffset = groundTheaterActor(this.ghost, this.floorAt(options.meta.ghost.x, options.meta.ghost.z));
    this.ghost.visible = false;
    setOpacity(this.ghost, 0.12);
    options.scene.add(this.ghost);

    this.photoFrame = options.photoFrame;
    this.photoFrame.position.set(options.meta.photoFrame.x, options.meta.photoFrame.y, options.meta.photoFrame.z);
    this.photoFrame.rotation.y = options.meta.photoFrame.yaw ?? 0;
    this.photoFrame.scale.multiplyScalar(options.meta.photoFrame.scale ?? 1);
    this.photoFrame.visible = false;
    options.scene.add(this.photoFrame);

    this.lightningLight = new THREE.PointLight(0xeaf4ff, 0, 36, 1.25);
    this.lightningLight.position.set(options.meta.spawn.x, 4.8, options.meta.spawn.z - 3);
    options.scene.add(this.lightningLight);

    this.colliders = [
      ...makeFoyerColliders(options.meta),
      makeDoorCollider(options.meta.mainDoor, () => this.mainDoorClosed),
      makeDoorCollider(options.meta.backstageDoor, () => this.backstageDoor.visible),
      makeDoorCollider(options.meta.backstageRearDoor, () => this.backstageRearDoor.visible),
    ];

    options.camera.position.set(options.meta.spawn.x, options.meta.spawn.y, options.meta.spawn.z);
    startLibraryStorm();
    this.emitSnapshot();
  }

  get currentStage(): TheaterStage {
    return this.stage;
  }

  get interactionHint(): string {
    if (this.stage === "foyer-reel") return "门厅前台桌面上有一盒仍在转动的胶片";
    if (this.stage === "backstage-dark") return "控制台上有一个微红的开关 — 按 E";
    if (this.stage === "mirror-target") return "查看梳妆台相框中的镜像 — 按 E";
    if (this.stage === "cut-song-target") return "控制台缓存了一段被剪过的唱词 — 按 E";
    if (this.stage === "chase") return "别回头，逃回主剧场";
    if (this.stage === "audience-target") return "站到观众席中央的红点上";
    return "";
  }

  update(dt: number, player: THREE.Vector3, interactPressed: boolean): boolean {
    this.elapsed += dt;
    this.stageElapsed += dt;
    this.updateStorm();
    this.updatePulses(player);
    this.updateMirrorLights();
    this.updateProjectionFade(dt);
    if (this.stage === "camera-align") this.updateCameraAlignment();
    else if (this.finaleViewLocked) {
      this.options.setCameraLook(this.cameraAlignTargetYaw, this.cameraAlignTargetPitch);
    }
    if (this.stage === "light-shutdown") this.updateLightShutdown();

    if (this.stage === "foyer-reel" && this.near(player, this.meta.film, interactPressed)) {
      this.filmObject.visible = false;
      this.setStage("foyer-story");
      this.options.onPickup("film_reel", "苏婉旧胶片");
      this.openModal("foyer");
      return true;
    }

    // Crossing the threshold's z-plane covers the full doorway width, so
    // players cutting straight toward the mirror cannot slip past a small
    // round trigger and leave the stage flash / door seal unfired.
    if (this.stage === "main-hall" && player.z > this.meta.mainHallThreshold.z) {
      this.stopFoyerStorm();
      this.stageFlashPlane.visible = true;
      // The player is ~1 m clear of the door collider here: the foyer door
      // that vanished with the film reappears behind them, sealing the hall.
      this.setMainDoorVisible(true);
      // Design §5: the backstage mirror starts its dim red pulse as soon as
      // the hall flash fires, and the minimap dot already points at it.
      this.backstageDoor.visible = false;
      this.mirrorGuideLight.intensity = 1.15;
      this.setStage("backstage-approach");
    }
    if (
      this.stage === "backstage-approach"
      && player.z >= this.meta.audienceCenter.z
    ) this.stageFlashPlane.visible = false;

    // Seal only once the player is fully east of the door collider. The old
    // proximity radius reached 0.65 m west of the doorway, so a straight
    // approach slammed the door in the player's face and locked the console
    // target away on the unreachable side.
    if (this.stage === "backstage-approach"
      && player.x > this.meta.backstageDoor.x + 0.45
      && Math.abs(player.z - this.meta.backstageDoor.z) < this.meta.backstageDoor.width * 0.5) {
      this.backstageDoor.visible = true;
      this.ghost.visible = true;
      this.setBackstageDarkness();
      // Design §6.2: sealing the door kills the mirror glow; the red target
      // moves to the console switch.
      this.mirrorGuideLight.intensity = 0;
      this.consoleGlow.visible = true;
      this.setStage("backstage-dark");
    } else if (this.stage === "backstage-dark" && this.near(player, this.meta.consoleSwitch, interactPressed)) {
      this.consoleGlow.visible = false;
      this.photoFrame.visible = true;
      this.setStage("mirror-target");
      return true;
    } else if (this.stage === "mirror-target" && this.near(player, this.meta.mirror, interactPressed)) {
      this.setStage("mirror-sequence");
      this.openModal("mirror");
      return true;
    } else if (this.stage === "cut-song-target" && this.near(player, this.meta.consoleSwitch, interactPressed)) {
      this.consoleGlow.visible = false;
      this.setStage("cut-song-story");
      this.openModal("cut-song");
      return true;
    }

    if (this.stage === "chase") this.updateChase(dt, player);
    if (this.stage === "audience-target" && this.near(player, this.meta.audienceCenter, false)) {
      this.audienceGlow.visible = false;
      this.setEnvironmentZone("foyer", false);
      this.setEnvironmentZone("backstage", false);
      this.options.setPaused(true);
      this.options.setLookInputLocked(true);
      this.blackoutRowsOff = 0;
      this.beginCameraAlignment();
    }

    this.emitSnapshot();
    return false;
  }

  completeFoyer(): void {
    if (this.stage !== "foyer-story") return;
    this.setMainDoorVisible(false);
    this.options.setPaused(false);
    this.setStage("main-hall");
  }

  completeMirror(): void {
    if (this.stage !== "mirror-sequence") return;
    this.options.setPaused(false);
    this.consoleGlow.visible = true;
    this.setStage("cut-song-target");
  }

  completeCutSong(): void {
    if (this.stage !== "cut-song-story") return;
    this.options.setPaused(false);
    // Keep the entrance sealed. The intended chase route climbs both flights
    // and leaves through the highest landing into the auditorium rear-left.
    this.backstageRearDoor.visible = false;
    this.ghost.visible = true;
    setOpacity(this.ghost, 1);
    this.setEnvironmentZone("backstage", true, 0.72);
    this.setStage("chase");
  }

  beginProjection(): void {
    if (this.stage !== "blackout") return;
    this.createStageLights();
    this.setStageLightIntensity(11);
    this.projectionPlane.visible = true;
    this.setStage("projection");
  }

  showProjection(relativePath: string): void {
    if (this.stage !== "projection") return;
    const requestId = ++this.projectionRequestId;
    void this.loadTexture(relativePath).then((texture) => {
      if (this.disposed || this.stage !== "projection" || requestId !== this.projectionRequestId) {
        texture.dispose();
        return;
      }
      const material = this.projectionPlane.material as THREE.MeshBasicMaterial;
      if (!this.projectionTexture) {
        this.projectionTexture = texture;
        material.map = texture;
        material.opacity = 0;
        material.needsUpdate = true;
        this.projectionFade = "in";
        this.projectionFadeElapsed = 0;
        return;
      }
      this.pendingProjectionTexture?.dispose();
      this.pendingProjectionTexture = texture;
      this.projectionFade = "out";
      this.projectionFadeElapsed = 0;
      this.projectionFadeStartOpacity = material.opacity;
    }).catch(() => undefined);
  }

  finishProjection(): void {
    if (this.stage !== "projection") return;
    this.setStage("finale");
    this.openModal("finale");
  }

  complete(): void {
    this.setStage("complete");
  }

  /** Development-only QA helper: place the camera on the current red target. */
  debugMoveToObjective(): void {
    if (this.stage === "main-hall") {
      const atDoor = Math.abs(this.options.camera.position.x - this.meta.mainDoor.x) < 0.1;
      this.options.camera.position.x = this.meta.mainDoor.x;
      this.options.camera.position.z = atDoor ? this.meta.mainHallThreshold.z + 0.5 : this.meta.mainDoor.z - 1.4;
      return;
    }
    const objective = this.stage === "backstage-approach"
      ? this.options.meta.backstageThreshold
      : this.objective();
    if (!objective) return;
    this.options.camera.position.x = objective.x;
    this.options.camera.position.z = objective.z;
  }

  getSnapshot(): TheaterSnapshot {
    const objective = this.objective();
    return {
      stage: this.stage,
      hasFilm: this.stage !== "foyer-reel",
      mirrorLightsOn: [
        "mirror-target", "mirror-sequence", "cut-song-target", "cut-song-story", "chase",
        "audience-target", "camera-align", "light-shutdown", "blackout", "projection", "finale", "complete",
      ].includes(this.stage),
      ghostVisible: this.ghost.visible,
      objective,
      ghost: this.ghost.visible ? { x: this.ghost.position.x, z: this.ghost.position.z } : undefined,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.setLookInputLocked(false);
    stopLibraryStorm();
    this.projectionTexture?.dispose();
    this.pendingProjectionTexture?.dispose();
    this.stageFlashTexture?.dispose();
    for (const target of this.stageTargets) target.removeFromParent();
    for (const object of [
      this.filmObject,
      this.mirrorGuideLight,
      this.consoleGlow,
      this.audienceGlow,
      this.stageFlashPlane,
      this.projectionPlane,
      this.ghost,
      this.photoFrame,
      this.lightningLight,
      this.environmentFixtureGroup,
      ...this.mirrorLights,
      ...this.stageLights,
    ]) object.removeFromParent();
    for (const entry of this.environmentLights) {
      entry.light.removeFromParent();
      entry.light.dispose();
    }
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.environmentFixtureGroup.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      source.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  private setStage(stage: TheaterStage): void {
    this.stage = stage;
    this.stageElapsed = 0;
    this.emitSnapshot(true);
  }

  private openModal(modal: TheaterModal): void {
    this.options.setPaused(true);
    this.options.onModal(modal);
  }

  private near(player: THREE.Vector3, point: { x: number; z: number; radius?: number }, manual: boolean): boolean {
    const radius = (point.radius ?? 1.15) * (manual ? 1.25 : 1);
    return distanceSquared(player, point) <= radius * radius;
  }

  private objective(): { x: number; z: number } | undefined {
    if (this.stage === "foyer-reel") return this.meta.film;
    // After the film story the next beat lives backstage: a dot sitting on
    // the foyer doorway sent players searching the room they just finished.
    if (this.stage === "main-hall") return this.meta.mirror;
    if (this.stage === "backstage-approach") return this.meta.mirror;
    if (this.stage === "backstage-dark" || this.stage === "cut-song-target") return this.meta.consoleSwitch;
    if (this.stage === "mirror-target") return this.meta.mirror;
    if (this.stage === "chase") return this.meta.backstageEscape;
    if (this.stage === "audience-target") return this.meta.audienceCenter;
    return undefined;
  }

  private emitSnapshot(force = false): void {
    const snapshot = this.getSnapshot();
    const key = JSON.stringify(snapshot);
    if (!force && key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.options.onStateChange(snapshot);
  }

  private updatePulses(player: THREE.Vector3): void {
    const pulse = 0.64 + Math.sin(this.elapsed * 4.5) * 0.2;
    if (this.stage === "backstage-approach") this.mirrorGuideLight.intensity = pulse * 1.6;
    for (const glow of [this.consoleGlow, this.audienceGlow]) {
      const material = glow.material as THREE.MeshBasicMaterial;
      material.opacity = pulse;
      glow.scale.setScalar(0.92 + pulse * 0.12);
    }
    if (this.stageFlashPlane.visible) {
      const approachSpan = Math.max(0.1, this.meta.audienceCenter.z - this.meta.mainHallThreshold.z);
      const distanceFade = THREE.MathUtils.clamp(
        (this.meta.audienceCenter.z - player.z) / approachSpan,
        0,
        1,
      );
      if (distanceFade <= 0.01) {
        this.stageFlashPlane.visible = false;
        return;
      }
      const material = this.stageFlashPlane.material as THREE.MeshBasicMaterial;
      const slowPulse = (Math.sin(this.elapsed * 7.4) + 1) * 0.5;
      const sharpFlash = Math.sin(this.elapsed * 19.0) > 0.86 ? 0.22 : 0;
      material.opacity = distanceFade * (0.34 + slowPulse * 0.28 + sharpFlash);
    }
    if (this.stage === "blackout") {
      const flash = this.stageElapsed < 0.16
        ? 26
        : THREE.MathUtils.clamp(1 - (this.stageElapsed - 0.16) / 0.78, 0, 1) * 22;
      this.setStageLightIntensity(flash);
    }
  }

  private updateProjectionFade(dt: number): void {
    if (this.projectionFade === "idle") return;
    const material = this.projectionPlane.material as THREE.MeshBasicMaterial;
    this.projectionFadeElapsed += dt;
    if (this.projectionFade === "out") {
      const progress = THREE.MathUtils.clamp(this.projectionFadeElapsed / 0.42, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      material.opacity = this.projectionFadeStartOpacity * (1 - eased);
      if (progress < 1 || !this.pendingProjectionTexture) return;
      this.projectionTexture?.dispose();
      this.projectionTexture = this.pendingProjectionTexture;
      this.pendingProjectionTexture = undefined;
      material.map = this.projectionTexture;
      material.opacity = 0;
      material.needsUpdate = true;
      this.projectionFade = "in";
      this.projectionFadeElapsed = 0;
      return;
    }
    const progress = THREE.MathUtils.clamp(this.projectionFadeElapsed / 0.58, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    material.opacity = 0.96 * eased;
    if (progress >= 1) this.projectionFade = "idle";
  }

  private beginCameraAlignment(): void {
    const currentLook = this.options.getCameraLook();
    const target = this.meta.stageLightTarget;
    const dx = target.x - this.options.camera.position.x;
    const dz = target.z - this.options.camera.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    const shortestYawDelta = Math.atan2(
      Math.sin(targetYaw - currentLook.yaw),
      Math.cos(targetYaw - currentLook.yaw),
    );
    const horizontalDistance = Math.max(0.01, Math.hypot(dx, dz));
    this.cameraAlignStartYaw = currentLook.yaw;
    this.cameraAlignStartPitch = currentLook.pitch;
    this.cameraAlignTargetYaw = currentLook.yaw + shortestYawDelta;
    this.cameraAlignTargetPitch = THREE.MathUtils.clamp(
      Math.atan2(target.y - this.options.camera.position.y, horizontalDistance),
      -0.16,
      0.08,
    );
    this.finaleViewLocked = true;
    this.setStage("camera-align");
  }

  private updateCameraAlignment(): void {
    const duration = 1.35;
    const progress = THREE.MathUtils.clamp(this.stageElapsed / duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    this.options.setCameraLook(
      THREE.MathUtils.lerp(this.cameraAlignStartYaw, this.cameraAlignTargetYaw, eased),
      THREE.MathUtils.lerp(this.cameraAlignStartPitch, this.cameraAlignTargetPitch, eased),
    );
    if (progress >= 1) {
      this.options.setCameraLook(this.cameraAlignTargetYaw, this.cameraAlignTargetPitch);
      this.setStage("light-shutdown");
    }
  }

  private updateLightShutdown(): void {
    const targetRowsOff = Math.min(
      this.hallRows.length,
      Math.floor(this.stageElapsed / 1.5) + 1,
    );
    while (this.blackoutRowsOff < targetRowsOff) {
      const row = this.hallRows[this.blackoutRowsOff];
      this.setHallRow(row, false);
      playTheaterLightOff(this.blackoutRowsOff);
      this.blackoutRowsOff += 1;
    }
    const allRowsOffAt = Math.max(0, this.hallRows.length - 1) * 1.5;
    if (this.blackoutRowsOff === this.hallRows.length && this.stageElapsed >= allRowsOffAt + 0.38) {
      this.createStageLights();
      this.setStage("blackout");
      this.openModal("blackout");
    }
  }

  private updateMirrorLights(): void {
    if (this.stage !== "mirror-target") return;
    const litCount = Math.min(this.mirrorLights.length, Math.floor(this.stageElapsed / 0.25) + 1);
    for (let index = 0; index < this.mirrorLights.length; index++) {
      const light = this.mirrorLights[index];
      light.intensity = index < litCount ? 1.15 : 0;
    }
  }

  private updateChase(dt: number, player: THREE.Vector3): void {
    const backstageMinX = this.meta.backstageEscape.backstageMinX;
    if (player.x < backstageMinX) {
      this.ghost.visible = false;
      this.audienceGlow.visible = true;
      this.setStage("audience-target");
      return;
    }
    // A caught player can still leave; contact does not restart the chase or
    // charge sanity again. The exit objective remains until they cross out.
    if (this.chaseHit) return;
    const dx = player.x - this.ghost.position.x;
    const dz = player.z - this.ghost.position.z;
    const distance = Math.hypot(dx, dz);
    const speed = Math.min(2.85, 2.25 + this.stageElapsed * 0.035);
    if (distance > 0.01) {
      this.ghost.position.x += (dx / distance) * speed * dt;
      this.ghost.position.z += (dz / distance) * speed * dt;
      this.ghost.rotation.y = Math.atan2(dx, dz);
      this.ghost.position.y = this.floorAt(this.ghost.position.x, this.ghost.position.z) + this.ghostFootOffset;
    }
    if (distance < 0.86) {
      this.chaseHit = true;
      this.ghost.visible = false;
      this.options.onChaseHit();
    }
  }

  private floorAt(x: number, z: number): number {
    return theaterFloorHeightAt(x, z, this.meta.walkableSurfaces);
  }

  private setBackstageDarkness(): void {
    this.setEnvironmentZone("backstage", false);
    this.options.ambientLight.intensity = 0.035;
    this.options.fillLight.intensity = 0.025;
    this.options.nearFillLight.intensity = 0.08;
  }

  private createEnvironmentLighting(): void {
    this.environmentFixtureGroup.name = "theater_red_ceiling_fixtures";
    const housingMaterial = new THREE.MeshStandardMaterial({
      color: 0x24171a,
      roughness: 0.72,
      metalness: 0.34,
    });
    const tubeHousingGeometry = new THREE.BoxGeometry(1.9, 0.12, 0.4);
    const tubePanelGeometry = new THREE.BoxGeometry(1.62, 0.035, 0.14);
    const squareHousingGeometry = new THREE.BoxGeometry(1.16, 0.12, 1.16);
    const squarePanelGeometry = new THREE.BoxGeometry(0.98, 0.035, 0.98);

    const addFixtures = (
      zone: "foyer" | "backstage" | "hall",
      points: TheaterGameplayMeta["lighting"]["foyerTubes"],
      shape: "tube" | "square",
      lightStride: number,
      intensity: number,
      distance: number,
    ) => {
      const rowCoordinates = zone === "hall"
        ? [...new Set(points.map(point => Number(point.z.toFixed(3))))].sort((a, b) => a - b)
        : [0];
      if (zone === "hall") this.hallRows.push(...rowCoordinates.map((_z, index) => index));
      const rowMaterials = new Map<number, THREE.MeshBasicMaterial>();
      this.environmentPanelMaterials.set(zone, rowMaterials);
      points.forEach((point, index) => {
        const row = zone === "hall"
          ? rowCoordinates.findIndex(z => Math.abs(z - point.z) < 0.01)
          : 0;
        let panelMaterial = rowMaterials.get(row);
        if (!panelMaterial) {
          panelMaterial = new THREE.MeshBasicMaterial({ color: 0xff1028, toneMapped: false });
          rowMaterials.set(row, panelMaterial);
        }
        const fixture = new THREE.Group();
        fixture.name = `theater_${zone}_${shape}_${index}`;
        fixture.position.set(point.x, point.y, point.z);
        fixture.rotation.y = point.yaw ?? 0;
        fixture.add(new THREE.Mesh(shape === "tube" ? tubeHousingGeometry : squareHousingGeometry, housingMaterial));
        const panel = new THREE.Mesh(shape === "tube" ? tubePanelGeometry : squarePanelGeometry, panelMaterial);
        panel.position.y = -0.078;
        fixture.add(panel);
        this.environmentFixtureGroup.add(fixture);

        if (index % lightStride === 0) {
          const light = new THREE.PointLight(0xff1228, intensity, distance, 1.65);
          light.name = `theater_${zone}_red_pool_${index}`;
          light.position.set(point.x, point.y - 0.32, point.z);
          this.environmentLights.push({ zone, row, light, baseIntensity: intensity });
          this.options.scene.add(light);
        }
      });
    };

    addFixtures("foyer", this.meta.lighting.foyerTubes, "tube", 2, 5.4, 10.5);
    addFixtures("backstage", this.meta.lighting.backstageTubes, "tube", 3, 4.6, 9.5);
    addFixtures("hall", this.meta.lighting.hallSquares, "square", 3, 6.2, 11.5);
    this.options.scene.add(this.environmentFixtureGroup);
  }

  private setEnvironmentZone(zone: "foyer" | "backstage" | "hall", on: boolean, factor = 1): void {
    for (const panelMaterial of this.environmentPanelMaterials.get(zone)?.values() ?? []) {
      panelMaterial.color.setHex(on ? 0xff1028 : 0x180006);
    }
    for (const entry of this.environmentLights) {
      if (entry.zone !== zone) continue;
      entry.light.intensity = on ? entry.baseIntensity * factor : 0;
    }
  }

  private setHallRow(row: number, on: boolean): void {
    this.environmentPanelMaterials.get("hall")?.get(row)?.color.setHex(on ? 0xff1028 : 0x180006);
    for (const entry of this.environmentLights) {
      if (entry.zone !== "hall" || entry.row !== row) continue;
      entry.light.intensity = on ? entry.baseIntensity : 0;
    }
  }

  private createStageLights(): void {
    if (this.stageLights.length) return;
    const targetPoint = this.meta.stageLightTarget;
    const positions = [
      [targetPoint.x - 5.8, 5.8, targetPoint.z - 3.5],
      [targetPoint.x + 5.8, 5.8, targetPoint.z - 3.5],
      [targetPoint.x, 6.4, targetPoint.z - 5.8],
      [targetPoint.x, 5.1, targetPoint.z + 2.4],
    ];
    for (const [x, y, z] of positions) {
      const target = new THREE.Object3D();
      target.position.set(targetPoint.x, targetPoint.y, targetPoint.z);
      this.options.scene.add(target);
      const light = new THREE.SpotLight(0xff0718, 0, 24, Math.PI / 9, 0.48, 1.25);
      light.position.set(x, y, z);
      light.target = target;
      this.stageTargets.push(target);
      this.stageLights.push(light);
      this.options.scene.add(light);
    }
    this.options.ambientLight.color.setHex(0x220005);
    this.options.ambientLight.intensity = 0.12;
  }

  private setStageLightIntensity(intensity: number): void {
    for (const light of this.stageLights) light.intensity = intensity;
  }

  private updateStorm(): void {
    if (!this.stormActive) return;
    if (this.elapsed >= this.nextLightningAt) {
      this.lightningUntil = this.elapsed + 0.18;
      this.nextLightningAt = this.elapsed + 8 + Math.random() * 10;
      playLibraryThunder(0.12 + Math.random() * 0.16);
      window.dispatchEvent(new CustomEvent("zju-horror-theater-lightning", { detail: { active: true, duration: 190 } }));
    }
    this.lightningLight.intensity = this.elapsed < this.lightningUntil ? 17 : 0;
  }

  private stopFoyerStorm(): void {
    if (!this.stormActive) return;
    this.stormActive = false;
    this.lightningUntil = 0;
    this.lightningLight.intensity = 0;
    stopLibraryStorm();
    window.dispatchEvent(new CustomEvent("zju-horror-theater-lightning", { detail: { active: false } }));
  }

  /** Collect only the semantic corner-door group preserved before batching. */
  private collectMainDoorMeshes(): void {
    const authoredDoor = this.options.root.getObjectByName(THEATER_MAIN_DOOR_VISUAL_NAME);
    if (authoredDoor) this.mainDoorMeshes.push(authoredDoor);
  }

  private setMainDoorVisible(visible: boolean): void {
    this.mainDoorClosed = visible;
    for (const mesh of this.mainDoorMeshes) mesh.visible = visible;
  }

  private makeImagePlane(width: number, height: number): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.renderOrder = 8;
    return mesh;
  }

  private makeFilmFallback(): THREE.Object3D {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x29272a, metalness: 0.75, roughness: 0.4 });
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.08, 28), material);
    reel.rotation.x = Math.PI / 2;
    group.add(reel);
    for (let index = 0; index < 5; index++) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 16), new THREE.MeshBasicMaterial({ color: 0x080808 }));
      const angle = index / 5 * Math.PI * 2;
      hole.position.set(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0);
      hole.rotation.x = Math.PI / 2;
      group.add(hole);
    }
    group.name = "theater_film_reel_fallback";
    return group;
  }

  private placeFilmOnCounter(): void {
    this.filmObject.position.set(0, 0, 0);
    this.filmObject.rotation.set(0, 0, 0);
    this.filmObject.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.filmObject);
    const size = bounds.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0.001 && (longest < 0.34 || longest > 0.62)) {
      this.filmObject.scale.multiplyScalar(0.48 / longest);
      this.filmObject.updateMatrixWorld(true);
      bounds.setFromObject(this.filmObject);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    this.filmObject.position.add(new THREE.Vector3(
      this.meta.film.x - center.x,
      this.meta.film.y - center.y,
      this.meta.film.z - center.z,
    ));
    this.filmObject.rotation.y = -0.28;
  }

  private loadTexture(relativePath: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        assetUrl(relativePath),
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          resolve(texture);
        },
        undefined,
        reject,
      );
    });
  }
}
