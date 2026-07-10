import type { IsoPoint } from "./mapData";

export type StoryStage = 1 | 2 | 3 | 4 | 5;

export interface BuildingTheme {
  label?: string;
  altLabels?: string[];
  body: number;
  roof: number;
  glow: number;
  labelColor: string;
}

export interface HorrorZone {
  id: string;
  name: string;
  center: IsoPoint;
  radius: number;
  strength: number;
}

export interface FogLayer {
  id: string;
  zoneId: string;
  color: number;
  count: number;
  width: number;
  height: number;
  alpha: number;
  drift: number;
}

export interface LightSource {
  id: string;
  point: IsoPoint;
  color: number;
  radius: number;
  alpha: number;
  flicker: number;
  stageMin?: StoryStage;
}

export interface AmbientEvent {
  id: string;
  zoneId: string;
  stageMin: StoryStage;
  status: string;
  timeLabel?: string;
  minDistortion: number;
}

export interface StageProfile {
  id: StoryStage;
  name: string;
  baseDistortion: number;
  statusPool: string[];
  timeJumps: string[];
}

export const defaultStoryStage: StoryStage = 3;

export const stageProfiles: Record<StoryStage, StageProfile> = {
  1: {
    id: 1,
    name: "深夜自习",
    baseDistortion: 0.14,
    statusPool: ["校园静默", "远处有戏声"],
    timeJumps: ["00:47"],
  },
  2: {
    id: 2,
    name: "李伟豪死亡后",
    baseDistortion: 0.28,
    statusPool: ["校园静默", "信号异常", "有人敲窗"],
    timeJumps: ["00:47", "02:26"],
  },
  3: {
    id: 3,
    name: "夜探医学院",
    baseDistortion: 0.46,
    statusPool: ["校园静默", "监控死角", "六楼有声音", "有人在楼道里"],
    timeJumps: ["00:47", "02:26", "02:27"],
  },
  4: {
    id: 4,
    name: "真相逼近",
    baseDistortion: 0.62,
    statusPool: ["信号异常", "监控死角", "白沙3幢216", "有人在楼道里"],
    timeJumps: ["00:47", "02:26", "02:27"],
  },
  5: {
    id: 5,
    name: "返回浙大",
    baseDistortion: 0.74,
    statusPool: ["六楼有声音", "监控死角", "记忆回流", "白秋不在这里"],
    timeJumps: ["02:26", "02:27"],
  },
};

export const buildingThemes: Record<string, BuildingTheme> = {
  "medical-college": {
    label: "医学院教学楼",
    altLabels: ["六楼走廊", "监控死角", "仓库", "厕所"],
    body: 0x526a6e,
    roof: 0x1b2730,
    glow: 0xc7e6df,
    labelColor: "#d6ebe7",
  },
  "medical-library": {
    label: "医学院图书馆",
    altLabels: ["深夜自习室", "最后借阅记录"],
    body: 0x4b5f65,
    roof: 0x1f2b32,
    glow: 0xbfd7d3,
    labelColor: "#d2e0dc",
  },
  "dorm-baisha": {
    label: "白沙学园",
    altLabels: ["白沙3幢216", "门禁日志", "她早已死亡"],
    body: 0x6a746a,
    roof: 0x2b342e,
    glow: 0xe8d39b,
    labelColor: "#e6dcc3",
  },
  "little-theater": {
    label: "小剧场",
    altLabels: ["唱戏声来源?", "空舞台"],
    body: 0x4b3d58,
    roof: 0x1e1a2a,
    glow: 0x8c3b55,
    labelColor: "#d6c7df",
  },
  library: {
    label: "基础图书馆",
    altLabels: ["旧闻档案", "治疗记录"],
    body: 0x6f3f37,
    roof: 0x361d1f,
    glow: 0xcfc2a5,
    labelColor: "#e0d6c5",
  },
  "east-teaching-1": {
    body: 0x6f5e54,
    roof: 0x332f31,
    glow: 0xa4c3ba,
    labelColor: "#cedbd6",
  },
  "east-teaching-2": {
    body: 0x665950,
    roof: 0x302d31,
    glow: 0x93b6b0,
    labelColor: "#c8d7d3",
  },
  "east-teaching-3": {
    body: 0x60534c,
    roof: 0x2e2a30,
    glow: 0x8cb0aa,
    labelColor: "#c8d7d3",
  },
  "east-teaching-4": {
    body: 0x6a5b51,
    roof: 0x302c2f,
    glow: 0x9cb8ae,
    labelColor: "#c8d7d3",
  },
};

