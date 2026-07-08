import Phaser from "phaser";
import {
  campusBuildings,
  campusRoads,
  campusPlazas,
  campusWaters,
  storyTasks,
  type CampusBuilding,
  type CampusTask,
  type IsoPoint,
} from "./mapData";

const TILE_W = 96;
const TILE_H = 48;
const ORIGIN_X = 980;
const ORIGIN_Y = 120;
const MAP_W = 42;
const MAP_D = 34;
const PLAYER_SPEED = 4.2;
const ROAD_SNAP_RADIUS = 0.72;
const WORLD_BOUNDS = { x: -1200, y: 0, width: 4300, height: 2200 };

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

export type GameHudEvent = {
  place: string;
  prompt: string;
  story: string;
  tasks: Array<{ id: string; title: string; place: string; done: boolean }>;
};

export class CampusScene extends Phaser.Scene {
  private keys?: KeySet;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Ellipse;
  private playerIso = { x: 8.3, y: 28.7 };
  private activeTask?: CampusTask;
  private completed = new Set<string>();
  private lastInteract = 0;
  private lastHudSignature = "";
  private fog!: Phaser.GameObjects.Graphics;
  private lightBeams: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super("CampusScene");
  }

  create() {
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
    this.createPlayer();
    this.createFog();

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

    this.emitHud("", "", "凌晨的紫金港校区只剩下路灯和地图上的建筑编号。先去图书馆确认闭馆记录。");
  }

  update(time: number) {
    this.movePlayer();
    this.updateDepth();
    this.updateTaskRange(time);
    this.updateFog(time);
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
      const g = this.add.graphics();
      this.drawIsoPrism(g, building);
      const center = this.toScreen({
        x: building.x + building.w / 2,
        y: building.y + building.d / 2,
      });
      g.setDepth(center.y + building.h * 26);

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
    storyTasks.forEach((task) => {
      const p = this.toScreen(task);
      const marker = this.add.container(p.x, p.y - 12);
      const ring = this.add.ellipse(0, 0, 60, 24, 0xb7d667, 0.24);
      const core = this.add.circle(0, -15, 9, 0xd3ef70, 0.9);
      const icon = this.add.text(0, -17, "!", {
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        color: "#1d251c",
        fontStyle: "bold",
      }).setOrigin(0.5);
      marker.add([ring, core, icon]);
      marker.setDepth(p.y + 24);
      marker.setData("taskId", task.id);
      this.tweens.add({
        targets: [ring, core],
        alpha: { from: 0.25, to: 0.85 },
        scaleX: { from: 0.92, to: 1.08 },
        scaleY: { from: 0.92, to: 1.08 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
      });
    });
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

  private createFog() {
    this.fog = this.add.graphics();
    this.fog.setScrollFactor(0);
    this.fog.setDepth(100000);
  }

  private movePlayer() {
    if (!this.keys) return;

    let dx = 0;
    let dy = 0;
    if (this.keys.left.isDown || this.keys.a.isDown) dx -= 1;
    if (this.keys.right.isDown || this.keys.d.isDown) dx += 1;
    if (this.keys.up.isDown || this.keys.w.isDown) dy -= 1;
    if (this.keys.down.isDown || this.keys.s.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      const stepX = (dx / length) * 0.075 * PLAYER_SPEED;
      const stepY = (dy / length) * 0.075 * PLAYER_SPEED;
      const next = {
        x: Phaser.Math.Clamp(this.playerIso.x + stepX, 1.5, MAP_W - 2),
        y: Phaser.Math.Clamp(this.playerIso.y + stepY, 1.5, MAP_D - 2),
      };
      const nextX = { x: next.x, y: this.playerIso.y };
      const nextY = { x: this.playerIso.x, y: next.y };
      const resolved = this.resolveWalkablePoint(next) ?? this.resolveWalkablePoint(nextX) ?? this.resolveWalkablePoint(nextY);

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

  private resolveWalkablePoint(point: IsoPoint) {
    if (this.isOutOfMap(point)) return null;
    if (this.isInPlaza(point) && !this.isBlocked(point)) return point;

    const nearest = this.nearestRoadPoint(point);
    if (nearest && nearest.distance <= ROAD_SNAP_RADIUS && !this.isBlocked(nearest.point)) {
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
    let best: { point: IsoPoint; distance: number } | null = null;
    for (const road of campusRoads) {
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const candidate = this.projectToSegment(point, road.points[index], road.points[index + 1]);
        if (!best || candidate.distance < best.distance) {
          best = candidate;
        }
      }
    }
    return best;
  }

  private projectToSegment(point: IsoPoint, a: IsoPoint, b: IsoPoint) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = point.x - a.x;
    const wy = point.y - a.y;
    const lengthSq = vx * vx + vy * vy;
    if (lengthSq === 0) {
      return { point: a, distance: Math.hypot(point.x - a.x, point.y - a.y) };
    }
    const t = Phaser.Math.Clamp((wx * vx + wy * vy) / lengthSq, 0, 1);
    const projection = { x: a.x + t * vx, y: a.y + t * vy };
    return { point: projection, distance: Math.hypot(point.x - projection.x, point.y - projection.y) };
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

  private updateTaskRange(time: number) {
    let nearest: CampusTask | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    storyTasks.forEach((task) => {
      if (this.completed.has(task.id)) return;
      const distance = Math.hypot(this.playerIso.x - task.x, this.playerIso.y - task.y);
      if (distance < nearestDistance) {
        nearest = task;
        nearestDistance = distance;
      }
    });

    this.activeTask = nearestDistance < 1.8 ? nearest : undefined;
    if (this.activeTask) {
      this.emitHud(this.activeTask.place, this.activeTask.prompt, "");
    } else {
      const place = this.findNearbyPlace();
      this.emitHud(place, "", "");
    }

    if (this.activeTask && this.keys?.e.isDown && time - this.lastInteract > 550) {
      this.lastInteract = time;
      this.completed.add(this.activeTask.id);
      this.emitHud(this.activeTask.place, "", this.activeTask.story);
      if (this.completed.size === storyTasks.length) {
        this.time.delayedCall(1100, () => {
          this.emitHud(
            "紫金港校区",
            "",
            "四个地点的记录拼在一起，地图上的道路开始重排。下一版可以在这里接入追逐、身份与多人任务。",
          );
        });
      }
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
    this.fog.fillStyle(0x040707, 0.42);
    this.fog.fillRect(0, 0, camera.width, camera.height);
    for (let i = 0; i < 9; i += 1) {
      const x = ((time * 0.011 + i * 177) % (camera.width + 260)) - 130;
      const y = 90 + ((i * 83 + Math.sin(time * 0.0007 + i) * 40) % (camera.height - 120));
      this.fog.fillStyle(0xc7d8cf, 0.025);
      this.fog.fillEllipse(x, y, 210 + i * 7, 42);
    }
  }

  private emitHud(place: string, prompt: string, story: string) {
    const event: GameHudEvent = {
      place,
      prompt,
      story,
      tasks: storyTasks.map((task) => ({
        id: task.id,
        title: task.title,
        place: task.place,
        done: this.completed.has(task.id),
      })),
    };
    const signature = JSON.stringify(event);
    if (signature === this.lastHudSignature) return;
    this.lastHudSignature = signature;
    window.dispatchEvent(new CustomEvent<GameHudEvent>("zju-horror-hud", { detail: event }));
  }

  private shade(color: number, amount: number) {
    const r = Phaser.Math.Clamp(((color >> 16) & 255) + amount, 0, 255);
    const g = Phaser.Math.Clamp(((color >> 8) & 255) + amount, 0, 255);
    const b = Phaser.Math.Clamp((color & 255) + amount, 0, 255);
    return (r << 16) + (g << 8) + b;
  }
}









