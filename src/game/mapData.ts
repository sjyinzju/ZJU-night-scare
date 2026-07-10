export type CampusZone = "academic" | "water" | "living" | "service" | "sport" | "gate" | "story";

export interface IsoPoint {
  x: number;
  y: number;
}

/**
 * 组合体块：相对建筑锚点(x,y)偏移的一个长方体，用来拼出 L 形 / 阶梯塔 / 双塔 等非方盒外形。
 * dx/dy 为相对偏移，w/d 为占地，h 为该体块高度（层数）。
 * bodyShade/roofShade 为在建筑主色上的明暗微调（正数更亮，负数更暗），用来区分层次。
 */
export interface BuildingMass {
  dx: number;
  dy: number;
  w: number;
  d: number;
  h: number;
  bodyShade?: number;
  roofShade?: number;
}

export type BuildingShape = "box" | "L" | "tower" | "stepped" | "twin" | "slab" | "hall";

export interface CampusBuilding {
  id: string;
  name: string;
  zone: CampusZone;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  color: number;
  roof: number;
  labelOffset?: number;
  /** 语义形状标记（供 3D 内景 / 小地图使用）。缺省视为 box。 */
  shape?: BuildingShape;
  /** 组合体块，存在时用多体块渲染出复杂外形；缺省时渲染为单一方盒。 */
  massing?: BuildingMass[];
  /** 标记为可进入建筑：玩家靠近后可进入第一人称 3D 内景。 */
  enterable?: boolean;
}

export interface CampusRoad {
  id: string;
  name: string;
  kind?: "main" | "ring" | "branch" | "service";
  width?: number;
  points: IsoPoint[];
  color: number;
}

export interface CampusWater {
  id: string;
  points: IsoPoint[];
  color: number;
}

export interface CampusPlaza {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  color: number;
}

export interface CampusTask {
  id: string;
  title: string;
  place: string;
  x: number;
  y: number;
  prompt: string;
  story: string;
  completedText: string;
}

