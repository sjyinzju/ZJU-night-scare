import Phaser from "phaser";
import {
  campusBuildings,
  campusRoads,
  campusPlazas,
  campusWaters,
  type CampusBuilding,
  type IsoPoint,
} from "./mapData";
import {
  ambientEvents,
  buildingThemes,
  defaultStoryStage,
  fogLayers,
  horrorZones,
  lightSources,
  stageProfiles,
  type StoryStage,
} from "./horrorConfig";
import { storyHotspots, type HorrorEffect, type HotspotId, type StoryHotspot, type StorySceneId } from "./storyData";

const TILE_W = 96;
const TILE_H = 48;
const ORIGIN_X = 980;
const ORIGIN_Y = 120;
const MAP_W = 42;
const MAP_D = 34;
const PLAYER_SPEED = 4.2;
const ROAD_SNAP_RADIUS = 0.72;
const JUNCTION_RADIUS = 1.5;
const WORLD_BOUNDS = { x: -1200, y: 0, width: 4300, height: 2200 };
const GHOST_SPEED = 2.15;
const GHOST_CLOSE_RADIUS = 1.65;
const GHOST_CAUGHT_RADIUS = 0.55;
const GHOST_SANITY_COOLDOWN = 2200;
const GHOST_ROUTE_REFRESH_INTERVAL = 1350;
const GHOST_SPAWN_DELAY = 5200;
const GHOST_MIN_SPAWN_DISTANCE = 13;
const GHOST_MIN_SPAWN_ROUTE_DISTANCE = 22;

type KeySet = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  e: Phaser.Input.Keyboard.Key;
};

type InputVector = {
  screen: IsoPoint;
  iso: IsoPoint;
};

type RoadProjection = {
  point: IsoPoint;
  distance: number;
  roadId: string;
  segmentIndex: number;
  segmentStart: IsoPoint;
  segmentEnd: IsoPoint;
  direction: IsoPoint;
  screenDirection: IsoPoint;
  length: number;
  t: number;
};

type BuildingScreenShape = {
  a: IsoPoint;
  east: IsoPoint;
  south: IsoPoint;
  far: IsoPoint;
  topA: IsoPoint;
  topEast: IsoPoint;
  topSouth: IsoPoint;
  topFar: IsoPoint;
  height: number;
};

type HotspotMarker = {
  container: Phaser.GameObjects.Container;
  beam: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Ellipse;
  core: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  arrow: Phaser.GameObjects.Text;
};

type MapStateEvent = {
  guideHotspotId: HotspotId;
  completedHotspotIds: HotspotId[];
  visitedHotspotIds: HotspotId[];
  sanity: number;
  activeStory: boolean;
};

type RouteEdge = {
  to: number;
  distance: number;
};

type GhostState = {
  container: Phaser.GameObjects.Container;
  aura: Phaser.GameObjects.Arc;
  body: Phaser.GameObjects.Ellipse;
  head: Phaser.GameObjects.Arc;
  iso: IsoPoint;
  route: IsoPoint[];
  routeIndex: number;
  lastRouteAt: number;
  lastSanityHitAt: number;
  nextSpawnAt: number;
  shouldRespawn: boolean;
};

export type GameMiniMapEvent = {
  player: IsoPoint;
  ghost?: IsoPoint;
  ghostVisible: boolean;
};

export type GameHudEvent = {
  place: string;
  prompt: string;
  activeHotspotId?: HotspotId;
};

export type HorrorAtmosphereEvent = {
  timeLabel: string;
  statusLabel: string;
  stage: StoryStage;
  stageName: string;
  realityDistortion: number;
};

