import Phaser from "phaser";
import {
  campusBuildings,
  campusRoads,
  campusPlazas,
  campusWaters,
  type CampusBuilding,
  type IsoPoint,
} from "./mapData";
import { storyHotspots, type HorrorEffect, type HotspotId, type StoryHotspot, type StorySceneId } from "./storyData";

const TILE_W = 96;
const TILE_H = 48;
const ORIGIN_X = 980;
const ORIGIN_Y = 120;
const MAP_W = 42;
const MAP_D = 34;
const PLAYER_SPEED = 4.2;
const GHOST_SPEED = 2.15;
const ROAD_SNAP_RADIUS = 0.72;
const ROAD_JUNCTION_RADIUS = 1.12;
const WORLD_BOUNDS = { x: -1200, y: 0, width: 4300, height: 2200 };
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

type JunctionDirection = {
  node: IsoPoint;
  segmentStart: IsoPoint;
  segmentEnd: IsoPoint;
  direction: IsoPoint;
  screenDirection: IsoPoint;
};

type RailDirection = {
  origin: IsoPoint;
  segmentStart: IsoPoint;
  segmentEnd: IsoPoint;
  direction: IsoPoint;
  screenDirection: IsoPoint;
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

export class CampusScene extends Phaser.Scene {
  private keys?: KeySet;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Ellipse;
  private playerIso = { x: 16.2, y: 30.6 };
  private activeHotspot?: StoryHotspot;
  private completedHotspots = new Set<HotspotId>();
  private visitedHotspots = new Set<HotspotId>();
  private guideHotspotId: HotspotId = "library";
  private lastInteract = 0;
  private lastHudSignature = "";
  private fog!: Phaser.GameObjects.Graphics;
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
    this.drawWater();
    this.drawPlazas();
    this.drawRoads();
    this.drawGreenery();
    this.drawBuildings();
    this.drawTaskMarkers();
    this.drawLampPosts();
    this.drawHorrorApparitions();
    this.drawOrientationLabels();
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
    graphics.lineStyle(1, 0x263532, 0.2);
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
        const base = (x + y) % 4 === 0 ? 0x21332b : 0x1b2c25;
        const edge = x < 2 || y < 2 || x > MAP_W - 4 || y > MAP_D - 4 ? 0x14231f : base;
        this.drawDiamond(g, x, y, edge, 1);
      }
    }
    g.setDepth(0);
  }

  private drawWater() {
    campusWaters.forEach((water) => {
      const g = this.add.graphics();
      const points = water.points.map((p) => this.toScreen(p));
      g.fillStyle(water.color, 0.92);
      g.lineStyle(4, 0x2c656f, 0.5);
      g.beginPath();
      points.forEach((p, index) => {
        if (index === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.setDepth(12);

      for (let i = 0; i < 9; i += 1) {
        const ripple = this.add.ellipse(
          this.toScreen({ x: 12 + i * 1.15, y: 20 + Math.sin(i) * 2 }).x,
          this.toScreen({ x: 12 + i * 1.15, y: 20 + Math.sin(i) * 2 }).y,
          90,
          16,
          0x9cd0d4,
          0.09,
        );
        ripple.setDepth(13);
        this.tweens.add({
          targets: ripple,
          alpha: { from: 0.05, to: 0.18 },
          duration: 1900 + i * 140,
          yoyo: true,
          repeat: -1,
        });
      }
    });
  }

  private drawPlazas() {
    campusPlazas.forEach((plaza) => {
      const g = this.add.graphics();
      const nw = this.toScreen({ x: plaza.x, y: plaza.y });
      const ne = this.toScreen({ x: plaza.x + plaza.w, y: plaza.y });
      const se = this.toScreen({ x: plaza.x + plaza.w, y: plaza.y + plaza.d });
      const sw = this.toScreen({ x: plaza.x, y: plaza.y + plaza.d });
      g.fillStyle(plaza.color, 0.84);
      g.lineStyle(2, 0xb7c4b5, 0.12);
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
      const mark = this.add.ellipse(center.x, center.y, plaza.w * 34, plaza.d * 18, 0xd0d6c8, 0.035);
      mark.setDepth(14.5);
    });
  }
  private drawRoads() {
    campusRoads.forEach((road) => {
      const points = road.points.map((p) => this.toScreen(p));
      const shadow = this.add.graphics();
      shadow.lineStyle(9, 0x050807, 0.42);
      shadow.beginPath();
      points.forEach((p, index) => {
        if (index === 0) shadow.moveTo(p.x, p.y + 3);
        else shadow.lineTo(p.x, p.y + 3);
      });
      shadow.strokePath();
      shadow.setDepth(15);

      const g = this.add.graphics();
      g.lineStyle(5, road.color, 0.96);
      g.beginPath();
      points.forEach((p, index) => {
        if (index === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.strokePath();
      g.setDepth(16);

      const stripe = this.add.graphics();
      stripe.lineStyle(1, 0xd7ded1, 0.34);
      stripe.beginPath();
      points.forEach((p, index) => {
        if (index === 0) stripe.moveTo(p.x, p.y);
        else stripe.lineTo(p.x, p.y);
      });
      stripe.strokePath();
      stripe.setDepth(17);
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
      const trunk = this.add.rectangle(p.x, p.y + 12, 8, 26, 0x493527, 0.8);
      trunk.setDepth(p.y + 8);
      const crown = this.add.triangle(p.x, p.y - 12, 0, 34, 22, 0, 44, 34, index % 2 ? 0x233f2d : 0x1d3728, 0.95);
      crown.setDepth(p.y + 10);
    });
  }

  private drawBuildings() {
    campusBuildings.forEach((building) => {
      if (building.id === "east-track") {
        this.drawTrackField(building);
        return;
      }

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
        .text(center.x, center.y - building.h * 35 + (building.labelOffset ?? 0), building.name, {
          fontFamily: "Microsoft YaHei, sans-serif",
          fontSize: "15px",
          color: "#d9e6d6",
          backgroundColor: "rgba(8, 14, 13, 0.62)",
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5);
      label.setDepth(center.y + building.h * 26 + 2);
    });
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

    g.fillStyle(0x0d1412, 0.5);
    g.fillEllipse(center.x + 8, center.y + 12, outerW + 16, outerH + 14);
    g.fillStyle(0x842f28, 0.98);
    g.fillEllipse(center.x, center.y, outerW, outerH);
    g.fillStyle(0x5d1f1b, 0.92);
    g.fillEllipse(center.x, center.y, outerW * 0.92, outerH * 0.88);
    g.fillStyle(0x2e5a3e, 0.98);
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
        color: "#d9e6d6",
        backgroundColor: "rgba(8, 14, 13, 0.62)",
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
    const a = this.toScreen({ x: b.x, y: b.y });
    const east = this.toScreen({ x: b.x + b.w, y: b.y });
    const south = this.toScreen({ x: b.x, y: b.y + b.d });
    const far = this.toScreen({ x: b.x + b.w, y: b.y + b.d });
    const height = b.h * 28;
    const topA = { x: a.x, y: a.y - height };
    const topEast = { x: east.x, y: east.y - height };
    const topSouth = { x: south.x, y: south.y - height };
    const topFar = { x: far.x, y: far.y - height };

    g.fillStyle(0x000000, 0.22);
    g.fillPoints(
      [
        { x: south.x - 14, y: south.y + 12 },
        { x: far.x + 24, y: far.y + 10 },
        { x: east.x + 18, y: east.y + 30 },
        { x: a.x - 18, y: a.y + 34 },
      ],
      true,
    );

    g.fillStyle(this.shade(b.color, -28), 1);
    g.beginPath();
    g.moveTo(south.x, south.y);
    g.lineTo(far.x, far.y);
    g.lineTo(topFar.x, topFar.y);
    g.lineTo(topSouth.x, topSouth.y);
    g.closePath();
    g.fillPath();

    g.fillStyle(this.shade(b.color, -8), 1);
    g.beginPath();
    g.moveTo(east.x, east.y);
    g.lineTo(far.x, far.y);
    g.lineTo(topFar.x, topFar.y);
    g.lineTo(topEast.x, topEast.y);
    g.closePath();
    g.fillPath();

    g.fillStyle(b.roof, 1);
    g.lineStyle(2, 0xb8c1ad, 0.14);
    g.beginPath();
    g.moveTo(topA.x, topA.y);
    g.lineTo(topEast.x, topEast.y);
    g.lineTo(topFar.x, topFar.y);
    g.lineTo(topSouth.x, topSouth.y);
    g.closePath();
    g.fillPath();
    g.strokePath();

    for (let i = 0; i < Math.floor(b.w); i += 1) {
      const wp = this.toScreen({ x: b.x + i + 0.7, y: b.y + b.d });
      g.fillStyle(0xf0d88a, Math.random() > 0.45 ? 0.24 : 0.06);
      g.fillRect(wp.x - 9, wp.y - height + 34, 12, 18);
      g.fillRect(wp.x - 9, wp.y - height + 64, 12, 18);
    }
  }

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

  private drawLampPosts() {
    const lamps = [
      { x: 9, y: 27 },
      { x: 14, y: 23 },
      { x: 17, y: 19 },
      { x: 23, y: 14 },
      { x: 30, y: 12 },
      { x: 25, y: 23 },
      { x: 32, y: 24 },
    ];

    lamps.forEach((lamp, index) => {
      const p = this.toScreen(lamp);
      const pole = this.add.rectangle(p.x, p.y - 15, 5, 38, 0x2b332f, 0.92);
      pole.setDepth(p.y + 10);
      const glow = this.add.circle(p.x, p.y - 38, 78, 0xe7d9a3, 0.1);
      glow.setDepth(p.y + 9);
      const bulb = this.add.circle(p.x, p.y - 38, 6, 0xf4e2a1, 0.8);
      bulb.setDepth(p.y + 11);
      this.lightBeams.push(glow);
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.05, to: index === 1 ? 0.19 : 0.12 },
        duration: 700 + index * 90,
        yoyo: true,
        repeat: -1,
      });
    });
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

  private createPlayer() {
    const p = this.toScreen(this.playerIso);
    this.player = this.add.container(p.x, p.y);
    const shadow = this.add.ellipse(0, 16, 34, 14, 0x020404, 0.4);
    this.playerBody = this.add.ellipse(0, -10, 25, 37, 0x23313a, 1);
    const face = this.add.circle(0, -30, 10, 0xd7c4a4, 1);
    const light = this.add.triangle(18, -9, 0, 0, 170, -28, 170, 34, 0xe7e0ba, 0.13);
    this.player.add([light, shadow, this.playerBody, face]);
    this.player.setDepth(p.y + 40);
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

  private snapPlayerToRoad() {
    const nearest = this.nearestRoadPoint(this.playerIso);
    if (nearest) this.playerIso = nearest.point;
  }

  private createFog() {
    this.fog = this.add.graphics();
    this.fog.setScrollFactor(0);
    this.fog.setDepth(100000);
  }

  private createScreenEffects() {
    const camera = this.cameras.main;
    this.effectFlash = this.add.rectangle(0, 0, camera.width, camera.height, 0x7a0606, 0);
    this.effectFlash.setOrigin(0);
    this.effectFlash.setScrollFactor(0);
    this.effectFlash.setDepth(100001);
  }

  private movePlayer() {
    if (this.storyOpen) return;
    if (!this.keys) return;

    const input = this.getInputVector();

    if (input) {
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

  private updateGhost(time: number) {
    if (!this.ghost || this.dead) return;

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
    if (nearest && nearest.distance <= ROAD_SNAP_RADIUS) {
      return this.resolveRailMovement(input, stepDistance, nearest);
    }

    const next = this.clampToMap({
      x: this.playerIso.x + input.iso.x * stepDistance,
      y: this.playerIso.y + input.iso.y * stepDistance,
    });
    return this.resolveWalkablePoint(next);
  }

  private resolveRailMovement(input: InputVector, stepDistance: number, nearest: RoadProjection) {
    const options = this.currentRailDirections(nearest);
    let bestOption = options[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const option of options) {
      const score = this.dot(input.screen, option.screenDirection);
      if (score > bestScore) {
        bestOption = option;
        bestScore = score;
      }
    }

    const nextOnSegment = this.projectToSegment(
      {
        x: bestOption.origin.x + bestOption.direction.x * stepDistance,
        y: bestOption.origin.y + bestOption.direction.y * stepDistance,
      },
      bestOption.segmentStart,
      bestOption.segmentEnd,
    ).point;
    const next = this.clampToMap(nextOnSegment);
    if (this.isOutOfMap(next)) return null;
    return next;
  }

  private currentRailDirections(nearest: RoadProjection) {
    const reverseDirection = { x: -nearest.direction.x, y: -nearest.direction.y };
    const directions: RailDirection[] = [];

    if (nearest.t < 0.985) {
      directions.push({
        origin: nearest.point,
        segmentStart: nearest.segmentStart,
        segmentEnd: nearest.segmentEnd,
        direction: nearest.direction,
        screenDirection: nearest.screenDirection,
      });
    }

    if (nearest.t > 0.015) {
      directions.push({
        origin: nearest.point,
        segmentStart: nearest.segmentStart,
        segmentEnd: nearest.segmentEnd,
        direction: reverseDirection,
        screenDirection: this.normalize(this.toScreenDelta(reverseDirection)),
      });
    }

    this.nearbyJunctionDirections(nearest.point).forEach((junction) => {
      directions.push({
        origin: junction.node,
        segmentStart: junction.segmentStart,
        segmentEnd: junction.segmentEnd,
        direction: junction.direction,
        screenDirection: junction.screenDirection,
      });
    });

    if (directions.length) return directions;

    return [
      {
        origin: nearest.point,
        segmentStart: nearest.segmentStart,
        segmentEnd: nearest.segmentEnd,
        direction: nearest.direction,
        screenDirection: nearest.screenDirection,
      },
      {
        origin: nearest.point,
        segmentStart: nearest.segmentStart,
        segmentEnd: nearest.segmentEnd,
        direction: reverseDirection,
        screenDirection: this.normalize(this.toScreenDelta(reverseDirection)),
      },
    ];
  }

  private resolveWalkablePoint(point: IsoPoint) {
    if (this.isOutOfMap(point)) return null;

    const nearest = this.nearestRoadPoint(point);
    if (nearest && nearest.distance <= ROAD_SNAP_RADIUS) {
      return nearest.point;
    }
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

  private nearbyJunctionDirections(point: IsoPoint) {
    const directions: JunctionDirection[] = [];
    campusRoads.forEach((road) => {
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const start = road.points[index];
        const end = road.points[index + 1];
        const vector = { x: end.x - start.x, y: end.y - start.y };
        const length = Math.hypot(vector.x, vector.y);
        if (length === 0) continue;

        const direction = { x: vector.x / length, y: vector.y / length };
        if (Math.hypot(point.x - start.x, point.y - start.y) <= ROAD_JUNCTION_RADIUS) {
          directions.push({
            node: start,
            segmentStart: start,
            segmentEnd: end,
            direction,
            screenDirection: this.normalize(this.toScreenDelta(direction)),
          });
        }
        if (Math.hypot(point.x - end.x, point.y - end.y) <= ROAD_JUNCTION_RADIUS) {
          const reverse = { x: -direction.x, y: -direction.y };
          directions.push({
            node: end,
            segmentStart: start,
            segmentEnd: end,
            direction: reverse,
            screenDirection: this.normalize(this.toScreenDelta(reverse)),
          });
        }
      }
    });
    return directions;
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

  private clampToMap(point: IsoPoint) {
    return {
      x: Phaser.Math.Clamp(point.x, 1.5, MAP_W - 2),
      y: Phaser.Math.Clamp(point.y, 1.5, MAP_D - 2),
    };
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

  private updateFog(time: number) {
    const camera = this.cameras.main;
    this.fog.clear();
    const fogAlpha = this.sanity <= 25 ? 0.62 : this.sanity <= 45 ? 0.52 : 0.42;
    this.fog.fillStyle(0x040707, fogAlpha);
    this.fog.fillRect(0, 0, camera.width, camera.height);
    for (let i = 0; i < 9; i += 1) {
      const x = ((time * 0.011 + i * 177) % (camera.width + 260)) - 130;
      const y = 90 + ((i * 83 + Math.sin(time * 0.0007 + i) * 40) % (camera.height - 120));
      this.fog.fillStyle(0xc7d8cf, 0.025);
      this.fog.fillEllipse(x, y, 210 + i * 7, 42);
    }
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

  private shade(color: number, amount: number) {
    const r = Phaser.Math.Clamp(((color >> 16) & 255) + amount, 0, 255);
    const g = Phaser.Math.Clamp(((color >> 8) & 255) + amount, 0, 255);
    const b = Phaser.Math.Clamp((color & 255) + amount, 0, 255);
    return (r << 16) + (g << 8) + b;
  }
}