export const campusBuildings: CampusBuilding[] = [
  {
    id: "main-gate",
    name: "紫金港南大门",
    zone: "gate",
    x: 5.0,
    y: 31.2,
    w: 4.2,
    d: 0.7,
    h: 1.4,
    color: 0x6e625a,
    roof: 0x27322f,
  },
  {
    id: "dorm-lantian",
    name: "蓝田宿舍区",
    zone: "living",
    x: 2.4,
    y: 3.1,
    w: 5.8,
    d: 3.0,
    h: 5.2,
    color: 0x6e625a,
    roof: 0x2b3835,
    shape: "twin",
    massing: [
      { dx: 0, dy: 0, w: 5.8, d: 3.0, h: 1.4, bodyShade: -10 },
      { dx: 0.4, dy: 0.55, w: 1.9, d: 1.9, h: 4.6, bodyShade: 2 },
      { dx: 3.35, dy: 0.6, w: 1.9, d: 1.9, h: 5.2, bodyShade: 8, roofShade: 6 },
    ],
  },
  {
    id: "dorm-danyang",
    name: "丹阳宿舍区",
    zone: "living",
    x: 10.9,
    y: 3.6,
    w: 4.3,
    d: 2.6,
    h: 3.0,
    color: 0x72665e,
    roof: 0x2d3a37,
  },
  {
    id: "dorm-cuibai",
    name: "翠柏宿舍区",
    zone: "living",
    x: 15.6,
    y: 2.6,
    w: 4.0,
    d: 2.3,
    h: 3.0,
    color: 0x70655d,
    roof: 0x2c3a37,
  },
  {
    id: "dorm-baisha",
    enterable: true,
    name: "白沙宿舍区",
    zone: "living",
    x: 4.6,
    y: 5.5,
    w: 2.9,
    d: 1.5,
    h: 3.0,
    color: 0x736860,
    roof: 0x2f3d39,
  },
  {
    id: "linhu-canteen",
    name: "临湖餐厅",
    zone: "service",
    x: 10.8,
    y: 12.2,
    w: 2.5,
    d: 2.2,
    h: 2.5,
    color: 0x9d7144,
    roof: 0x523323,
  },
  {
    id: "little-theater",
    enterable: true,
    name: "小剧场",
    zone: "story",
    x: 11.1,
    y: 9.4,
    w: 2.0,
    d: 1.8,
    h: 3.6,
    color: 0x735d78,
    roof: 0x312b3a,
    shape: "hall",
    massing: [
      { dx: 0, dy: 0, w: 2.0, d: 1.8, h: 1.9, bodyShade: -4 },
      { dx: 0.55, dy: 0.5, w: 0.95, d: 0.8, h: 3.6, bodyShade: 6, roofShade: 10 },
    ],
  },
  {
    id: "west-teaching",
    name: "东教学区旧楼",
    zone: "academic",
    x: 27.6,
    y: 24.2,
    w: 2.3,
    d: 1.5,
    h: 3.1,
    color: 0x776553,
    roof: 0x3f3933,
  },
  {
    id: "ocean-building",
    name: "图书信息中心",
    zone: "academic",
    x: 27.4,
    y: 16.9,
    w: 2.2,
    d: 1.2,
    h: 3.6,
    shape: "slab",
    color: 0x66777c,
    roof: 0x2c383e,
  },
  {
    id: "qiushi-auditorium",
    name: "求是大讲堂",
    zone: "academic",
    x: 1.9,
    y: 20.1,
    w: 1.8,
    d: 1.4,
    h: 3.8,
    shape: "hall",
    color: 0x7d6b5b,
    roof: 0x3b3731,
  },
  {
    id: "marine-lab",
    name: "海洋试验厅",
    zone: "academic",
    x: 4.9,
    y: 21.5,
    w: 2.5,
    d: 1.5,
    h: 3.0,
    shape: "slab",
    color: 0x677980,
    roof: 0x2f3b42,
  },
  {
    id: "engineering-lab",
    name: "建工实验厅",
    zone: "academic",
    x: 1.9,
    y: 25.6,
    w: 1.7,
    d: 2.7,
    h: 3.6,
    shape: "slab",
    color: 0x746a5f,
    roof: 0x343632,
  },
  {
    id: "agri-life",
    name: "农生环组团",
    zone: "academic",
    x: 31.4,
    y: 27.6,
    w: 3.8,
    d: 2.0,
    h: 3.8,
    color: 0x6f7860,
    roof: 0x35402e,
    shape: "L",
    massing: [
      { dx: 0, dy: 0, w: 3.8, d: 0.9, h: 2.4, bodyShade: -6 },
      { dx: 0, dy: 0.9, w: 1.0, d: 1.1, h: 2.4, bodyShade: -6 },
      { dx: 2.9, dy: 0.5, w: 0.9, d: 1.1, h: 3.8, bodyShade: 8, roofShade: 6 },
    ],
  },
  {
    id: "medical-college",
    enterable: true,
    name: "医学院",
    zone: "academic",
    x: 11.0,
    y: 28.6,
    w: 3.5,
    d: 1.7,
    h: 4.4,
    color: 0x6f7d82,
    roof: 0x2e3941,
    shape: "L",
    massing: [
      { dx: 0, dy: 0, w: 3.5, d: 0.9, h: 2.6, bodyShade: -6 },
      { dx: 0, dy: 0.9, w: 1.1, d: 0.8, h: 2.6, bodyShade: -6 },
      { dx: 2.55, dy: 0.55, w: 0.95, d: 1.15, h: 4.4, bodyShade: 10, roofShade: 8 },
    ],
  },
  {
    id: "library",
    enterable: true,
    name: "基础图书馆",
    zone: "academic",
    x: 32.1,
    y: 12.0,
    w: 3.2,
    d: 3.0,
    h: 7.2,
    color: 0x8b4f3d,
    roof: 0x4e2928,
    labelOffset: -20,
    shape: "stepped",
    massing: [
      { dx: 0, dy: 0, w: 3.2, d: 3.0, h: 2.4, bodyShade: -6 },
      { dx: 0.5, dy: 0.45, w: 2.2, d: 2.1, h: 4.8, bodyShade: 4 },
      { dx: 0.95, dy: 0.85, w: 1.3, d: 1.3, h: 7.2, bodyShade: 14, roofShade: 10 },
    ],
  },
  {
    id: "east-teaching-1",
    name: "东1教学楼",
    zone: "academic",
    x: 30.0,
    y: 16.2,
    w: 2.2,
    d: 1.7,
    h: 2.9,
    color: 0x9a7355,
    roof: 0x4b3b31,
  },
  {
    id: "east-teaching-2",
    name: "东2教学楼",
    zone: "academic",
    x: 30.0,
    y: 18.6,
    w: 2.2,
    d: 1.7,
    h: 3.8,
    shape: "slab",
    massing: [
      { dx: 0, dy: 0, w: 2.2, d: 1.7, h: 2.4, bodyShade: -4 },
      { dx: 0.5, dy: 0.4, w: 1.2, d: 0.95, h: 3.8, bodyShade: 8, roofShade: 6 },
    ],
    color: 0x927051,
    roof: 0x49382f,
  },
  {
    id: "east-teaching-3",
    name: "东3教学楼",
    zone: "academic",
    x: 30.0,
    y: 21.0,
    w: 2.2,
    d: 1.7,
    h: 2.6,
    color: 0x8d684d,
    roof: 0x46362e,
  },
  {
    id: "east-teaching-4",
    name: "东4教学楼",
    zone: "academic",
    x: 30.0,
    y: 23.4,
    w: 2.2,
    d: 1.7,
    h: 4.2,
    shape: "tower",
    massing: [
      { dx: 0, dy: 0, w: 2.2, d: 1.7, h: 2.2, bodyShade: -6 },
      { dx: 0.55, dy: 0.45, w: 1.1, d: 0.85, h: 4.2, bodyShade: 10, roofShade: 8 },
    ],
    color: 0x9c7655,
    roof: 0x4d3b31,
  },
  {
    id: "east-teaching-5",
    name: "东5教学楼",
    zone: "academic",
    x: 33.0,
    y: 17.0,
    w: 2.5,
    d: 1.6,
    h: 3.0,
    color: 0x947056,
    roof: 0x46372f,
    shape: "slab",
    massing: [
      { dx: 0, dy: 0, w: 2.5, d: 1.6, h: 2.0, bodyShade: -6 },
      { dx: 0.38, dy: 0.35, w: 1.7, d: 0.9, h: 3.0, bodyShade: 7, roofShade: 5 },
    ],
  },
  {
    id: "east-teaching-6",
    name: "东6教学楼",
    zone: "academic",
    x: 33.0,
    y: 20.3,
    w: 2.4,
    d: 1.5,
    h: 3.5,
    color: 0x8f6d54,
    roof: 0x44352d,
    shape: "slab",
  },
  {
    id: "east-teaching-7",
    name: "东7教学楼",
    zone: "academic",
    x: 33.1,
    y: 23.7,
    w: 2.6,
    d: 1.6,
    h: 3.2,
    color: 0x9a7256,
    roof: 0x49382e,
    shape: "slab",
  },
  {
    id: "gym",
    name: "体育馆",
    zone: "sport",
    x: 33.2,
    y: 9.6,
    w: 3.5,
    d: 1.9,
    h: 3.4,
    color: 0x5d7076,
    roof: 0x24343b,
    shape: "hall",
    massing: [
      { dx: 0, dy: 0, w: 3.5, d: 1.9, h: 1.7, bodyShade: -4 },
      { dx: 0.35, dy: 0.28, w: 2.8, d: 1.35, h: 3.4, bodyShade: 6, roofShade: 8 },
      { dx: 2.85, dy: 0.1, w: 0.65, d: 1.7, h: 2.2, bodyShade: -12 },
    ],
  },
  {
    id: "medical-library",
    enterable: true,
    name: "图书馆医学分馆",
    zone: "story",
    x: 17.4,
    y: 28.5,
    w: 3.9,
    d: 1.8,
    h: 4.6,
    color: 0x59686e,
    roof: 0x242f35,
    shape: "tower",
    massing: [
      { dx: 0, dy: 0, w: 3.9, d: 1.8, h: 1.8, bodyShade: -8 },
      { dx: 1.1, dy: 0.28, w: 1.5, d: 1.25, h: 4.6, bodyShade: 8, roofShade: 8 },
    ],
  },
  {
    id: "life-science",
    name: "生命科学学院",
    zone: "academic",
    x: 24.2,
    y: 28.2,
    w: 4.0,
    d: 2.0,
    h: 3.8,
    color: 0x6d786a,
    roof: 0x333d30,
    shape: "slab",
    massing: [
      { dx: 0, dy: 0, w: 4.0, d: 2.0, h: 2.0, bodyShade: -6 },
      { dx: 0.35, dy: 0.32, w: 3.3, d: 1.35, h: 3.8, bodyShade: 6, roofShade: 6 },
    ],
  },
  {
    id: "environment-college",
    name: "环境与资源学院",
    zone: "academic",
    x: 37.3,
    y: 24.3,
    w: 2.4,
    d: 3.4,
    h: 4.6,
    color: 0x6a766f,
    roof: 0x303b36,
    shape: "tower",
    massing: [
      { dx: 0, dy: 0, w: 2.4, d: 3.4, h: 2.2, bodyShade: -6 },
      { dx: 0.4, dy: 0.6, w: 1.6, d: 2.2, h: 4.6, bodyShade: 8, roofShade: 6 },
    ],
  },
];