export class CampusScene extends Phaser.Scene {
  private keys?: KeySet;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Ellipse;
  private flashlight!: Phaser.GameObjects.Triangle;
  private playerIso = { x: 16.2, y: 30.6 };
  private groundDecalLayer!: Phaser.GameObjects.Graphics;
  private lightLayer!: Phaser.GameObjects.Graphics;
  private foregroundShadowLayer!: Phaser.GameObjects.Graphics;
  private fog!: Phaser.GameObjects.Graphics;
  private lakeMist!: Phaser.GameObjects.Graphics;
  private delayedReflection!: Phaser.GameObjects.Ellipse;
  private medicalSixthWindow?: Phaser.GameObjects.Rectangle;
  private medicalSilhouette?: Phaser.GameObjects.Container;
  private medicalFootTrace?: Phaser.GameObjects.Container;
  private mirrorGlitch?: Phaser.GameObjects.Rectangle;
  private warehouseShadow?: Phaser.GameObjects.Container;
  private lakeExtraFigure?: Phaser.GameObjects.Container;
  private baisha216Window?: Phaser.GameObjects.Rectangle;
  private buildingLabels = new Map<string, Phaser.GameObjects.Text>();
  private storyStage: StoryStage = defaultStoryStage;
  private realityDistortion = stageProfiles[defaultStoryStage].baseDistortion;
  private statusLabel = "校园静默";
  private timeLabel = "00:47";
  private lastAtmosphereEmit = 0;
  private medicalVisitCount = 0;
  private wasNearMedical = false;
  private eventFlags = new Set<string>();
  private ghostWallCooldown = 0;
  private lastFacing = { x: 1, y: 0 };
  private lockedMoveDir: IsoPoint | null = null;
  private lockedScreenDir: IsoPoint | null = null;
  private activeHotspot?: StoryHotspot;
  private completedHotspots = new Set<HotspotId>();
  private visitedHotspots = new Set<HotspotId>();
  private guideHotspotId: HotspotId = "library";
  private lastInteract = 0;
  private lastHudSignature = "";
  private guideLine!: Phaser.GameObjects.Graphics;
  private effectFlash!: Phaser.GameObjects.Rectangle;
  private storyOpen = false;
  private sanity = 100;
  private dead = false;
  private ghost?: GhostState;
  private lastMiniMapAt = 0;
  private sceneReady = false;
  private hotspotMarkers = new Map<HotspotId, HotspotMarker>();
  private lightBeams: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super("CampusScene");
  }

  create() {
    this.sceneReady = true;
    this.cameras.main.setBackgroundColor("#0b1110");
    this.physics.world.setBounds(WORLD_BOUNDS.x, WORLD_BOUNDS.y, WORLD_BOUNDS.width, WORLD_BOUNDS.height);
    this.drawGround();
    this.drawSwampField();
    this.drawWater();
    this.drawLakeMemoryEffects();
    this.drawPlazas();
    this.drawRoads();
    this.drawGroundDecals();
    this.drawGreenery();
    this.drawBuildings();
    this.drawStoryProps();
    this.drawTaskMarkers();
    this.drawLightLayer();
    this.drawLampPosts();
    this.drawMapAnomalies();
    this.drawOrientationLabels();
    this.drawForegroundShadows();
    this.drawHorrorApparitions();
    this.snapPlayerToRoad();
    this.createPlayer();
    this.createGuideLine();
    this.createGhost();
    this.createFog();
    this.createScreenEffects();

    this.keys = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      e: Phaser.Input.Keyboard.KeyCodes.E,
    }) as KeySet;

    this.cameras.main.setBounds(WORLD_BOUNDS.x, WORLD_BOUNDS.y, WORLD_BOUNDS.width, WORLD_BOUNDS.height);
    this.cameras.main.setZoom(1);
    this.cameras.main.startFollow(this.player, false, 0.22, 0.22);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    window.addEventListener("zju-horror-map-state", this.handleMapState as EventListener);
    window.addEventListener("zju-horror-effect", this.handleHorrorEffect as EventListener);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.sceneReady = false;
      window.removeEventListener("zju-horror-map-state", this.handleMapState as EventListener);
      window.removeEventListener("zju-horror-effect", this.handleHorrorEffect as EventListener);
    });

    this.emitHud("", "沿红色虚线路线前进，绕开红鬼。");
  }

  update(time: number) {
    this.movePlayer();
    this.updateGhost(time);
    this.updateDepth();
    this.updatePlayerLight(time);
    this.updateAtmosphere(time);
    this.updateHotspotRange(time);
    this.updateGuideLine(time);
    this.updateFog(time);
    this.emitMiniMap(time);
  }

  private toScreen(point: IsoPoint) {
    return {
      x: ORIGIN_X + (point.x - point.y) * (TILE_W / 2),
      y: ORIGIN_Y + (point.x + point.y) * (TILE_H / 2),
    };
  }

  private drawDiamond(graphics: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha = 1) {
    const p = this.toScreen({ x, y });
    graphics.fillStyle(color, alpha);
    graphics.lineStyle(1, 0x1d2c27, 0.18);
    graphics.beginPath();
    graphics.moveTo(p.x, p.y - TILE_H / 2);
    graphics.lineTo(p.x + TILE_W / 2, p.y);
    graphics.lineTo(p.x, p.y + TILE_H / 2);
    graphics.lineTo(p.x - TILE_W / 2, p.y);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  }

  private drawGround() {
    const g = this.add.graphics();
    for (let y = 0; y < MAP_D; y += 1) {
      for (let x = 0; x < MAP_W; x += 1) {
        const base = (x + y) % 4 === 0 ? 0x13231e : 0x101d19;
        const stain = (x * 17 + y * 29) % 11 === 0 ? 0x1a2a24 : base;
        const edge = x < 2 || y < 2 || x > MAP_W - 4 || y > MAP_D - 4 ? 0x08110f : stain;
        this.drawDiamond(g, x, y, edge, 1);
      }
    }
    g.setDepth(0);
  }

  private drawSwampField() {
    const zone = horrorZones.swamp;
    const g = this.add.graphics();
    const center = this.toScreen(zone.center);
    g.fillStyle(0x07100d, 0.72);
    g.fillEllipse(center.x - 12, center.y + 28, 430, 190);
    g.fillStyle(0x101711, 0.55);
    g.fillEllipse(center.x - 48, center.y - 18, 300, 105);

    const pools = [
      { x: 3.7, y: 25.6, w: 96, h: 24 },
      { x: 5.2, y: 27.8, w: 138, h: 34 },
      { x: 6.8, y: 30.0, w: 112, h: 28 },
      { x: 3.9, y: 29.1, w: 74, h: 20 },
    ];
    pools.forEach((pool, index) => {
      const p = this.toScreen(pool);
      g.fillStyle(index % 2 ? 0x14251f : 0x0d1b18, 0.84);
      g.fillEllipse(p.x, p.y, pool.w, pool.h);
      g.lineStyle(1, 0x52665d, 0.16);
      g.strokeEllipse(p.x, p.y, pool.w, pool.h);
    });

    for (let i = 0; i < 28; i += 1) {
      const point = { x: 3.0 + (i % 7) * 0.75, y: 24.8 + Math.floor(i / 7) * 1.55 + (i % 3) * 0.2 };
      const p = this.toScreen(point);
      g.lineStyle(2, i % 3 === 0 ? 0x31423a : 0x25372f, 0.66);
      g.beginPath();
      g.moveTo(p.x, p.y + 10);
      g.lineTo(p.x + (i % 2 ? 8 : -7), p.y - 18 - (i % 4));
      g.strokePath();
    }

    const path = [
      this.toScreen({ x: 4.4, y: 30.2 }),
      this.toScreen({ x: 4.2, y: 28.2 }),
      this.toScreen({ x: 4.6, y: 26.1 }),
      this.toScreen({ x: 5.7, y: 24.7 }),
    ];
    g.lineStyle(4, 0x3d4336, 0.32);
    g.beginPath();
    path.forEach((p, index) => {
      if (index === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.strokePath();
    g.setDepth(6);

    const silhouettePoint = this.toScreen({ x: 4.7, y: 26.8 });
    const body = this.add.ellipse(silhouettePoint.x, silhouettePoint.y - 30, 18, 58, 0xdfe8e3, 0);
    body.setDepth(89);
    body.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: body,
      alpha: { from: 0, to: 0.16 },
      duration: 4200,
      delay: 1800,
      yoyo: true,
      repeat: -1,
      repeatDelay: 7200,
    });
  }

  private drawWater() {
    campusWaters.forEach((water) => {
      const g = this.add.graphics();
      const points = water.points.map((p) => this.toScreen(p));
      const isQizhenLake = water.id === "qizhen-lake";
      const waterFill = isQizhenLake ? 0x143a4a : water.color;
      const waterStroke = isQizhenLake ? 0x1e5a6a : 0x1d5660;
      g.fillStyle(this.shade(waterFill, -28), 0.94);
      g.lineStyle(4, waterStroke, isQizhenLake ? 0.56 : 0.42);
      g.beginPath();
      points.forEach((p, index) => {
        if (index === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.setDepth(12);

      if (!isQizhenLake) return;

      for (let i = 0; i < 11; i += 1) {
        const ripplePoint = { x: 16.2 + i * 0.72, y: 11.4 + Math.sin(i * 1.7) * 4.6 + i * 0.8 };
        const p = this.toScreen(ripplePoint);
        const ripple = this.add.ellipse(
          p.x,
          p.y,
          82 + (i % 3) * 24,
          14 + (i % 2) * 6,
          i % 4 === 0 ? 0x186888 : 0x105878,
          0.08,
        );
        ripple.setDepth(13);
        ripple.setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: ripple,
          alpha: { from: 0.02, to: i % 4 === 0 ? 0.24 : 0.13 },
          scaleX: { from: 0.85, to: 1.18 },
          duration: 1800 + i * 180,
          yoyo: true,
          repeat: -1,
        });
      }
    });
  }

  private drawLakeMemoryEffects() {
    const warmPoints = [
      { x: 15.8, y: 21.2 },
      { x: 17.2, y: 22.0 },
      { x: 22.9, y: 22.6 },
    ];

    warmPoints.forEach((point, index) => {
      const p = this.toScreen(point);
      const glow = this.add.ellipse(p.x, p.y - 8, 92 - index * 12, 22, 0x4898b8, 0.055);
      glow.setDepth(18);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.025, to: 0.085 },
        duration: 2400 + index * 400,
        yoyo: true,
        repeat: -1,
      });
    });

    const reflectedBlocks = [
      { x: 23.8, y: 18.0, w: 62, h: 14, color: 0x789490 },
      { x: 21.3, y: 23.1, w: 88, h: 16, color: 0x536f70 },
      { x: 17.0, y: 21.8, w: 50, h: 12, color: 0x4a6a78 },
    ];

    reflectedBlocks.forEach((item, index) => {
      const p = this.toScreen(item);
      const reflection = this.add.rectangle(p.x + 8 + index * 4, p.y + 10, item.w, item.h, item.color, 0.08);
      reflection.setDepth(18);
      reflection.setAngle(index % 2 ? -5 : 4);
      reflection.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: reflection,
        x: reflection.x + (index % 2 ? -8 : 7),
        alpha: { from: 0.03, to: 0.12 },
        duration: 3100 + index * 530,
        yoyo: true,
        repeat: -1,
      });
    });

    const figurePoint = this.toScreen({ x: 20.7, y: 22.4 });
    const skirt = this.add.triangle(0, 12, -13, 28, 13, 28, 0, -8, 0xe6e8e0, 0.0);
    const head = this.add.circle(0, -16, 7, 0xdfe4dc, 0.0);
    this.lakeExtraFigure = this.add.container(figurePoint.x, figurePoint.y - 8, [skirt, head]);
    this.lakeExtraFigure.setDepth(88);
    this.lakeExtraFigure.setBlendMode(Phaser.BlendModes.ADD);

    const hairLayer = this.add.graphics();
    hairLayer.setDepth(19);
    for (let i = 0; i < 22; i += 1) {
      const root = this.toScreen({ x: 15.2 + (i % 9) * 0.9, y: 20.6 + Math.floor(i / 9) * 0.82 });
      hairLayer.lineStyle(1 + (i % 2), 0x020506, 0.16 + (i % 3) * 0.025);
      hairLayer.beginPath();
      hairLayer.moveTo(root.x, root.y + 6);
      hairLayer.lineTo(root.x + Math.sin(i * 1.8) * 26, root.y + 18 + Math.cos(i) * 16);
      hairLayer.lineTo(root.x + Math.sin(i * 1.2) * 34, root.y + 26 + Math.sin(i) * 20);
      hairLayer.strokePath();
    }
  }

  private drawPlazas() {
    campusPlazas.forEach((plaza) => {
      const g = this.add.graphics();
      const nw = this.toScreen({ x: plaza.x, y: plaza.y });
      const ne = this.toScreen({ x: plaza.x + plaza.w, y: plaza.y });
      const se = this.toScreen({ x: plaza.x + plaza.w, y: plaza.y + plaza.d });
      const sw = this.toScreen({ x: plaza.x, y: plaza.y + plaza.d });
      g.fillStyle(this.shade(plaza.color, -38), 0.84);
      g.lineStyle(2, 0x9fb8ad, 0.1);
      g.beginPath();
      g.moveTo(nw.x, nw.y);
      g.lineTo(ne.x, ne.y);
      g.lineTo(se.x, se.y);
      g.lineTo(sw.x, sw.y);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.setDepth(14);

      const center = this.toScreen({ x: plaza.x + plaza.w / 2, y: plaza.y + plaza.d / 2 });
      const mark = this.add.ellipse(center.x, center.y, plaza.w * 34, plaza.d * 18, 0x9fd3c4, 0.032);
      mark.setDepth(14.5);
    });
  }
  private drawRoads() {
    campusRoads.forEach((road) => {
      const isMainAxis = road.id === "south-main-axis";
      const points = road.points.map((p) => this.toScreen(p));
      const shadow = this.add.graphics();
      shadow.lineStyle(13, 0x010303, 0.5);
      shadow.beginPath();
      points.forEach((p, index) => {
        if (index === 0) shadow.moveTo(p.x, p.y + 4);
        else shadow.lineTo(p.x, p.y + 4);
      });
      shadow.strokePath();
      shadow.setDepth(15);

      const dampEdge = this.add.graphics();
      dampEdge.lineStyle(8, isMainAxis ? 0x3d2024 : 0x101a18, 0.88);
      dampEdge.beginPath();
      points.forEach((p, index) => {
        if (index === 0) dampEdge.moveTo(p.x, p.y);
        else dampEdge.lineTo(p.x, p.y);
      });
      dampEdge.strokePath();
      dampEdge.setDepth(15.5);

      const g = this.add.graphics();
      g.lineStyle(5, isMainAxis ? 0x56383a : this.shade(road.color, -62), 0.94);
      g.beginPath();
      points.forEach((p, index) => {
        if (index === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.strokePath();
      g.setDepth(16);

      const stripe = this.add.graphics();
      stripe.lineStyle(1, isMainAxis ? 0xd17a6d : 0x9cb2aa, isMainAxis ? 0.24 : 0.2);
      stripe.beginPath();
      points.forEach((p, index) => {
        if (index === 0) stripe.moveTo(p.x, p.y);
        else stripe.lineTo(p.x, p.y);
      });
      stripe.strokePath();
      stripe.setDepth(17);
    });
  }

  private drawGroundDecals() {
    this.groundDecalLayer = this.add.graphics();
    const g = this.groundDecalLayer;
    g.setDepth(18.4);

    const puddles = [
      { x: 10.7, y: 30.2, w: 118, h: 25, color: 0x172d2d, alpha: 0.74 },
      { x: 13.6, y: 30.0, w: 92, h: 18, color: 0x102423, alpha: 0.72 },
      { x: 18.5, y: 29.8, w: 116, h: 23, color: 0x19282b, alpha: 0.62 },
      { x: 16.2, y: 21.8, w: 86, h: 18, color: 0x1b3235, alpha: 0.52 },
      { x: 6.0, y: 7.2, w: 78, h: 16, color: 0x192821, alpha: 0.5 },
    ];
    puddles.forEach((puddle, index) => {
      const p = this.toScreen(puddle);
      g.fillStyle(puddle.color, puddle.alpha);
      g.fillEllipse(p.x, p.y + 4, puddle.w, puddle.h);
      g.lineStyle(1, 0x7fa5a2, 0.12);
      g.strokeEllipse(p.x + index * 3, p.y + 4, puddle.w * 0.8, puddle.h * 0.58);
    });

    const crackStarts = [
      { x: 11.2, y: 30.4 },
      { x: 13.8, y: 29.6 },
      { x: 18.2, y: 30.2 },
      { x: 5.7, y: 7.6 },
      { x: 15.2, y: 21.4 },
      { x: 23.2, y: 22.5 },
    ];
    crackStarts.forEach((start, index) => this.drawCrack(g, start, 4 + (index % 3), index));

    const mudStains = [
      { x: 8.8, y: 29.3, w: 180, h: 42, alpha: 0.36 },
      { x: 5.2, y: 27.2, w: 220, h: 58, alpha: 0.48 },
      { x: 12.6, y: 30.5, w: 150, h: 34, alpha: 0.42 },
      { x: 6.6, y: 8.1, w: 112, h: 28, alpha: 0.25 },
    ];
    mudStains.forEach((stain) => {
      const p = this.toScreen(stain);
      g.fillStyle(0x1c1a13, stain.alpha);
      g.fillEllipse(p.x, p.y + 9, stain.w, stain.h);
    });

    const redStains = [
      { x: 12.1, y: 30.35, w: 72, h: 14, alpha: 0.2 },
      { x: 13.2, y: 29.85, w: 42, h: 10, alpha: 0.16 },
    ];
    redStains.forEach((stain) => {
      const p = this.toScreen(stain);
      g.fillStyle(0x4c1f22, stain.alpha);
      g.fillEllipse(p.x, p.y + 8, stain.w, stain.h);
    });

    for (let i = 0; i < 42; i += 1) {
      const base =
        i < 22
          ? { x: 9.5 + (i % 8) * 0.62, y: 28.6 + Math.floor(i / 8) * 0.72 }
          : { x: 4.9 + (i % 7) * 0.46, y: 6.8 + Math.floor((i - 22) / 7) * 0.4 };
      const p = this.toScreen(base);
      g.fillStyle(i % 3 === 0 ? 0x5b4931 : 0x27392f, 0.68);
      g.fillCircle(p.x + Math.sin(i) * 9, p.y + Math.cos(i * 1.7) * 7, 2 + (i % 2));
    }

    const paperPoints = [
      { x: 11.0, y: 30.1, angle: -16 },
      { x: 13.7, y: 30.6, angle: 9 },
      { x: 18.2, y: 30.5, angle: -7 },
      { x: 6.5, y: 7.3, angle: 12 },
      { x: 31.6, y: 15.4, angle: -10 },
    ];
    paperPoints.forEach((paper) => {
      const p = this.toScreen(paper);
      g.fillStyle(0xb7b7a2, 0.28);
      g.fillRect(p.x - 8, p.y - 4, 16, 9);
      g.lineStyle(1, 0x30342e, 0.22);
      g.strokeRect(p.x - 8, p.y - 4, 16, 9);
    });

    this.drawCautionTape(g, { x: 10.5, y: 30.25 }, { x: 14.4, y: 29.95 });
    this.drawFallenBike(g, { x: 14.1, y: 30.45 }, 1.05);
    this.drawFallenBike(g, { x: 6.4, y: 7.8 }, 0.82);
    this.drawNoticeBoard(g, { x: 6.9, y: 7.0 }, "白沙公告");
    this.drawWetReflection(g, { x: 17.7, y: 29.8 }, 120, 20, 0xbfded9, 0.12);
    this.drawWetReflection(g, { x: 15.8, y: 21.5 }, 180, 28, 0x86aeb2, 0.1);
    this.drawBlackVines(g);
  }

  private drawCrack(g: Phaser.GameObjects.Graphics, start: IsoPoint, segments: number, seed: number) {
    let current = this.toScreen(start);
    g.lineStyle(2, 0x030505, 0.58);
    g.beginPath();
    g.moveTo(current.x, current.y);
    for (let i = 0; i < segments; i += 1) {
      current = { x: current.x + 18 + Math.sin(seed + i) * 18, y: current.y + 6 + Math.cos(seed * 1.7 + i) * 13 };
      g.lineTo(current.x, current.y);
      if (i % 2 === 0) {
        g.moveTo(current.x, current.y);
        g.lineTo(current.x + Math.sin(seed + i * 2.3) * 22, current.y - 10 - i * 3);
        g.moveTo(current.x, current.y);
      }
    }
    g.strokePath();
  }

  private drawCautionTape(g: Phaser.GameObjects.Graphics, start: IsoPoint, end: IsoPoint) {
    const a = this.toScreen(start);
    const b = this.toScreen(end);
    g.lineStyle(5, 0xcaa63c, 0.78);
    g.beginPath();
    g.moveTo(a.x, a.y - 8);
    g.lineTo(b.x, b.y - 20);
    g.strokePath();
    g.lineStyle(3, 0x19140b, 0.52);
    for (let i = 0; i < 9; i += 1) {
      const t = i / 8;
      const x = Phaser.Math.Linear(a.x, b.x, t);
      const y = Phaser.Math.Linear(a.y - 8, b.y - 20, t);
      g.beginPath();
      g.moveTo(x - 6, y - 5);
      g.lineTo(x + 7, y + 5);
      g.strokePath();
    }
  }

  private drawFallenBike(g: Phaser.GameObjects.Graphics, point: IsoPoint, scale: number) {
    const p = this.toScreen(point);
    g.lineStyle(2, 0x151b1b, 0.78);
    g.strokeCircle(p.x - 15 * scale, p.y + 6 * scale, 8 * scale);
    g.strokeCircle(p.x + 16 * scale, p.y + 7 * scale, 8 * scale);
    g.beginPath();
    g.moveTo(p.x - 15 * scale, p.y + 6 * scale);
    g.lineTo(p.x, p.y - 8 * scale);
    g.lineTo(p.x + 16 * scale, p.y + 7 * scale);
    g.lineTo(p.x - 2 * scale, p.y + 8 * scale);
    g.closePath();
    g.strokePath();
    g.lineStyle(2, 0x050606, 0.42);
    g.beginPath();
    g.moveTo(p.x - 24 * scale, p.y + 16 * scale);
    g.lineTo(p.x + 29 * scale, p.y + 18 * scale);
    g.strokePath();
  }

  private drawNoticeBoard(g: Phaser.GameObjects.Graphics, point: IsoPoint, _text: string) {
    const p = this.toScreen(point);
    g.fillStyle(0x17140f, 0.78);
    g.fillRect(p.x - 22, p.y - 42, 44, 32);
    g.fillStyle(0x756845, 0.36);
    g.fillRect(p.x - 18, p.y - 38, 15, 9);
    g.fillRect(p.x + 2, p.y - 36, 14, 10);
    g.lineStyle(2, 0x0a0c0b, 0.74);
    g.strokeRect(p.x - 22, p.y - 42, 44, 32);
    g.lineStyle(3, 0x111413, 0.82);
    g.beginPath();
    g.moveTo(p.x - 14, p.y - 10);
    g.lineTo(p.x - 16, p.y + 12);
    g.moveTo(p.x + 14, p.y - 10);
    g.lineTo(p.x + 12, p.y + 12);
    g.strokePath();
  }

  private drawWetReflection(g: Phaser.GameObjects.Graphics, point: IsoPoint, width: number, height: number, color: number, alpha: number) {
    const p = this.toScreen(point);
    g.fillStyle(color, alpha);
    g.fillEllipse(p.x, p.y + 10, width, height);
    g.fillStyle(0xffffff, alpha * 0.38);
    g.fillEllipse(p.x - width * 0.16, p.y + 6, width * 0.28, height * 0.22);
  }

  private drawBlackVines(g: Phaser.GameObjects.Graphics) {
    const roots = [
      [{ x: 5.5, y: 27.4 }, { x: 7.5, y: 28.2 }, { x: 9.6, y: 29.0 }, { x: 11.0, y: 29.4 }],
      [{ x: 4.4, y: 29.3 }, { x: 6.7, y: 29.6 }, { x: 9.0, y: 30.0 }, { x: 12.2, y: 30.1 }],
      [{ x: 6.0, y: 25.8 }, { x: 7.7, y: 26.8 }, { x: 8.7, y: 28.1 }, { x: 10.4, y: 29.1 }],
    ];
    roots.forEach((root, index) => {
      const points = root.map((p) => this.toScreen(p));
      g.lineStyle(index === 1 ? 5 : 3, 0x020504, 0.58);
      g.beginPath();
      points.forEach((p, i) => {
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.strokePath();
      points.slice(1).forEach((p, i) => {
        g.lineStyle(2, 0x020504, 0.45);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + (i % 2 ? 20 : -18), p.y - 14);
        g.strokePath();
      });
    });
  }

  private drawGreenery() {
    const treePoints = [
      { x: 4, y: 15 },
      { x: 7, y: 18 },
      { x: 12, y: 14 },
      { x: 26, y: 17 },
      { x: 28, y: 20 },
      { x: 34, y: 18 },
      { x: 36, y: 28 },
      { x: 5, y: 26 },
      { x: 15, y: 28 },
      { x: 31, y: 5 },
      { x: 39, y: 12 },
    ];

    treePoints.forEach((point, index) => {
      const p = this.toScreen(point);
      const trunk = this.add.rectangle(p.x, p.y + 12, 8, 26, 0x2e221b, 0.82);
      trunk.setDepth(p.y + 8);
      const crown = this.add.triangle(p.x, p.y - 12, 0, 34, 22, 0, 44, 34, index % 2 ? 0x142a21 : 0x10241d, 0.96);
      crown.setDepth(p.y + 10);
      if (index % 4 === 0) {
        const shade = this.add.ellipse(p.x + 6, p.y + 4, 58, 16, 0x000000, 0.24);
        shade.setDepth(p.y + 7);
      }
    });
  }

  private drawBuildings() {
    campusBuildings.forEach((building) => {
      if (building.id === "east-track") {
        this.drawTrackField(building);
        return;
      }

      const theme = buildingThemes[building.id];
      const g = this.add.graphics();
      this.drawIsoPrism(g, building);
      const center = this.toScreen({
        x: building.x + building.w / 2,
        y: building.y + building.d / 2,
      });
      g.setDepth(center.y + building.h * 26);
      if (building.id === "admin-center") {
        this.drawAdminEyeRoof(building, center.y + building.h * 26 + 1);
      }

      const label = this.add
        .text(center.x, center.y - building.h * 35 + (building.labelOffset ?? 0), theme?.label ?? building.name, {
          fontFamily: "Microsoft YaHei, sans-serif",
          fontSize: building.id === "medical-college" ? "15px" : "13px",
          color: theme?.labelColor ?? "#c7d7cf",
          backgroundColor: "rgba(0, 3, 3, 0.72)",
          padding: { x: 7, y: 3 },
        })
        .setOrigin(0.5);
      label.setDepth(center.y + building.h * 26 + 2);
      label.setAlpha(0.34);
      label.setData("baseText", theme?.label ?? building.name);
      this.buildingLabels.set(building.id, label);

      if (["library", "medical-college", "medical-library", "little-theater", "linhu-canteen", "dorm-baisha"].includes(building.id)) {
        this.tweens.add({
          targets: label,
          alpha: { from: 0.48, to: 0.9 },
          duration: 1500 + building.name.length * 120,
          yoyo: true,
          repeat: -1,
        });
      }

      this.drawBuildingAtmosphere(building, center, center.y + building.h * 26 + 1);
    });
  }

  private drawBuildingAtmosphere(building: CampusBuilding, center: IsoPoint, depth: number) {
    const addGlow = (
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha: number,
      duration: number,
      delay = 0,
    ) => {
      const glow = this.add.ellipse(x, y, width, height, color, alpha);
      glow.setDepth(depth);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: glow,
        alpha: { from: alpha * 0.28, to: alpha },
        scaleX: { from: 0.96, to: 1.08 },
        duration,
        delay,
        yoyo: true,
        repeat: -1,
      });
      return glow;
    };

    const addWindow = (point: IsoPoint, color: number, delay: number, alpha = 0.54) => {
      const p = this.toScreen(point);
      const windowLight = this.add.rectangle(p.x, p.y - building.h * 19, 12, 18, color, alpha);
      windowLight.setDepth(depth + 1);
      windowLight.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: windowLight,
        alpha: { from: 0.04, to: alpha },
        duration: 420 + delay,
        delay,
        yoyo: true,
        repeat: -1,
        repeatDelay: 700 + delay,
      });
    };

    if (building.id === "medical-college") {
      const entry = this.toScreen({ x: building.x + building.w * 0.5, y: building.y + building.d + 0.12 });
      addGlow(center.x, center.y - building.h * 28, 138, 118, 0xb7d7d2, 0.1, 1900);
      addGlow(entry.x, entry.y - 14, 190, 54, 0x8ebeb7, 0.09, 1450, 260);

      const sixthY = center.y - building.h * 31;
      for (let i = 0; i < 5; i += 1) {
        const window = this.add.rectangle(center.x - 45 + i * 22, sixthY, 12, 10, 0xc9e8e2, i === 2 ? 0.16 : 0.045);
        window.setDepth(depth + 3);
        window.setBlendMode(Phaser.BlendModes.ADD);
        if (i === 2) {
          this.medicalSixthWindow = window;
          this.tweens.add({
            targets: window,
            alpha: { from: 0.03, to: 0.72 },
            duration: 120,
            yoyo: true,
            repeat: -1,
            repeatDelay: 5200,
          });
        }
      }

      const tape = this.add.graphics();
      tape.lineStyle(3, 0xd9b548, 0.72);
      tape.beginPath();
      tape.moveTo(entry.x - 74, entry.y - 2);
      tape.lineTo(entry.x + 78, entry.y - 24);
      tape.strokePath();
      tape.lineStyle(3, 0x11110c, 0.5);
      tape.beginPath();
      tape.moveTo(entry.x - 64, entry.y - 1);
      tape.lineTo(entry.x + 88, entry.y - 23);
      tape.strokePath();
      tape.setDepth(depth + 4);

      const stain = this.add.ellipse(entry.x - 24, entry.y + 7, 112, 22, 0x14201d, 0.42);
      stain.setDepth(depth - 1);
      const leaves = this.add.graphics();
      for (let i = 0; i < 13; i += 1) {
        leaves.fillStyle(i % 2 ? 0x4d3f2b : 0x2d3b2d, 0.72);
        leaves.fillCircle(entry.x - 54 + i * 9, entry.y + 8 + Math.sin(i) * 10, 2 + (i % 3));
      }
      leaves.setDepth(depth + 2);

      const bike = this.add.graphics();
      bike.lineStyle(2, 0x2e3837, 0.82);
      bike.strokeCircle(entry.x + 72, entry.y + 6, 7);
      bike.strokeCircle(entry.x + 94, entry.y + 8, 7);
      bike.beginPath();
      bike.moveTo(entry.x + 72, entry.y + 6);
      bike.lineTo(entry.x + 83, entry.y - 8);
      bike.lineTo(entry.x + 94, entry.y + 8);
      bike.lineTo(entry.x + 80, entry.y + 8);
      bike.closePath();
      bike.strokePath();
      bike.setDepth(depth + 3);
      return;
    }

    if (building.id === "medical-library") {
      const entry = this.toScreen({ x: building.x + building.w * 0.42, y: building.y + building.d + 0.1 });
      addGlow(entry.x, entry.y - 26, 180, 46, 0xd6d8c8, 0.1, 2600);
      for (let i = 0; i < 4; i += 1) {
        addWindow({ x: building.x + 0.7 + i * 0.75, y: building.y + building.d }, 0xd3dad1, 280 + i * 90, 0.2);
      }
      return;
    }

    if (building.id === "library") {
      const entry = this.toScreen({ x: building.x + building.w / 2, y: building.y + building.d + 0.18 });
      addGlow(entry.x, entry.y - 34, 170, 58, 0xbbe7df, 0.18, 1250);
      addGlow(center.x, center.y - building.h * 30, 92, 148, 0x9bd8d1, 0.11, 1900, 220);
      addWindow({ x: building.x + 0.8, y: building.y + building.d }, 0xdcefea, 120, 0.44);
      addWindow({ x: building.x + 1.8, y: building.y + building.d }, 0xdcefea, 540, 0.34);
      addWindow({ x: building.x + 2.7, y: building.y + building.d }, 0xe7d6a4, 820, 0.28);
      return;
    }

    if (building.id === "little-theater") {
      addGlow(center.x, center.y + 12, 150, 42, 0xa93e3f, 0.2, 980);
      addGlow(center.x + 10, center.y - building.h * 22, 86, 74, 0x7b2229, 0.12, 1700, 300);
      return;
    }

    if (building.id === "linhu-canteen") {
      const entry = this.toScreen({ x: building.x + building.w * 0.35, y: building.y + building.d + 0.12 });
      addGlow(entry.x, entry.y - 18, 134, 40, 0xd6a15d, 0.14, 760);
      addGlow(entry.x + 34, entry.y - 18, 92, 32, 0x87d0a4, 0.1, 1320, 240);
      return;
    }

    if (building.id === "dorm-baisha") {
      addGlow(center.x, center.y - building.h * 18, 126, 68, 0xc9d7bd, 0.08, 2100);
      const room123 = this.toScreen({ x: building.x + 0.75, y: building.y + building.d });
      const room216 = this.toScreen({ x: building.x + 1.85, y: building.y + building.d });
      const w123 = this.add.rectangle(room123.x, room123.y - building.h * 18, 14, 18, 0xe7ca85, 0.48);
      w123.setDepth(depth + 2);
      w123.setBlendMode(Phaser.BlendModes.ADD);
      this.baisha216Window = this.add.rectangle(room216.x, room216.y - building.h * 23, 14, 18, 0xf0d19a, 0.5);
      this.baisha216Window.setDepth(depth + 2);
      this.baisha216Window.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: this.baisha216Window,
        alpha: { from: 0.08, to: 0.58 },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        repeatDelay: 900,
      });

      const label123 = this.add.text(room123.x, room123.y - building.h * 18 - 24, "2幢123", {
        fontFamily: "Microsoft YaHei, sans-serif",
        fontSize: "11px",
        color: "#e5d4a5",
        backgroundColor: "rgba(4,8,7,0.58)",
        padding: { x: 5, y: 2 },
      }).setOrigin(0.5);
      const label216 = this.add.text(room216.x, room216.y - building.h * 23 - 24, "3幢216", {
        fontFamily: "Microsoft YaHei, sans-serif",
        fontSize: "11px",
        color: "#efe6d0",
        backgroundColor: "rgba(4,8,7,0.58)",
        padding: { x: 5, y: 2 },
      }).setOrigin(0.5);
      label123.setDepth(depth + 3);
      label216.setDepth(depth + 3);
      return;
    }

    if (building.id === "west-teaching") {
      const shadow = this.add.ellipse(center.x, center.y + 22, 190, 48, 0x020404, 0.28);
      shadow.setDepth(depth - 2);
      return;
    }

    if (["agri-life", "environment-college", "life-science"].includes(building.id)) {
      addGlow(center.x, center.y - building.h * 18, building.w * 34, 48, 0x7dcf9c, 0.055, 2400);
    }
  }

  private drawTrackField(building: CampusBuilding) {
    const center = this.toScreen({ x: building.x + building.w / 2, y: building.y + building.d / 2 });
    const g = this.add.graphics();
    const outerW = building.w * 62;
    const outerH = building.d * 42;
    const innerW = building.w * 50;
    const innerH = building.d * 28;
    const fieldW = building.w * 30;
    const fieldH = building.d * 16;

    g.fillStyle(0x080d0c, 0.56);
    g.fillEllipse(center.x + 8, center.y + 12, outerW + 16, outerH + 14);
    g.fillStyle(0x552421, 0.98);
    g.fillEllipse(center.x, center.y, outerW, outerH);
    g.fillStyle(0x351817, 0.92);
    g.fillEllipse(center.x, center.y, outerW * 0.92, outerH * 0.88);
    g.fillStyle(0x183323, 0.98);
    g.fillEllipse(center.x, center.y, innerW, innerH);
    g.lineStyle(4, 0xf3e4ca, 0.9);
    g.strokeEllipse(center.x, center.y, innerW, innerH);
    g.lineStyle(2, 0xe6d7c0, 0.78);
    g.strokeEllipse(center.x, center.y, fieldW + 12, fieldH + 8);
    g.strokeEllipse(center.x, center.y, fieldW, fieldH);
    g.setDepth(center.y + 28);

    const label = this.add
      .text(center.x, center.y - 34, building.name, {
        fontFamily: "Microsoft YaHei, sans-serif",
        fontSize: "15px",
        color: "#c7d7cf",
        backgroundColor: "rgba(3, 7, 7, 0.66)",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5);
    label.setDepth(center.y + 30);
  }

  private drawAdminEyeRoof(building: CampusBuilding, depth: number) {
    const center = this.toScreen({ x: building.x + building.w / 2, y: building.y + building.d / 2 });
    const topY = center.y - building.h * 26 - 2;
    const eye = this.add.graphics();
    eye.lineStyle(4, 0xd7ded1, 0.72);
    eye.strokeEllipse(center.x, topY, 52, 20);
    eye.lineStyle(2, 0x8b9f99, 0.82);
    eye.strokeEllipse(center.x, topY, 24, 10);
    eye.fillStyle(0x0b1110, 0.92);
    eye.fillCircle(center.x, topY, 5);
    eye.setDepth(depth);
  }

  private drawOrientationLabels() {
    const north = this.toScreen({ x: 8.0, y: 2.0 });
    const south = this.toScreen({ x: 6.0, y: 31.8 });
    const makeLabel = (point: { x: number; y: number }, text: string, depth: number) => {
      const label = this.add
        .text(point.x, point.y, text, {
          fontFamily: "Microsoft YaHei, sans-serif",
          fontSize: "18px",
          color: "#f1f7ee",
          backgroundColor: "rgba(8, 14, 13, 0.68)",
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5);
      label.setDepth(depth);
    };
    makeLabel(north, "北 N", 90000);
    makeLabel(south, "南 S", 90000);
  }

  private drawIsoPrism(g: Phaser.GameObjects.Graphics, b: CampusBuilding) {
    const theme = buildingThemes[b.id];
    const bodyColor = theme?.body ?? b.color;
    const roofColor = theme?.roof ?? b.roof;
    const a = this.toScreen({ x: b.x, y: b.y });
    const east = this.toScreen({ x: b.x + b.w, y: b.y });
    const south = this.toScreen({ x: b.x, y: b.y + b.d });
    const far = this.toScreen({ x: b.x + b.w, y: b.y + b.d });
    const height = b.h * 28;
    const topA = { x: a.x, y: a.y - height };
    const topEast = { x: east.x, y: east.y - height };
    const topSouth = { x: south.x, y: south.y - height };
    const topFar = { x: far.x, y: far.y - height };

    g.fillStyle(0x000000, 0.32);
    g.fillPoints(
      [
        { x: south.x - 14, y: south.y + 12 },
        { x: far.x + 24, y: far.y + 10 },
        { x: east.x + 18, y: east.y + 30 },
        { x: a.x - 18, y: a.y + 34 },
      ],
      true,
    );

    g.fillStyle(this.shade(bodyColor, -58), 1);
    g.beginPath();
    g.moveTo(south.x, south.y);
    g.lineTo(far.x, far.y);
    g.lineTo(topFar.x, topFar.y);
    g.lineTo(topSouth.x, topSouth.y);
    g.closePath();
    g.fillPath();

    g.fillStyle(this.shade(bodyColor, -36), 1);
    g.beginPath();
    g.moveTo(east.x, east.y);
    g.lineTo(far.x, far.y);
    g.lineTo(topFar.x, topFar.y);
    g.lineTo(topEast.x, topEast.y);
    g.closePath();
    g.fillPath();

    g.fillStyle(this.shade(roofColor, -22), 1);
    g.lineStyle(2, 0xa9c2b8, 0.11);
    g.beginPath();
    g.moveTo(topA.x, topA.y);
    g.lineTo(topEast.x, topEast.y);
    g.lineTo(topFar.x, topFar.y);
    g.lineTo(topSouth.x, topSouth.y);
    g.closePath();
    g.fillPath();
    g.strokePath();

    this.drawBuildingSurfaceDetails(g, b, {
      a,
      east,
      south,
      far,
      topA,
      topEast,
      topSouth,
      topFar,
      height,
    });

    for (let i = 0; i < Math.floor(b.w); i += 1) {
      const wp = this.toScreen({ x: b.x + i + 0.7, y: b.y + b.d });
      const lit = (i + b.id.length) % 3 === 0;
      const windowColor = theme?.glow ?? (lit ? 0xbdded7 : 0xb88758);
      g.fillStyle(lit ? windowColor : 0xb88758, lit ? 0.19 : 0.045);
      g.fillRect(wp.x - 9, wp.y - height + 34, 12, 18);
      g.fillStyle(0xe4c07d, (i + b.name.length) % 4 === 0 ? 0.14 : 0.035);
      g.fillRect(wp.x - 9, wp.y - height + 64, 12, 18);
    }
  }

  private drawBuildingSurfaceDetails(g: Phaser.GameObjects.Graphics, b: CampusBuilding, shape: BuildingScreenShape) {
    const isMedical = b.id === "medical-college";
    const isMedicalLibrary = b.id === "medical-library";
    const isBaisha = b.id === "dorm-baisha";
    const isTheater = b.id === "little-theater";
    const isLibrary = b.id === "library";
    const grime = isMedical ? 1.35 : isMedicalLibrary ? 0.82 : isBaisha ? 0.72 : isTheater ? 0.92 : isLibrary ? 0.76 : 0.48;

    for (let i = 1; i < 5; i += 1) {
      const t = i / 5;
      const left = {
        x: Phaser.Math.Linear(shape.topA.x, shape.topSouth.x, t),
        y: Phaser.Math.Linear(shape.topA.y, shape.topSouth.y, t),
      };
      const right = {
        x: Phaser.Math.Linear(shape.topEast.x, shape.topFar.x, t),
        y: Phaser.Math.Linear(shape.topEast.y, shape.topFar.y, t),
      };
      g.lineStyle(1, 0xd1ddd6, 0.035 + grime * 0.012);
      g.beginPath();
      g.moveTo(left.x, left.y);
      g.lineTo(right.x, right.y);
      g.strokePath();
    }

    for (let i = 1; i < 5; i += 1) {
      const t = i / 5;
      const top = {
        x: Phaser.Math.Linear(shape.topA.x, shape.topEast.x, t),
        y: Phaser.Math.Linear(shape.topA.y, shape.topEast.y, t),
      };
      const bottom = {
        x: Phaser.Math.Linear(shape.topSouth.x, shape.topFar.x, t),
        y: Phaser.Math.Linear(shape.topSouth.y, shape.topFar.y, t),
      };
      g.lineStyle(1, 0x07100e, 0.12);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(bottom.x, bottom.y);
      g.strokePath();
    }

    const stainColor = isMedical ? 0x72908b : isTheater ? 0x392739 : 0x20362f;
    const stainCount = isMedical ? 9 : isMedicalLibrary ? 6 : isBaisha ? 5 : 4;
    for (let i = 0; i < stainCount; i += 1) {
      const sidePoint = this.toScreen({ x: b.x + 0.45 + (i % 4) * Math.max(0.55, b.w / 4), y: b.y + b.d });
      const y = sidePoint.y - shape.height + 28 + (i % 3) * 22;
      g.fillStyle(stainColor, 0.08 + grime * 0.035);
      g.fillEllipse(sidePoint.x + Math.sin(i * 1.7) * 10, y, 18 + (i % 3) * 9, 36 + (i % 2) * 18);
      g.lineStyle(2, stainColor, 0.12 + grime * 0.035);
      g.beginPath();
      g.moveTo(sidePoint.x + 4, y - 18);
      g.lineTo(sidePoint.x - 3 + Math.sin(i) * 5, y + 28);
      g.strokePath();
    }

    const edgeColor = isMedical ? 0xb7d7d2 : 0x9fb0aa;
    g.lineStyle(2, edgeColor, isMedical ? 0.18 : 0.09);
    g.beginPath();
    g.moveTo(shape.topA.x, shape.topA.y);
    g.lineTo(shape.topEast.x, shape.topEast.y);
    g.moveTo(shape.topFar.x, shape.topFar.y);
    g.lineTo(shape.topSouth.x, shape.topSouth.y);
    g.strokePath();

    g.lineStyle(isMedical ? 3 : 2, 0x020303, 0.34 + grime * 0.1);
    g.beginPath();
    g.moveTo(shape.south.x - 4, shape.south.y + 2);
    g.lineTo(shape.far.x + 8, shape.far.y + 2);
    g.strokePath();

    const door = this.toScreen({ x: b.x + b.w * 0.5, y: b.y + b.d });
    g.fillStyle(0x020303, isMedical ? 0.58 : 0.34);
    g.fillRect(door.x - 16, door.y - 40, 32, 42);
    if (isMedical || isMedicalLibrary || isBaisha || isTheater || isLibrary) {
      g.fillStyle(isMedical ? 0xcdebe5 : isTheater ? 0x8c3b55 : isLibrary ? 0x7b382e : 0xd7c185, isMedical ? 0.16 : 0.1);
      g.fillEllipse(door.x, door.y - 18, 78, 30);
    }

    const chips = isMedical ? 8 : 4;
    for (let i = 0; i < chips; i += 1) {
      const t = i / Math.max(chips - 1, 1);
      const x = Phaser.Math.Linear(shape.topA.x, shape.topEast.x, t) + Math.sin(i * 2.1) * 5;
      const y = Phaser.Math.Linear(shape.topA.y, shape.topEast.y, t) + 2;
      g.fillStyle(0x050808, 0.38);
      g.fillTriangle(x - 5, y, x + 4, y + 2, x - 1, y + 7);
    }

    if (isMedical) {
      const sixthY = shape.topA.y + 16;
      g.lineStyle(2, 0xd9f2ed, 0.22);
      g.beginPath();
      g.moveTo(shape.topA.x + 18, sixthY);
      g.lineTo(shape.topEast.x - 18, sixthY + 2);
      g.strokePath();
    }
  }

  private drawStoryProps() {
    this.drawMedicalEventProps();
    this.drawBridgeProps();
    this.drawTheaterProps();
    this.drawEastTeachingRepetition();
  }

  private drawMedicalEventProps() {
    const medical = campusBuildings.find((building) => building.id === "medical-college");
    if (!medical) return;

    const sixth = this.toScreen({ x: medical.x + medical.w * 0.58, y: medical.y + medical.d * 0.5 });
    const dress = this.add.triangle(0, 8, -9, 28, 9, 28, 0, -14, 0xe9eee8, 0);
    const head = this.add.circle(0, -20, 5, 0xe9eee8, 0);
    const hair = this.add.rectangle(0, -13, 12, 22, 0x0b0c0c, 0);
    this.medicalSilhouette = this.add.container(sixth.x + 22, sixth.y - medical.h * 35, [dress, head, hair]);
    this.medicalSilhouette.setDepth(sixth.y + 200);
    this.medicalSilhouette.setBlendMode(Phaser.BlendModes.ADD);

    const entry = this.toScreen({ x: medical.x + medical.w * 0.5, y: medical.y + medical.d + 0.15 });
    const skirt = this.add.triangle(0, -6, -15, 18, 15, 18, 0, -24, 0xf2f0e6, 0);
    const shoeA = this.add.ellipse(-7, 20, 15, 6, 0x060606, 0);
    const shoeB = this.add.ellipse(9, 22, 15, 6, 0x060606, 0);
    this.medicalFootTrace = this.add.container(entry.x - 28, entry.y - 8, [skirt, shoeA, shoeB]);
    this.medicalFootTrace.setDepth(entry.y + 80);

    this.mirrorGlitch = this.add.rectangle(entry.x + 78, entry.y - 60, 42, 64, 0xb9d6d2, 0);
    this.mirrorGlitch.setDepth(entry.y + 96);
    this.mirrorGlitch.setBlendMode(Phaser.BlendModes.ADD);
    this.mirrorGlitch.setAngle(-4);

    const mannequinA = this.add.ellipse(-12, -16, 18, 54, 0xb9c8c2, 0);
    const mannequinB = this.add.ellipse(10, -11, 16, 48, 0xaebfba, 0);
    const shadow = this.add.ellipse(0, 18, 60, 16, 0x010202, 0);
    const storePoint = this.toScreen({ x: medical.x + medical.w * 0.18, y: medical.y + 0.2 });
    this.warehouseShadow = this.add.container(storePoint.x, storePoint.y - 26, [shadow, mannequinA, mannequinB]);
    this.warehouseShadow.setDepth(storePoint.y + 140);
  }

  private drawBridgeProps() {
    const bridge = horrorZones.yangmingBridge.center;
    const p = this.toScreen(bridge);
    const g = this.add.graphics();
    g.lineStyle(5, 0x526765, 0.34);
    g.beginPath();
    g.moveTo(p.x - 72, p.y - 12);
    g.lineTo(p.x + 74, p.y + 10);
    g.strokePath();
    g.lineStyle(2, 0x273633, 0.5);
    g.beginPath();
    g.moveTo(p.x - 68, p.y - 24);
    g.lineTo(p.x + 82, p.y - 2);
    g.strokePath();
    g.setDepth(p.y + 22);

    const pole = this.add.rectangle(p.x + 12, p.y - 34, 4, 44, 0x17201d, 0.88);
    const badLamp = this.add.circle(p.x + 12, p.y - 60, 9, 0xc7d8cf, 0.34);
    pole.setDepth(p.y + 34);
    badLamp.setDepth(p.y + 35);
    badLamp.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: badLamp,
      alpha: { from: 0.02, to: 0.48 },
      duration: 190,
      yoyo: true,
      repeat: -1,
      repeatDelay: 1800,
    });
  }

  private drawTheaterProps() {
    const theater = campusBuildings.find((building) => building.id === "little-theater");
    if (!theater) return;
    const p = this.toScreen({ x: theater.x + theater.w * 0.52, y: theater.y + theater.d + 0.18 });
    const poster = this.add.rectangle(p.x - 38, p.y - 32, 28, 48, 0x553344, 0.66);
    const slash = this.add.rectangle(p.x - 38, p.y - 32, 4, 46, 0x211620, 0.72);
    slash.setAngle(18);
    poster.setDepth(p.y + 46);
    slash.setDepth(p.y + 47);
    const frame = this.add.rectangle(p.x + 54, p.y - 22, 38, 62, 0x151318, 0.58);
    frame.setDepth(p.y + 45);
    this.tweens.add({
      targets: frame,
      alpha: { from: 0.22, to: 0.66 },
      duration: 2300,
      yoyo: true,
      repeat: -1,
    });
  }

  private drawEastTeachingRepetition() {
    ["east-teaching-1", "east-teaching-2", "east-teaching-3", "east-teaching-4"].forEach((id, index) => {
      const building = campusBuildings.find((item) => item.id === id);
      if (!building) return;
      const p = this.toScreen({ x: building.x + building.w + 0.08, y: building.y + building.d * 0.5 });
      const shadow = this.add.rectangle(p.x + index * 3, p.y - building.h * 18, 18, 54, 0x050807, 0.14 + index * 0.025);
      shadow.setDepth(p.y + building.h * 26 + 1);
      shadow.setAngle(index % 2 ? -3 : 3);
    });
  }

  private drawLightLayer() {
    this.lightLayer = this.add.graphics();
    this.lightLayer.setDepth(87);
    this.lightLayer.setBlendMode(Phaser.BlendModes.ADD);

    const staticGlows = [
      { x: 12.7, y: 30.0, w: 270, h: 74, color: 0xbfded9, alpha: 0.11 },
      { x: 12.6, y: 28.9, w: 150, h: 210, color: 0x7fb4ad, alpha: 0.07 },
      { x: 19.0, y: 30.1, w: 240, h: 68, color: 0xd4d6c2, alpha: 0.08 },
      { x: 6.0, y: 6.9, w: 160, h: 58, color: 0xe0bd72, alpha: 0.08 },
      { x: 16.5, y: 21.7, w: 220, h: 44, color: 0x86aeb2, alpha: 0.08 },
      { x: 12.0, y: 11.5, w: 160, h: 52, color: 0x71304b, alpha: 0.08 },
      { x: 32.6, y: 15.3, w: 170, h: 54, color: 0x8a493b, alpha: 0.055 },
    ];

    staticGlows.forEach((light) => {
      const p = this.toScreen(light);
      this.lightLayer.fillStyle(light.color, light.alpha);
      this.lightLayer.fillEllipse(p.x, p.y - 18, light.w, light.h);
    });

    const pulseLights = [
      { point: { x: 12.6, y: 28.75 }, color: 0xdaf7f1, radius: 62, alpha: 0.18, duration: 190 },
      { point: { x: 6.8, y: 6.2 }, color: 0xf3e2b6, radius: 46, alpha: 0.16, duration: 1500 },
      { point: { x: 23.4, y: 22.8 }, color: 0xcfe7df, radius: 78, alpha: 0.12, duration: 260 },
      { point: { x: 11.9, y: 11.7 }, color: 0x8a3755, radius: 68, alpha: 0.12, duration: 2100 },
    ];

    pulseLights.forEach((light, index) => {
      const p = this.toScreen(light.point);
      const glow = this.add.circle(p.x, p.y - 38, light.radius, light.color, light.alpha);
      glow.setDepth(88);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: glow,
        alpha: { from: light.alpha * 0.1, to: light.alpha },
        scale: { from: 0.82, to: 1.16 },
        duration: light.duration + index * 120,
        yoyo: true,
        repeat: -1,
        repeatDelay: index === 0 ? 4200 : 360,
      });
    });
  }

  private drawForegroundShadows() {
    this.foregroundShadowLayer = this.add.graphics();
    const g = this.foregroundShadowLayer;
    g.setDepth(92000);

    const branchSets = [
      [
        { x: 13.0, y: 16.8 },
        { x: 16.0, y: 18.3 },
        { x: 19.6, y: 19.6 },
        { x: 23.0, y: 21.2 },
      ],
      [
        { x: 3.8, y: 24.2 },
        { x: 6.0, y: 25.8 },
        { x: 8.4, y: 27.6 },
        { x: 11.8, y: 29.1 },
      ],
      [
        { x: 9.8, y: 8.6 },
        { x: 11.6, y: 10.2 },
        { x: 13.2, y: 12.2 },
        { x: 14.8, y: 14.0 },
      ],
    ];

    branchSets.forEach((branch, branchIndex) => {
      const points = branch.map((p) => this.toScreen(p));
      g.lineStyle(branchIndex === 1 ? 11 : 8, 0x000000, branchIndex === 1 ? 0.46 : 0.34);
      g.beginPath();
      points.forEach((p, index) => {
        if (index === 0) g.moveTo(p.x, p.y - 90 + branchIndex * 20);
        else g.lineTo(p.x, p.y - 80 + branchIndex * 18);
      });
      g.strokePath();
      points.slice(1).forEach((p, i) => {
        g.lineStyle(4, 0x000000, 0.32);
        g.beginPath();
        g.moveTo(p.x, p.y - 82 + branchIndex * 18);
        g.lineTo(p.x + (i % 2 ? 80 : -70), p.y - 128 + i * 18);
        g.strokePath();
      });
    });

    const wireA = this.toScreen({ x: 5.5, y: 5.0 });
    const wireB = this.toScreen({ x: 35.5, y: 10.2 });
    for (let i = 0; i < 3; i += 1) {
      g.lineStyle(2, 0x010101, 0.38);
      g.beginPath();
      g.moveTo(wireA.x, wireA.y - 150 + i * 13);
      g.lineTo(wireB.x, wireB.y - 150 + i * 13);
      g.strokePath();
    }

    const medicalCorner = this.toScreen({ x: 15.0, y: 30.4 });
    g.fillStyle(0x000000, 0.34);
    g.fillTriangle(medicalCorner.x - 210, medicalCorner.y + 56, medicalCorner.x + 140, medicalCorner.y + 34, medicalCorner.x + 40, medicalCorner.y + 160);

    const swampBase = this.toScreen({ x: 4.2, y: 30.8 });
    for (let i = 0; i < 28; i += 1) {
      g.lineStyle(3 + (i % 3), 0x020303, 0.44);
      g.beginPath();
      g.moveTo(swampBase.x - 180 + i * 15, swampBase.y + 60);
      g.lineTo(swampBase.x - 186 + i * 15 + Math.sin(i) * 22, swampBase.y - 28 - (i % 5) * 10);
      g.strokePath();
    }

    const railStart = this.toScreen({ x: 22.2, y: 22.3 });
    g.lineStyle(4, 0x000000, 0.36);
    for (let i = 0; i < 5; i += 1) {
      g.beginPath();
      g.moveTo(railStart.x - 80 + i * 34, railStart.y - 26 + i * 3);
      g.lineTo(railStart.x - 70 + i * 34, railStart.y + 34 + i * 3);
      g.strokePath();
    }
  }

  private drawLampPosts() {
    const lamps = [
      { point: { x: 9, y: 27 }, color: 0xa9d8cf, radius: 86, alpha: 0.08, flicker: 0.45 },
      { point: { x: 14, y: 23 }, color: 0xd8ba7a, radius: 86, alpha: 0.08, flicker: 0.7 },
      { point: { x: 17, y: 19 }, color: 0xa9d8cf, radius: 86, alpha: 0.08, flicker: 0.45 },
      { point: { x: 23, y: 14 }, color: 0xd8ba7a, radius: 86, alpha: 0.08, flicker: 0.35 },
      { point: { x: 30, y: 12 }, color: 0xa9d8cf, radius: 86, alpha: 0.08, flicker: 0.52 },
      { point: { x: 25, y: 23 }, color: 0xd8ba7a, radius: 86, alpha: 0.08, flicker: 0.35 },
      { point: { x: 32, y: 24 }, color: 0xa9d8cf, radius: 86, alpha: 0.08, flicker: 0.45 },
      { point: { x: 36.3, y: 16.2 }, color: 0xa9d8cf, radius: 86, alpha: 0.08, flicker: 0.6 },
      { point: { x: 36.2, y: 28.0 }, color: 0xd8ba7a, radius: 86, alpha: 0.08, flicker: 0.42 },
      { point: { x: 10.7, y: 11.7 }, color: 0xd8ba7a, radius: 86, alpha: 0.08, flicker: 0.5 },
      ...lightSources
        .filter((lamp) => !lamp.stageMin || lamp.stageMin <= this.storyStage)
        .map((lamp) => ({
          point: lamp.point,
          color: lamp.color,
          radius: lamp.radius,
          alpha: lamp.alpha,
          flicker: lamp.flicker,
        })),
    ];

    lamps.forEach((lamp, index) => {
      const p = this.toScreen(lamp.point);
      const pole = this.add.rectangle(p.x, p.y - 15, 5, 38, 0x151d1a, 0.92);
      pole.setDepth(p.y + 10);
      const glow = this.add.circle(p.x, p.y - 38, lamp.radius, lamp.color, lamp.alpha);
      glow.setDepth(p.y + 9);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      const bulb = this.add.circle(p.x, p.y - 38, 6, lamp.color, 0.68);
      bulb.setDepth(p.y + 11);
      bulb.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: glow,
        alpha: { from: lamp.alpha * 0.25, to: lamp.alpha * (1.2 + lamp.flicker) },
        scale: { from: 0.88, to: 1.12 },
        duration: 620 + index * 95,
        delay: index * 50,
        yoyo: true,
        repeat: -1,
      });
      this.tweens.add({
        targets: bulb,
        alpha: { from: lamp.flicker > 0.7 ? 0.08 : 0.34, to: 0.82 },
        duration: 280 + index * 37,
        delay: index * 70,
        yoyo: true,
        repeat: -1,
        repeatDelay: index % 3 === 0 ? 420 : 120,
      });
    });
  }

  private drawMapAnomalies() {
    const anomalyPoints = [
      { x: 19.2, y: 22.4, color: 0x9bd8d1, w: 210, h: 54, alpha: 0.08 },
      { x: 12.0, y: 11.8, color: 0x9c3035, w: 170, h: 44, alpha: 0.11 },
      { x: 32.0, y: 15.6, color: 0xcfe6dc, w: 180, h: 56, alpha: 0.08 },
      { x: 7.1, y: 8.1, color: 0xc7d2b5, w: 150, h: 38, alpha: 0.07 },
    ];

    anomalyPoints.forEach((item, index) => {
      const p = this.toScreen(item);
      const glow = this.add.ellipse(p.x, p.y, item.w, item.h, item.color, item.alpha);
      glow.setDepth(p.y + 5);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: glow,
        alpha: { from: item.alpha * 0.16, to: item.alpha },
        scaleX: { from: 0.92, to: 1.12 },
        duration: 1700 + index * 330,
        yoyo: true,
        repeat: -1,
      });
    });
  }

  private createPlayer() {
    const p = this.toScreen(this.playerIso);
    this.delayedReflection = this.add.ellipse(p.x + 24, p.y + 38, 26, 9, 0x0b1212, 0.0);
    this.delayedReflection.setDepth(19);
    this.player = this.add.container(p.x, p.y);
    const shadow = this.add.ellipse(0, 16, 34, 14, 0x020404, 0.48);
    const halo = this.add.circle(0, -14, 54, 0xa9d8cf, 0.035);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    this.flashlight = this.add.triangle(18, -10, 0, 0, 220, -38, 220, 38, 0xcfe8dd, 0.13);
    this.flashlight.setOrigin(0, 0.5);
    this.flashlight.setBlendMode(Phaser.BlendModes.ADD);
    this.playerBody = this.add.ellipse(0, -10, 25, 37, 0x18262c, 1);
    const face = this.add.circle(0, -30, 10, 0xbca987, 1);
    this.player.add([this.flashlight, halo, shadow, this.playerBody, face]);
    this.player.setDepth(p.y + 40);
  }

  private snapPlayerToRoad() {
    const nearest = this.nearestRoadPoint(this.playerIso);
    if (nearest) this.playerIso = nearest.point;
  }

  private createFog() {
    this.lakeMist = this.add.graphics();
    this.lakeMist.setDepth(88);

    this.fog = this.add.graphics();
    this.fog.setScrollFactor(0);
    this.fog.setDepth(100000);
  }

  private movePlayer() {
    if (this.storyOpen || this.dead) return;
    if (!this.keys) return;

    const input = this.getInputVector();

    if (input) {
      this.lastFacing = input.screen;
      const resolved = this.resolveMovement(input, 0.075 * PLAYER_SPEED);

      if (resolved) {
        this.playerIso = resolved;
      }

      const p = this.toScreen(this.playerIso);
      this.player.setPosition(p.x, p.y);
      this.playerBody.setFillStyle(0x2c3c45);
    } else {
      this.playerBody.setFillStyle(0x23313a);
    }
  }

  private updatePlayerLight(time: number) {
    const wobble = Math.sin(time * 0.012) * 0.025 + Math.sin(time * 0.031) * 0.012;
    const instability = 1 + this.realityDistortion * 1.6;
    this.flashlight.setAlpha(0.1 + Math.sin(time * 0.006 * instability) * 0.026);
    this.flashlight.setScale(1 + wobble * instability, 1 + Math.abs(wobble) * 1.4);
    this.flashlight.setRotation(Math.atan2(this.lastFacing.y, this.lastFacing.x) + wobble);

    const lakeFactor = this.zoneFactor("lake", this.playerIso);
    const p = this.toScreen(this.playerIso);
    this.delayedReflection.setAlpha(lakeFactor * (0.1 + this.realityDistortion * 0.16));
    this.delayedReflection.x += (p.x + 22 - this.delayedReflection.x) * 0.035;
    this.delayedReflection.y += (p.y + 38 - this.delayedReflection.y) * 0.035;
    this.delayedReflection.setScale(1 + Math.sin(time * 0.003) * 0.08, 1);
  }

  private updateAtmosphere(time: number) {
    const profile = stageProfiles[this.storyStage];
    const medical = this.zoneFactor("medical", this.playerIso);
    const medicalLibrary = this.zoneFactor("medicalLibrary", this.playerIso);
    const swamp = this.zoneFactor("swamp", this.playerIso);
    const lake = this.zoneFactor("lake", this.playerIso);
    const baisha = this.zoneFactor("baisha", this.playerIso);
    const bridge = this.zoneFactor("yangmingBridge", this.playerIso);
    const theater = this.zoneFactor("theater", this.playerIso);

    this.realityDistortion = Phaser.Math.Clamp(
      profile.baseDistortion +
        medical * 0.28 +
        medicalLibrary * 0.08 +
        swamp * 0.22 +
        lake * 0.12 +
        baisha * 0.12 +
        bridge * 0.1 +
        theater * 0.04,
      0,
      1,
    );

    this.updateMedicalVisitHooks(time, medical);
    this.updateEventObjects(time, { medical, medicalLibrary, swamp, lake, baisha, bridge, theater });
    this.updateLabelGlitches(time, { medical, medicalLibrary, swamp, lake, baisha, bridge, theater });
    this.maybeTriggerGhostWall(time, swamp);
    this.updateUiAtmosphere(time, { medical, medicalLibrary, swamp, lake, baisha, bridge, theater });
  }

  private updateMedicalVisitHooks(time: number, medicalFactor: number) {
    const nearMedical = medicalFactor > 0.56;
    if (nearMedical && !this.wasNearMedical) {
      this.medicalVisitCount += 1;
      if (this.medicalVisitCount === 1) this.eventFlags.add("heard-opera-once");
      if (this.medicalVisitCount >= 2) this.eventFlags.add("sixth-floor-silhouette");
    }
    this.wasNearMedical = nearMedical;

    if (this.medicalSixthWindow && medicalFactor > 0.38 && time % 6200 < 420) {
      this.medicalSixthWindow.setAlpha(0.78);
    }
  }

  private updateEventObjects(
    time: number,
    factors: { medical: number; medicalLibrary: number; swamp: number; lake: number; baisha: number; bridge: number; theater: number },
  ) {
    const showSilhouette =
      this.eventFlags.has("sixth-floor-silhouette") &&
      this.storyStage >= 3 &&
      this.realityDistortion > 0.54 &&
      time % 11200 > 900 &&
      time % 11200 < 1550;
    this.setContainerAlpha(this.medicalSilhouette, showSilhouette ? 0.28 : 0);

    const entryDistance = this.distance(this.playerIso, { x: 12.6, y: 30.25 });
    const showFootTrace = this.storyStage >= 3 && entryDistance < 1.45 && time % 6800 < 1050;
    this.setContainerAlpha(this.medicalFootTrace, showFootTrace ? 0.5 : 0);

    const toiletDistance = this.distance(this.playerIso, { x: 14.1, y: 29.6 });
    if (this.mirrorGlitch) {
      this.mirrorGlitch.setAlpha(this.storyStage >= 3 && toiletDistance < 2.0 ? 0.1 + Math.sin(time * 0.018) * 0.08 : 0);
      this.mirrorGlitch.setScale(1 + Math.sin(time * 0.022) * 0.08, 1);
    }

    const warehouseDistance = this.distance(this.playerIso, { x: 11.4, y: 28.8 });
    this.setContainerAlpha(
      this.warehouseShadow,
      this.storyStage >= 3 && warehouseDistance < 2.7 ? 0.16 + Math.sin(time * 0.005) * 0.08 : 0,
    );

    const lakeFigureAlpha = (this.storyStage >= 4 || this.realityDistortion > 0.68) && factors.lake > 0.28 ? 0.18 : 0;
    this.setContainerAlpha(this.lakeExtraFigure, lakeFigureAlpha);

    if (this.baisha216Window) {
      const highBaisha = this.storyStage >= 4 || this.realityDistortion > 0.62;
      this.baisha216Window.setFillStyle(highBaisha ? 0xdcebe8 : 0xf0d19a);
      this.baisha216Window.setAlpha(highBaisha ? 0.16 + Math.sin(time * 0.009) * 0.14 : 0.46);
    }
  }

  private updateLabelGlitches(
    time: number,
    factors: { medical: number; medicalLibrary: number; swamp: number; lake: number; baisha: number; bridge: number; theater: number },
  ) {
    this.buildingLabels.forEach((label, id) => {
      const baseText = label.getData("baseText") as string;
      const theme = buildingThemes[id];
      const building = campusBuildings.find((item) => item.id === id);
      const buildingCenter = building ? { x: building.x + building.w / 2, y: building.y + building.d / 2 } : this.playerIso;
      const proximity = building ? Phaser.Math.Clamp(1 - this.distance(this.playerIso, buildingCenter) / 5.8, 0, 1) : 0;
      let factor = 0;
      if (id === "medical-college") factor = factors.medical;
      if (id === "medical-library") factor = factors.medicalLibrary;
      if (id === "dorm-baisha") factor = factors.baisha;
      if (id === "little-theater") factor = factors.theater;
      if (id === "library") factor = 0.16 + this.realityDistortion * 0.18;
      if (id.startsWith("east-teaching")) factor = this.realityDistortion > 0.58 ? 0.22 : 0;

      const glitch = theme?.altLabels && this.realityDistortion > 0.54 && factor > 0.18 && time % 7600 < 720;
      if (glitch && theme.altLabels) {
        const index = Math.floor(time / 180) % theme.altLabels.length;
        label.setText(theme.altLabels[index]);
        label.setAlpha(0.24 + proximity * 0.22 + Math.sin(time * 0.05) * 0.18);
        label.setScale(0.94 + Math.sin(time * 0.04) * 0.03);
      } else {
        label.setText(baseText);
        label.setAlpha(0.2 + proximity * 0.55 + factor * 0.22);
        label.setScale(0.88 + proximity * 0.1);
      }
    });
  }

  private maybeTriggerGhostWall(time: number, swampFactor: number) {
    if (this.storyStage < 3 || this.realityDistortion < 0.6 || swampFactor < 0.68 || time < this.ghostWallCooldown) return;

    this.ghostWallCooldown = time + 18000;
    this.statusLabel = "路线重复";
    this.cameras.main.fadeOut(220, 3, 8, 7);
    this.time.delayedCall(180, () => {
      this.playerIso = { x: 4.0, y: 27.0 };
      const p = this.toScreen(this.playerIso);
      this.player.setPosition(p.x, p.y);
      this.cameras.main.fadeIn(260, 3, 8, 7);
    });
  }

  private updateUiAtmosphere(
    time: number,
    factors: { medical: number; medicalLibrary: number; swamp: number; lake: number; baisha: number; bridge: number; theater: number },
  ) {
    const profile = stageProfiles[this.storyStage];
    let nextStatus = profile.statusPool[Math.floor(time / 6400) % profile.statusPool.length] ?? "校园静默";
    let nextTime = "00:47";

    const activeEvent = ambientEvents.find(
      (event) =>
        this.storyStage >= event.stageMin &&
        this.realityDistortion >= event.minDistortion &&
        (factors[event.zoneId as keyof typeof factors] ?? 0) > 0.26,
    );

    if (activeEvent && time % 9200 < 1600) {
      nextStatus = activeEvent.status;
      if (activeEvent.timeLabel) nextTime = activeEvent.timeLabel;
    } else if (this.realityDistortion > 0.64 && time % 11800 < 760) {
      nextTime = profile.timeJumps[Math.floor(time / 190) % profile.timeJumps.length] ?? "02:26";
      nextStatus = profile.statusPool[(Math.floor(time / 240) + 1) % profile.statusPool.length] ?? nextStatus;
    }

    this.statusLabel = nextStatus;
    this.timeLabel = nextTime;
    if (time - this.lastAtmosphereEmit < 300) return;
    this.lastAtmosphereEmit = time;
    const detail: HorrorAtmosphereEvent = {
      timeLabel: this.timeLabel,
      statusLabel: this.statusLabel,
      stage: this.storyStage,
      stageName: profile.name,
      realityDistortion: this.realityDistortion,
    };
    window.dispatchEvent(new CustomEvent<HorrorAtmosphereEvent>("zju-horror-atmosphere", { detail }));
  }

  private setContainerAlpha(container: Phaser.GameObjects.Container | undefined, alpha: number) {
    if (!container) return;
    container.each((child: Phaser.GameObjects.GameObject) => {
      const object = child as Phaser.GameObjects.GameObject & { setAlpha?: (value: number) => void };
      object.setAlpha?.(Phaser.Math.Clamp(alpha, 0, 1));
    });
  }

  private getInputVector(): InputVector | null {
    if (!this.keys) return null;

    let screenX = 0;
    let screenY = 0;
    if (this.keys.left.isDown || this.keys.a.isDown) screenX -= 1;
    if (this.keys.right.isDown || this.keys.d.isDown) screenX += 1;
    if (this.keys.up.isDown || this.keys.w.isDown) screenY -= 1;
    if (this.keys.down.isDown || this.keys.s.isDown) screenY += 1;
    if (screenX === 0 && screenY === 0) return null;

    const screenLength = Math.hypot(screenX, screenY);
    const screen = { x: screenX / screenLength, y: screenY / screenLength };
    const iso = this.normalize({
      x: screen.x / TILE_W + screen.y / TILE_H,
      y: screen.y / TILE_H - screen.x / TILE_W,
    });

    return { screen, iso };
  }

  private resolveMovement(input: InputVector, stepDistance: number) {
    const nearest = this.nearestRoadProjection(this.playerIso);
    const onRoad = nearest !== null && nearest.distance <= ROAD_SNAP_RADIUS;

    if (onRoad && nearest) {
      const options = this.availableDirections(this.playerIso, nearest);

      // If we have a locked direction that is still available, require a
      // clear threshold (0.4) before switching.  This prevents the
      // flicker / jitter that otherwise happens at symmetric junctions
      // where two road branches score identically.
      let best = options[0];
      let bestScore = Number.NEGATIVE_INFINITY;
      const hysteresisThreshold = 0.4;

      for (const opt of options) {
        let score = this.dot(input.screen, opt.screenDirection);
        if (
          this.lockedMoveDir &&
          Math.abs(opt.direction.x - this.lockedMoveDir.x) < 0.005 &&
          Math.abs(opt.direction.y - this.lockedMoveDir.y) < 0.005
        ) {
          score += hysteresisThreshold;
        }
        if (score > bestScore) {
          best = opt;
          bestScore = score;
        }
      }

      // Lock the chosen direction so the next frame applies hysteresis.
      this.lockedMoveDir = best.direction;
      this.lockedScreenDir = best.screenDirection;

      // Always move at full speed — no score-based scaling.
      const moved = {
        x: this.playerIso.x + best.direction.x * stepDistance,
        y: this.playerIso.y + best.direction.y * stepDistance,
      };
      return this.resolveWalkablePoint(this.clampToMap(moved));
    }

    // Off-road / plaza — clear the lock so we re-evaluate freely.
    this.lockedMoveDir = null;
    this.lockedScreenDir = null;
    const desired = {
      x: this.playerIso.x + input.iso.x * stepDistance,
      y: this.playerIso.y + input.iso.y * stepDistance,
    };
    return this.resolveWalkablePoint(this.clampToMap(desired));
  }

  /**
   * All unique road directions the player can take from `point`.
   * Always includes forward / reverse on the current road segment,
   * plus any segment starting from a junction node within range.
   */
  private availableDirections(
    point: IsoPoint,
    nearest: RoadProjection,
  ): { direction: IsoPoint; screenDirection: IsoPoint }[] {
    const result: { direction: IsoPoint; screenDirection: IsoPoint }[] = [];
    const seen = new Set<string>();

    const add = (dir: IsoPoint) => {
      const key = `${dir.x.toFixed(4)},${dir.y.toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ direction: dir, screenDirection: this.normalize(this.toScreenDelta(dir)) });
    };

    // Current road — forward / reverse, but only when the player is
    // not at a segment endpoint (t ≈ 0 or t ≈ 1). At endpoints the
    // junction-node logic below supplies the valid continuation.
    if (nearest.t < 0.98) add(nearest.direction);
    if (nearest.t > 0.02) add({ x: -nearest.direction.x, y: -nearest.direction.y });

    // Connecting segments at nearby junction nodes.
    for (const road of campusRoads) {
      for (const rp of road.points) {
        if (Math.hypot(point.x - rp.x, point.y - rp.y) > JUNCTION_RADIUS) continue;
        // rp is a junction node near the player — add every segment
        // that starts or ends at this node.
        for (const other of campusRoads) {
          for (let i = 0; i < other.points.length - 1; i += 1) {
            const a = other.points[i];
            const b = other.points[i + 1];
            if (Math.hypot(rp.x - a.x, rp.y - a.y) < 0.05) {
              add(this.normalize({ x: b.x - a.x, y: b.y - a.y }));
            }
            if (Math.hypot(rp.x - b.x, rp.y - b.y) < 0.05) {
              add(this.normalize({ x: a.x - b.x, y: a.y - b.y }));
            }
          }
        }
      }
    }

    return result;
  }

  private resolveWalkablePoint(point: IsoPoint) {
    if (this.isOutOfMap(point)) return null;

    // Inside a plaza — free movement (but never enter buildings / water).
    if (this.isInPlaza(point) && !this.isBlocked(point)) return point;

    // Snap to the nearest road.  IMPORTANT: do NOT check isBlocked on
    // the snapped road point — roads are always walkable by design,
    // even when they pass close to water or building edges.
    const nearest = this.nearestRoadPoint(point);
    if (nearest) {
      if (nearest.distance <= ROAD_SNAP_RADIUS) return nearest.point;
      // Wider safety-net for plaza→road / tight junction gaps.
      if (nearest.distance <= ROAD_SNAP_RADIUS * 1.8) return nearest.point;
    }

    // Not near any road — can't walk here.
    return null;
  }

  private isWalkable(point: IsoPoint) {
    return this.resolveWalkablePoint(point) !== null;
  }

  private isOutOfMap(point: IsoPoint) {
    return point.x < 1.5 || point.y < 1.5 || point.x > MAP_W - 2 || point.y > MAP_D - 2;
  }

  private isInPlaza(point: IsoPoint) {
    return campusPlazas.some(
      (plaza) =>
        point.x >= plaza.x &&
        point.x <= plaza.x + plaza.w &&
        point.y >= plaza.y &&
        point.y <= plaza.y + plaza.d,
    );
  }

  private isBlocked(point: IsoPoint) {
    const inWater = campusWaters.some((water) => this.pointInPolygon(point, water.points));
    if (inWater) return true;

    return campusBuildings.some(
      (building) =>
        point.x > building.x + 0.08 &&
        point.x < building.x + building.w - 0.08 &&
        point.y > building.y + 0.08 &&
        point.y < building.y + building.d - 0.08,
    );
  }

  private nearestRoadPoint(point: IsoPoint): { point: IsoPoint; distance: number } | null {
    const nearest = this.nearestRoadProjection(point);
    if (!nearest) return null;
    return { point: nearest.point, distance: nearest.distance };
  }

  private nearestRoadProjection(point: IsoPoint): RoadProjection | null {
    let best: RoadProjection | null = null;
    for (const road of campusRoads) {
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const segmentStart = road.points[index];
        const segmentEnd = road.points[index + 1];
        const segmentVector = { x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y };
        const length = Math.hypot(segmentVector.x, segmentVector.y);
        if (length === 0) continue;

        const candidate = this.projectToSegment(point, segmentStart, segmentEnd);
        if (!best || candidate.distance < best.distance) {
          const direction = { x: segmentVector.x / length, y: segmentVector.y / length };
          best = {
            ...candidate,
            roadId: road.id,
            segmentIndex: index,
            segmentStart,
            segmentEnd,
            direction,
            screenDirection: this.normalize(this.toScreenDelta(direction)),
            length,
          };
        }
      }
    }
    return best as RoadProjection | null;
  }

  private projectToSegment(point: IsoPoint, a: IsoPoint, b: IsoPoint) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = point.x - a.x;
    const wy = point.y - a.y;
    const lengthSq = vx * vx + vy * vy;
    if (lengthSq === 0) {
      return { point: a, distance: Math.hypot(point.x - a.x, point.y - a.y), t: 0 };
    }
    const t = Phaser.Math.Clamp((wx * vx + wy * vy) / lengthSq, 0, 1);
    const projection = { x: a.x + t * vx, y: a.y + t * vy };
    return { point: projection, distance: Math.hypot(point.x - projection.x, point.y - projection.y), t };
  }

  private clampToMap(point: IsoPoint) {
    return {
      x: Phaser.Math.Clamp(point.x, 1.5, MAP_W - 2),
      y: Phaser.Math.Clamp(point.y, 1.5, MAP_D - 2),
    };
  }

  private zoneFactor(zoneId: string, point: IsoPoint) {
    const zone = horrorZones[zoneId];
    if (!zone) return 0;
    const d = this.distance(point, zone.center);
    return Phaser.Math.Clamp((1 - d / zone.radius) * zone.strength, 0, 1);
  }

  private distance(a: IsoPoint, b: IsoPoint) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private toScreenDelta(point: IsoPoint) {
    return {
      x: (point.x - point.y) * (TILE_W / 2),
      y: (point.x + point.y) * (TILE_H / 2),
    };
  }

  private normalize(point: IsoPoint) {
    const length = Math.hypot(point.x, point.y);
    if (length === 0) return { x: 0, y: 0 };
    return { x: point.x / length, y: point.y / length };
  }

  private dot(a: IsoPoint, b: IsoPoint) {
    return a.x * b.x + a.y * b.y;
  }

  private pointInPolygon(point: IsoPoint, polygon: IsoPoint[]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const pi = polygon[i];
      const pj = polygon[j];
      const intersects =
        pi.y > point.y !== pj.y > point.y &&
        point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  private updateDepth() {
    this.player.setDepth(this.player.y + 48);
  }

  private updateFog(time: number) {
    this.lakeMist.clear();
    fogLayers.forEach((layer) => {
      const zone = horrorZones[layer.zoneId];
      if (!zone) return;
      const stageBoost = 1 + this.realityDistortion * 1.45;
      for (let i = 0; i < layer.count; i += 1) {
        const angle = i * 1.91;
        const radius = (i % 5) * 0.72 + (i / layer.count) * zone.radius * 0.56;
        const point = {
          x: zone.center.x + Math.cos(angle) * radius + Math.sin(time * 0.00036 * layer.drift + i) * 0.42,
          y: zone.center.y + Math.sin(angle) * radius * 0.7 + Math.cos(time * 0.00031 * layer.drift + i) * 0.42,
        };
        const p = this.toScreen(point);
        this.lakeMist.fillStyle(layer.color, layer.alpha * stageBoost);
        this.lakeMist.fillEllipse(
          p.x,
          p.y - 18 + Math.sin(time * 0.001 * layer.drift + i) * 9,
          layer.width + (i % 4) * 14,
          layer.height + (i % 3) * 6,
        );
      }
    });

    const camera = this.cameras.main;
    this.fog.clear();
    this.fog.fillStyle(0x020504, 0.14 + this.realityDistortion * 0.09);
    this.fog.fillRect(0, 0, camera.width, camera.height);
    for (let i = 0; i < 13; i += 1) {
      const x = ((time * 0.009 + i * 173) % (camera.width + 320)) - 160;
      const y = 68 + ((i * 79 + Math.sin(time * 0.0007 + i) * 48) % Math.max(camera.height - 96, 160));
      this.fog.fillStyle(i % 4 === 0 ? 0xa9d8cf : 0xd7ddd1, (i % 4 === 0 ? 0.026 : 0.018) * (1 + this.realityDistortion * 0.8));
      this.fog.fillEllipse(x, y, 240 + i * 10, 40 + (i % 3) * 8);
    }

    const tearY = 90 + ((time * 0.047) % Math.max(camera.height - 90, 180));
    if (Math.floor(time / 2600) % 4 === 0) {
      this.fog.fillStyle(0xb55651, 0.035);
      this.fog.fillRect(0, tearY, camera.width, 2);
    }
  }

  private shade(color: number, amount: number) {
    const r = Phaser.Math.Clamp(((color >> 16) & 255) + amount, 0, 255);
    const g = Phaser.Math.Clamp(((color >> 8) & 255) + amount, 0, 255);
    const b = Phaser.Math.Clamp((color & 255) + amount, 0, 255);
    return (r << 16) + (g << 8) + b;
  }

  // ── Teammate: story hotspot & ghost system ──────────────────────

  private drawTaskMarkers() {
    storyHotspots.forEach((hotspot) => {
      const p = this.toScreen(hotspot);
      const marker = this.add.container(p.x, p.y - 12);
      const beam = this.add.ellipse(0, -34, 34, 112, 0xb92828, 0.08);
      const ring = this.add.ellipse(0, 0, 72, 28, 0xb92828, 0.28);
      const core = this.add.circle(0, -16, 10, 0xe8d2a4, 0.92);
      const icon = this.add.text(0, -18, `${hotspot.order}`, {
        fontFamily: "Microsoft YaHei, Arial, sans-serif",
        fontSize: "13px",
        color: "#160b0b",
        fontStyle: "bold",
      }).setOrigin(0.5);
      const arrow = this.add
        .text(0, -72, "目标", {
          fontFamily: "Microsoft YaHei, sans-serif",
          fontSize: "13px",
          color: "#ffd5be",
          backgroundColor: "rgba(113, 8, 8, 0.9)",
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5);
      const label = this.add
        .text(0, 17, hotspot.title, {
          fontFamily: "Microsoft YaHei, sans-serif",
          fontSize: "13px",
          color: "#f2e4cf",
          backgroundColor: "rgba(12, 6, 6, 0.72)",
          padding: { x: 7, y: 3 },
        })
        .setOrigin(0.5);
      marker.add([beam, ring, core, icon, arrow, label]);
      marker.setDepth(p.y + 24);
      marker.setData("hotspotId", hotspot.id);
      this.hotspotMarkers.set(hotspot.id, { container: marker, beam, ring, core, label, arrow });
      this.tweens.add({
        targets: [beam, ring, core],
        alpha: { from: 0.18, to: 0.82 },
        scaleX: { from: 0.88, to: 1.16 },
        scaleY: { from: 0.88, to: 1.16 },
        duration: 980 + hotspot.order * 90,
        yoyo: true,
        repeat: -1,
      });
    });
    this.updateHotspotMarkerStates();
  }

  private drawHorrorApparitions() {
    const apparitions = [
      { x: 18.8, y: 22.8, delay: 0 },
      { x: 31.2, y: 19.6, delay: 900 },
      { x: 12.1, y: 12.0, delay: 1600 },
    ];
    apparitions.forEach((ghost) => {
      const p = this.toScreen(ghost);
      const body = this.add.ellipse(p.x, p.y - 42, 24, 58, 0xd8e1d5, 0.0);
      const head = this.add.circle(p.x, p.y - 80, 10, 0xd8e1d5, 0.0);
      body.setDepth(p.y + 34);
      head.setDepth(p.y + 35);
      this.tweens.add({
        targets: [body, head],
        alpha: { from: 0, to: 0.16 },
        x: `+=${ghost.delay === 0 ? 18 : -14}`,
        duration: 2600,
        delay: ghost.delay,
        hold: 500,
        yoyo: true,
        repeat: -1,
        repeatDelay: 4200,
      });
    });
  }

  private createGuideLine() {
    this.guideLine = this.add.graphics();
    this.guideLine.setDepth(99998);
  }

  private createGhost() {
    const spawn = this.pickGhostSpawnPoint();
    const p = this.toScreen(spawn);
    const container = this.add.container(p.x, p.y);
    const aura = this.add.circle(0, -18, 38, 0xc90000, 0.16);
    const shadow = this.add.ellipse(0, 14, 34, 12, 0x240000, 0.55);
    const body = this.add.ellipse(0, -16, 22, 46, 0xbb0909, 0.86);
    const head = this.add.circle(0, -48, 10, 0xff1d1d, 0.88);
    const eyes = this.add.rectangle(0, -50, 16, 3, 0xffd6d6, 0.92);
    container.add([aura, shadow, body, head, eyes]);
    container.setDepth(p.y + 44);
    this.tweens.add({
      targets: [aura, body, head],
      alpha: { from: 0.35, to: 0.92 },
      scaleX: { from: 0.92, to: 1.1 },
      scaleY: { from: 0.92, to: 1.08 },
      duration: 720,
      yoyo: true,
      repeat: -1,
    });
    this.ghost = {
      container,
      aura,
      body,
      head,
      iso: spawn,
      route: [],
      routeIndex: 1,
      lastRouteAt: 0,
      lastSanityHitAt: 0,
      nextSpawnAt: GHOST_SPAWN_DELAY,
      shouldRespawn: false,
    };
    container.setVisible(false);
  }

  private createScreenEffects() {
    const camera = this.cameras.main;
    this.effectFlash = this.add.rectangle(0, 0, camera.width, camera.height, 0x7a0606, 0);
    this.effectFlash.setOrigin(0);
    this.effectFlash.setScrollFactor(0);
    this.effectFlash.setDepth(100001);
  }

  private updateGhost(time: number) {
    if (!this.ghost || this.dead) {
      return;
    }
    if (this.storyOpen) {
      this.ghost.container.setVisible(false);
      this.ghost.nextSpawnAt = time + GHOST_SPAWN_DELAY;
      this.ghost.shouldRespawn = true;
      return;
    }
    if (time < this.ghost.nextSpawnAt) {
      this.ghost.container.setVisible(false);
      return;
    }
    if (this.ghost.shouldRespawn) {
      this.ghost.iso = this.pickGhostSpawnPoint();
      this.ghost.route = [];
      this.ghost.routeIndex = 1;
      this.ghost.shouldRespawn = false;
    }
    this.ghost.container.setVisible(true);
    if (
      !this.ghost.route.length ||
      time - this.ghost.lastRouteAt > GHOST_ROUTE_REFRESH_INTERVAL ||
      this.ghost.routeIndex >= this.ghost.route.length
    ) {
      this.ghost.route = this.findRoadRoute(this.ghost.iso, this.playerIso);
      this.ghost.routeIndex = 1;
      this.ghost.lastRouteAt = time;
    }
    let step = 0.075 * GHOST_SPEED;
    while (step > 0 && this.ghost.routeIndex < this.ghost.route.length) {
      const target = this.ghost.route[this.ghost.routeIndex];
      const dx = target.x - this.ghost.iso.x;
      const dy = target.y - this.ghost.iso.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= step) {
        this.ghost.iso = { ...target };
        this.ghost.routeIndex += 1;
        step -= distance;
      } else {
        this.ghost.iso = {
          x: this.ghost.iso.x + (dx / distance) * step,
          y: this.ghost.iso.y + (dy / distance) * step,
        };
        step = 0;
      }
    }
    const p = this.toScreen(this.ghost.iso);
    this.ghost.container.setPosition(p.x, p.y);
    this.ghost.container.setDepth(p.y + 52);
    const playerDistance = Math.hypot(this.ghost.iso.x - this.playerIso.x, this.ghost.iso.y - this.playerIso.y);
    if (playerDistance <= GHOST_CAUGHT_RADIUS) {
      this.dead = true;
      this.ghost.container.setVisible(false);
      this.cameras.main.shake(620, 0.018);
      this.flashScreen(0.72, 700);
      window.dispatchEvent(new CustomEvent("zju-horror-ghost-hit", { detail: { type: "death" } }));
      return;
    }
    if (playerDistance <= GHOST_CLOSE_RADIUS && time - this.ghost.lastSanityHitAt > GHOST_SANITY_COOLDOWN) {
      this.ghost.lastSanityHitAt = time;
      this.cameras.main.shake(260, 0.006);
      this.flashScreen(0.24, 320);
      window.dispatchEvent(new CustomEvent("zju-horror-ghost-hit", { detail: { type: "sanity", amount: -5 } }));
    }
  }

  private updateHotspotRange(time: number) {
    let nearest: StoryHotspot | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    storyHotspots
      .filter((hotspot) => hotspot.id === this.guideHotspotId)
      .forEach((hotspot) => {
        const distance = Math.hypot(this.playerIso.x - hotspot.x, this.playerIso.y - hotspot.y);
        if (distance < nearestDistance) {
          nearest = hotspot;
          nearestDistance = distance;
        }
      });
    this.activeHotspot = nearest && nearestDistance < nearest.radius ? nearest : undefined;
    if (this.activeHotspot) {
      this.emitHud(this.activeHotspot.place, `已抵达：${this.activeHotspot.title}`, this.activeHotspot.id);
    } else {
      const place = this.findNearbyPlace();
      this.emitHud(place, "");
    }
    this.updateHotspotMarkerStates();
    if (this.activeHotspot && time - this.lastInteract > 800 && !this.storyOpen) {
      this.lastInteract = time;
      this.visitedHotspots.add(this.activeHotspot.id);
      this.updateHotspotMarkerStates();
      window.dispatchEvent(
        new CustomEvent<{ hotspotId: HotspotId; sceneId: StorySceneId }>("zju-horror-open-story", {
          detail: { hotspotId: this.activeHotspot.id, sceneId: this.activeHotspot.sceneId },
        }),
      );
    }
  }

  private updateGuideLine(time: number) {
    if (!this.guideLine) return;
    const target = storyHotspots.find((hotspot) => hotspot.id === this.guideHotspotId);
    this.guideLine.clear();
    if (!target || this.storyOpen) return;
    const route = this.findRoadRoute(this.playerIso, target);
    const dash = 24;
    const gap = 17;
    const phase = (time * 0.075) % (dash + gap);
    const camera = this.cameras.main;
    const alpha = this.activeHotspot?.id === target.id ? 0.28 : 0.68;
    this.guideLine.lineStyle(5, 0xe35c4d, alpha);
    this.drawDashedRoute(route, dash, gap, phase);
    const end = this.toScreen(target);
    this.guideLine.fillStyle(0xe35c4d, 0.72);
    this.guideLine.fillCircle(end.x, end.y - 18 + Math.sin(time * 0.006) * 3, 7);
    this.guideLine.setDepth(camera.scrollY + end.y + 120);
  }

  private drawDashedRoute(route: IsoPoint[], dash: number, gap: number, phase: number) {
    let carry = -phase;
    for (let index = 0; index < route.length - 1; index += 1) {
      const start = this.toScreen(route[index]);
      const end = this.toScreen(route[index + 1]);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) continue;
      const ux = dx / distance;
      const uy = dy / distance;
      for (let offset = carry; offset < distance; offset += dash + gap) {
        const from = Math.max(0, offset);
        const to = Math.min(distance, offset + dash);
        if (to <= 0) continue;
        this.guideLine.beginPath();
        this.guideLine.moveTo(start.x + ux * from, start.y + uy * from);
        this.guideLine.lineTo(start.x + ux * to, start.y + uy * to);
        this.guideLine.strokePath();
      }
      carry = (carry + distance) % (dash + gap);
    }
  }

  private findNearbyPlace() {
    let label = "";
    let distance = 3.2;
    campusBuildings.forEach((building) => {
      const center = { x: building.x + building.w / 2, y: building.y + building.d / 2 };
      const d = Math.hypot(this.playerIso.x - center.x, this.playerIso.y - center.y);
      if (d < distance) {
        label = building.name;
        distance = d;
      }
    });
    return label;
  }

  private emitHud(place: string, prompt: string, activeHotspotId?: HotspotId) {
    const event: GameHudEvent = {
      place,
      prompt,
      activeHotspotId,
    };
    const signature = JSON.stringify(event);
    if (signature === this.lastHudSignature) return;
    this.lastHudSignature = signature;
    window.dispatchEvent(new CustomEvent<GameHudEvent>("zju-horror-hud", { detail: event }));
  }

  private emitMiniMap(time: number) {
    if (time - this.lastMiniMapAt < 80) return;
    this.lastMiniMapAt = time;
    const ghostVisible = Boolean(this.ghost && this.ghost.container.visible && !this.storyOpen && !this.dead);
    window.dispatchEvent(
      new CustomEvent<GameMiniMapEvent>("zju-horror-minimap", {
        detail: {
          player: { ...this.playerIso },
          ghost: ghostVisible && this.ghost ? { ...this.ghost.iso } : undefined,
          ghostVisible,
        },
      }),
    );
  }

  private handleMapState = (event: Event) => {
    if (!this.sceneReady) return;
    const detail = (event as CustomEvent<MapStateEvent>).detail;
    this.guideHotspotId = detail.guideHotspotId;
    this.completedHotspots = new Set(detail.completedHotspotIds);
    this.visitedHotspots = new Set(detail.visitedHotspotIds);
    this.sanity = detail.sanity;
    this.storyOpen = detail.activeStory;
    this.updateHotspotMarkerStates();
  };

  private handleHorrorEffect = (event: Event) => {
    if (!this.sceneReady) return;
    const effect = (event as CustomEvent<{ effect?: HorrorEffect }>).detail.effect;
    const camera = this.cameras?.main;
    if (!effect || !camera) return;
    if (effect === "jumpscare") {
      camera.shake(460, 0.012);
      this.flashScreen(0.42, 520);
      return;
    }
    if (effect === "shake") {
      camera.shake(320, 0.006);
      this.flashScreen(0.18, 300);
      return;
    }
    if (effect === "reveal" || effect === "ending") {
      camera.flash(480, 210, 230, 196, false);
    }
  };

  private flashScreen(alpha: number, duration: number) {
    if (!this.sceneReady || !this.effectFlash) return;
    const camera = this.cameras?.main;
    if (!camera) return;
    this.effectFlash.setSize(camera.width, camera.height);
    this.effectFlash.setAlpha(alpha);
    this.tweens.add({
      targets: this.effectFlash,
      alpha: 0,
      duration,
      ease: "Sine.easeOut",
    });
  }

  private updateHotspotMarkerStates() {
    if (!this.sceneReady) return;
    this.hotspotMarkers.forEach((marker, id) => {
      const isGuide = id === this.guideHotspotId;
      const isDone = this.completedHotspots.has(id);
      const isVisited = this.visitedHotspots.has(id);
      const isActive = this.activeHotspot?.id === id;
      const color = isDone ? 0x9edb73 : isGuide ? 0xd04438 : isVisited ? 0x8f7859 : 0x7d2424;
      marker.beam.setFillStyle(color, isGuide ? 0.34 : isVisited ? 0.04 : 0.06);
      marker.ring.setFillStyle(color, isActive || isGuide ? 0.64 : 0.14);
      marker.core.setFillStyle(isDone ? 0xcff18b : isGuide ? 0xffd2a4 : 0xa64b43, isDone ? 0.95 : isGuide ? 1 : 0.72);
      marker.label.setTint(isGuide ? 0xffe2c1 : isDone ? 0xdff6c2 : 0xc9b3a4);
      marker.arrow.setVisible(isGuide && !isDone);
      marker.container.setAlpha(isDone ? 0.72 : isGuide ? 1 : isVisited ? 0.48 : 0.44);
      marker.container.setScale(isGuide ? 1.28 : isActive ? 1.1 : 0.96);
    });
  }

  private roadPointKey(point: IsoPoint) {
    return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
  }

  private allRoadPoints() {
    const points: IsoPoint[] = [];
    const seen = new Set<string>();
    campusRoads.forEach((road) => {
      road.points.forEach((point) => {
        const key = this.roadPointKey(point);
        if (!seen.has(key)) {
          seen.add(key);
          points.push(point);
        }
      });
    });
    return points;
  }

  private pickGhostSpawnPoint() {
    const points = this.allRoadPoints();
    const farPoints = points.filter((point) => {
      const straightDistance = Math.hypot(point.x - this.playerIso.x, point.y - this.playerIso.y);
      if (straightDistance < GHOST_MIN_SPAWN_DISTANCE) return false;
      return this.routeLength(this.findRoadRoute(point, this.playerIso)) >= GHOST_MIN_SPAWN_ROUTE_DISTANCE;
    });
    const fallbackPoints = points.filter((point) => Math.hypot(point.x - this.playerIso.x, point.y - this.playerIso.y) > GHOST_MIN_SPAWN_DISTANCE);
    const source = farPoints.length ? farPoints : fallbackPoints.length ? fallbackPoints : points;
    return { ...source[Math.floor(Math.random() * source.length)] };
  }

  private routeLength(route: IsoPoint[]) {
    return route.reduce((total, point, index) => {
      if (index === 0) return 0;
      const previous = route[index - 1];
      return total + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
  }

  private findRoadRoute(from: IsoPoint, to: IsoPoint) {
    const startProjection = this.nearestRoadProjection(from);
    const endProjection = this.nearestRoadProjection(to);
    if (!startProjection || !endProjection) return [from, to];
    const nodes: IsoPoint[] = [];
    const nodeByKey = new Map<string, number>();
    const edges = new Map<number, RouteEdge[]>();
    const addNode = (point: IsoPoint) => {
      const key = this.roadPointKey(point);
      const existing = nodeByKey.get(key);
      if (existing !== undefined) return existing;
      const index = nodes.length;
      nodes.push({ x: point.x, y: point.y });
      nodeByKey.set(key, index);
      edges.set(index, []);
      return index;
    };
    const connect = (a: number, b: number) => {
      const distance = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      edges.get(a)!.push({ to: b, distance });
      edges.get(b)!.push({ to: a, distance });
    };
    campusRoads.forEach((road) => {
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const a = addNode(road.points[index]);
        const b = addNode(road.points[index + 1]);
        connect(a, b);
      }
    });
    const addProjectionNode = (projection: RoadProjection) => {
      const projected = addNode(projection.point);
      const start = addNode(projection.segmentStart);
      const end = addNode(projection.segmentEnd);
      connect(projected, start);
      connect(projected, end);
      return projected;
    };
    const start = addProjectionNode(startProjection);
    const end = addProjectionNode(endProjection);
    if (startProjection.roadId === endProjection.roadId && startProjection.segmentIndex === endProjection.segmentIndex) {
      connect(start, end);
    }
    const distances = Array(nodes.length).fill(Number.POSITIVE_INFINITY);
    const previous = Array<number | undefined>(nodes.length).fill(undefined);
    const visited = new Set<number>();
    distances[start] = 0;
    while (visited.size < nodes.length) {
      let current = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index < nodes.length; index += 1) {
        if (!visited.has(index) && distances[index] < best) {
          best = distances[index];
          current = index;
        }
      }
      if (current === -1 || current === end) break;
      visited.add(current);
      edges.get(current)!.forEach((edge) => {
        const next = distances[current] + edge.distance;
        if (next < distances[edge.to]) {
          distances[edge.to] = next;
          previous[edge.to] = current;
        }
      });
    }
    const route: IsoPoint[] = [];
    let cursor: number | undefined = end;
    while (cursor !== undefined) {
      route.push(nodes[cursor]);
      cursor = previous[cursor];
    }
    route.reverse();
    return route.length > 1 ? route : [startProjection.point, endProjection.point];
  }
}