export const horrorZones: Record<string, HorrorZone> = {
  medical: {
    id: "medical",
    name: "医学院教学楼",
    center: { x: 12.8, y: 29.7 },
    radius: 5.1,
    strength: 0.58,
  },
  medicalLibrary: {
    id: "medicalLibrary",
    name: "医学院图书馆",
    center: { x: 19.4, y: 29.4 },
    radius: 4.0,
    strength: 0.34,
  },
  swamp: {
    id: "swamp",
    name: "西区沼泽田",
    center: { x: 5.1, y: 27.8 },
    radius: 5.4,
    strength: 0.62,
  },
  lake: {
    id: "lake",
    name: "启真湖",
    center: { x: 20.0, y: 18.4 },
    radius: 7.3,
    strength: 0.38,
  },
  baisha: {
    id: "baisha",
    name: "白沙学园",
    center: { x: 6.1, y: 6.3 },
    radius: 3.8,
    strength: 0.42,
  },
  yangmingBridge: {
    id: "yangmingBridge",
    name: "阳明桥",
    center: { x: 23.4, y: 22.8 },
    radius: 2.7,
    strength: 0.36,
  },
  theater: {
    id: "theater",
    name: "小剧场",
    center: { x: 12.0, y: 10.6 },
    radius: 3.2,
    strength: 0.2,
  },
};

export const fogLayers: FogLayer[] = [
  { id: "lake-memory", zoneId: "lake", color: 0xbadbd4, count: 14, width: 220, height: 38, alpha: 0.028, drift: 0.72 },
  { id: "medical-cold", zoneId: "medical", color: 0xc8e5df, count: 10, width: 170, height: 34, alpha: 0.036, drift: 0.38 },
  { id: "swamp-low", zoneId: "swamp", color: 0x8fa39a, count: 18, width: 150, height: 32, alpha: 0.042, drift: 0.48 },
  { id: "bridge-breath", zoneId: "yangmingBridge", color: 0xb7d8d2, count: 6, width: 150, height: 28, alpha: 0.035, drift: 0.5 },
];

export const lightSources: LightSource[] = [
  { id: "med-low-1", point: { x: 10.6, y: 30.2 }, color: 0xbfded9, radius: 70, alpha: 0.09, flicker: 0.75, stageMin: 1 },
  { id: "med-low-2", point: { x: 14.2, y: 30.2 }, color: 0x9fc6c2, radius: 58, alpha: 0.07, flicker: 0.92, stageMin: 2 },
  { id: "med-library-reading", point: { x: 19.2, y: 30.0 }, color: 0xd6d8c8, radius: 90, alpha: 0.08, flicker: 0.16, stageMin: 1 },
  { id: "baisha-123", point: { x: 5.4, y: 6.9 }, color: 0xe8c980, radius: 72, alpha: 0.1, flicker: 0.2, stageMin: 1 },
  { id: "baisha-216", point: { x: 6.9, y: 6.4 }, color: 0xf1d29a, radius: 68, alpha: 0.12, flicker: 0.5, stageMin: 1 },
  { id: "lake-memory-warm", point: { x: 16.2, y: 21.6 }, color: 0xd7b36f, radius: 88, alpha: 0.08, flicker: 0.12, stageMin: 1 },
  { id: "bridge-bad-lamp", point: { x: 23.4, y: 22.8 }, color: 0xc7d8cf, radius: 78, alpha: 0.08, flicker: 1.0, stageMin: 2 },
];

export const ambientEvents: AmbientEvent[] = [
  { id: "opera-medical", zoneId: "medical", stageMin: 1, status: "六楼有声音", timeLabel: "02:26", minDistortion: 0.42 },
  { id: "dead-camera", zoneId: "medical", stageMin: 3, status: "监控死角", timeLabel: "02:27", minDistortion: 0.55 },
  { id: "baisha-window", zoneId: "baisha", stageMin: 2, status: "有人敲窗", minDistortion: 0.42 },
  { id: "lake-memory", zoneId: "lake", stageMin: 4, status: "白秋不在这里", minDistortion: 0.58 },
  { id: "swamp-loop", zoneId: "swamp", stageMin: 3, status: "路线重复", minDistortion: 0.54 },
];

/**
 * Story hotspot → skyline building(s) targeted for red-pulse guidance.
 * For buildings marked `enterable`, proximity triggers the 3D interior;
 * otherwise it triggers the text story popup.
 * `lake` maps to an empty array — the hotspot marker + guide line handle it.
 */
export const hotspotBuildingMap: Record<string, string[]> = {
  library: ["medical-library"],
  dorm: ["dorm-baisha"],
  canteen: ["linhu-canteen"],
  "du-office": ["medical-library"],
  "medical-college": ["medical-college"],
  "east-teaching": ["east-teaching-1", "east-teaching-2", "east-teaching-3", "east-teaching-4"],
  lake: [],
  theater: ["little-theater"],
};