export const campusPlazas: CampusPlaza[] = [
  { id: "gate-plaza", name: "南大门广场", x: 5.6, y: 30.0, w: 3.8, d: 1.5, color: 0x4b5b57 },
  { id: "canteen-plaza", name: "临湖餐厅前场", x: 10.4, y: 14.5, w: 4.0, d: 1.8, color: 0x56645c },
  { id: "lake-west-plaza", name: "启真湖西岸", x: 14.0, y: 20.8, w: 3.7, d: 2.3, color: 0x4b625c },
  { id: "library-plaza", name: "基础图书馆入口广场", x: 31.6, y: 15.0, w: 4.0, d: 1.8, color: 0x5a5f58 },
  { id: "east-teaching-yard", name: "东教学区中庭", x: 25.0, y: 9.8, w: 6.6, d: 5.0, color: 0x555f5b },
  { id: "dorm-plaza", name: "白沙小广场", x: 6.0, y: 7.5, w: 2.9, d: 1.6, color: 0x4f625a },
  { id: "theater-plaza", name: "小剧场前场", x: 10.5, y: 11.5, w: 3.2, d: 1.6, color: 0x56545d },
  { id: "medical-plaza", name: "医学院入口空地", x: 10.4, y: 30.0, w: 4.8, d: 1.5, color: 0x465655 },
];

export const campusRoads: CampusRoad[] = [
  {
    id: "south-main-axis",
    name: "东区南北主轴",
    kind: "main",
    width: 1.18,
    points: [
      // Based on the east-campus PDF: enter from the south/east edge,
      // pass medical/agri-life, library and the east teaching cluster.
      { x: 10.2, y: 30.0 },
      { x: 14.8, y: 30.3 },
      { x: 21.0, y: 30.5 },
      { x: 27.5, y: 30.4 },
      { x: 35.5, y: 30.0 },
      { x: 36.4, y: 26.2 },
      { x: 36.5, y: 22.2 },
      { x: 36.5, y: 18.2 },
      { x: 36.2, y: 15.7 },
      { x: 37.0, y: 11.8 },
      { x: 37.5, y: 8.8 },
      { x: 33.0, y: 8.7 },
      { x: 28.0, y: 8.5 },
      { x: 23.4, y: 8.2 },
      { x: 14.2, y: 8.2 },
      { x: 10.2, y: 8.2 },
    ],
    color: 0x5b6661,
  },
  {
    id: "lake-loop",
    name: "启真湖环路",
    kind: "ring",
    width: 0.98,
    points: [
      { x: 14.5, y: 14.8 },
      { x: 15.0, y: 10.2 },
      { x: 14.2, y: 8.2 },
      { x: 23.4, y: 8.2 },
      { x: 24.0, y: 8.4 },
      { x: 24.5, y: 10.8 },
      { x: 24.5, y: 14.8 },
      { x: 26.5, y: 15.9 },
      { x: 26.5, y: 20.5 },
      { x: 23.4, y: 22.8 },
      { x: 19.0, y: 22.6 },
      { x: 16.1, y: 21.9 },
      { x: 14.9, y: 17.2 },
      { x: 13.5, y: 14.6 },
      { x: 14.5, y: 14.8 },
    ],
    color: 0x465956,
  },
  {
    id: "dorm-branch",
    name: "白沙生活区支路",
    kind: "branch",
    width: 0.78,
    points: [
      { x: 10.2, y: 8.2 },
      { x: 7.3, y: 8.1 },
      { x: 4.2, y: 8.0 },
      { x: 4.2, y: 11.0 },
      { x: 9.6, y: 11.6 },
      { x: 10.4, y: 14.5 },
    ],
    color: 0x505f58,
  },
  {
    id: "baisha-ocean-link",
    name: "白沙西侧慢行道",
    kind: "service",
    width: 0.62,
    points: [
      { x: 4.2, y: 11.0 },
      { x: 4.5, y: 18.5 },
    ],
    color: 0x4b5b55,
  },
  {
    id: "west-medical-road",
    name: "南侧医学支路",
    kind: "branch",
    width: 0.86,
    points: [
      { x: 10.2, y: 30.0 },
      { x: 7.5, y: 29.8 },
      { x: 4.5, y: 30.5 },
      { x: 4.0, y: 27.0 },
      { x: 4.0, y: 23.0 },
      { x: 4.5, y: 18.5 },
      { x: 7.5, y: 18.5 },
      { x: 10.2, y: 18.5 },
    ],
    color: 0x485653,
  },
  {
    id: "library-east-link",
    name: "图书馆入口连廊",
    kind: "branch",
    width: 0.84,
    points: [
      { x: 26.5, y: 15.9 },
      { x: 30.2, y: 15.9 },
      { x: 32.2, y: 16.0 },
      { x: 36.2, y: 15.7 },
    ],
    color: 0x525d59,
  },
  {
    id: "lake-admin-bridge",
    name: "湖东教学连路",
    kind: "branch",
    width: 0.82,
    points: [
      { x: 23.4, y: 22.8 },
      { x: 25.8, y: 21.8 },
      { x: 28.2, y: 20.8 },
      { x: 30.4, y: 20.0 },
      { x: 32.2, y: 19.2 },
      { x: 36.5, y: 18.2 },
    ],
    color: 0x505f58,
  },
  {
    id: "teaching-west-approach",
    name: "教学区西侧入口",
    kind: "service",
    width: 0.6,
    points: [
      { x: 10.2, y: 18.5 },
      { x: 10.4, y: 16.5 },
      { x: 10.4, y: 14.5 },
    ],
    color: 0x505b58,
  },
  {
    id: "canteen-lake-link",
    name: "临湖餐厅湖岸路",
    kind: "service",
    width: 0.62,
    points: [
      { x: 10.4, y: 14.5 },
      { x: 13.5, y: 14.6 },
      { x: 14.5, y: 14.8 },
    ],
    color: 0x505f58,
  },
  {
    id: "theater-spur",
    name: "小剧场通路",
    kind: "service",
    width: 0.62,
    points: [
      { x: 10.2, y: 8.2 },
      { x: 12.0, y: 11.8 },
    ],
    color: 0x4d5a52,
  },
];

export const campusWaters: CampusWater[] = [
  {
    id: "qizhen-lake",
    color: 0x173c47,
    points: [
      { x: 19.8, y: 5.8 },
      { x: 22.2, y: 4.6 },
      { x: 24.8, y: 7.0 },
      { x: 23.6, y: 11.2 },
      { x: 24.2, y: 14.2 },
      { x: 24.8, y: 18.6 },
      { x: 23.9, y: 22.4 },
      { x: 23.8, y: 26.6 },
      { x: 20.8, y: 28.0 },
      { x: 18.4, y: 26.4 },
      { x: 17.0, y: 23.2 },
      { x: 14.8, y: 22.2 },
      { x: 14.0, y: 18.0 },
      { x: 15.2, y: 14.0 },
      { x: 16.6, y: 10.8 },
      { x: 17.2, y: 7.8 },
    ],
  },
  {
    id: "west-canal",
    color: 0x1a4650,
    points: [
      { x: 1.3, y: 4.0 },
      { x: 2.0, y: 4.0 },
      { x: 2.2, y: 31.0 },
      { x: 1.5, y: 31.4 },
    ],
  },
  {
    id: "east-canal",
    color: 0x1a4650,
    points: [
      { x: 40.4, y: 6.0 },
      { x: 41.0, y: 6.4 },
      { x: 41.2, y: 31.0 },
      { x: 40.3, y: 30.8 },
    ],
  },
];

export const storyTasks: CampusTask[] = [
  {
    id: "library-basement",
    title: "核对闭馆记录",
    place: "基础图书馆",
    x: 32.0,
    y: 15.9,
    prompt: "E 核对基础图书馆闭馆记录",
    story: "借阅机还亮着，最后一条记录停在 23:47。备注栏只有一句：湖边不要回头。",
    completedText: "闭馆记录已取得",
  },
  {
    id: "lake-signal",
    title: "追踪湖面信号",
    place: "启真湖",
    x: 19.0,
    y: 22.5,
    prompt: "E 调整湖边接收器",
    story: "接收器扫过水面时出现了宿舍区的坐标，耳机里传来很轻的敲门声。",
    completedText: "湖面信号已锁定",
  },
  {
    id: "lecture-power",
    title: "恢复讲堂电源",
    place: "小剧场",
    x: 12.0,
    y: 11.8,
    prompt: "E 重启配电箱",
    story: "电源恢复的一瞬间，舞台幕布后站着一排没有影子的人形。",
    completedText: "讲堂电源已恢复",
  },
  {
    id: "dorm-door",
    title: "检查白沙门禁",
    place: "白沙宿舍区",
    x: 7.2,
    y: 8.1,
    prompt: "E 读取白沙门禁日志",
    story: "门禁日志显示同一个学生在五分钟内刷过七栋楼，但他的卡早在三年前注销。",
    completedText: "门禁日志已读取",
  },
];



