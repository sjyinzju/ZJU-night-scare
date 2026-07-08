export type CampusZone = "academic" | "water" | "living" | "service" | "sport" | "gate" | "story";

export interface IsoPoint {
  x: number;
  y: number;
}

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
}

export interface CampusRoad {
  id: string;
  name: string;
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
    x: 5.1,
    y: 31.35,
    w: 5.2,
    d: 0.9,
    h: 1.4,
    color: 0x69756d,
    roof: 0x27322f,
  },
  {
    id: "library",
    name: "基础图书馆",
    zone: "academic",
    x: 22.3,
    y: 15.8,
    w: 6.4,
    d: 4.6,
    h: 4.6,
    color: 0x8b4f3d,
    roof: 0x4e2928,
    labelOffset: -20,
  },
  {
    id: "east-teaching-1",
    name: "东1教学楼",
    zone: "academic",
    x: 30.2,
    y: 10.4,
    w: 3.8,
    d: 2.8,
    h: 3.1,
    color: 0x9a7355,
    roof: 0x4b3b31,
  },
  {
    id: "east-teaching-2",
    name: "东2教学楼",
    zone: "academic",
    x: 35.0,
    y: 10.5,
    w: 3.8,
    d: 2.8,
    h: 3.1,
    color: 0x927051,
    roof: 0x49382f,
  },
  {
    id: "east-teaching-3",
    name: "东3教学楼",
    zone: "academic",
    x: 29.7,
    y: 15.0,
    w: 4.0,
    d: 2.9,
    h: 3.4,
    color: 0x8d684d,
    roof: 0x46362e,
  },
  {
    id: "east-teaching-4",
    name: "东4教学楼",
    zone: "academic",
    x: 34.9,
    y: 15.1,
    w: 4.0,
    d: 2.9,
    h: 3.4,
    color: 0x9c7655,
    roof: 0x4d3b31,
  },
  {
    id: "west-teaching",
    name: "西区教学楼",
    zone: "academic",
    x: 6.4,
    y: 12.2,
    w: 6.2,
    d: 3.6,
    h: 3.0,
    color: 0x776553,
    roof: 0x3f3933,
  },
  {
    id: "qiushi-hall",
    name: "求是大讲堂",
    zone: "story",
    x: 19.8,
    y: 24.7,
    w: 5.2,
    d: 3.0,
    h: 3.7,
    color: 0x735d78,
    roof: 0x312b3a,
  },
  {
    id: "canteen",
    name: "食堂与商店",
    zone: "service",
    x: 10.8,
    y: 27.2,
    w: 5.4,
    d: 2.7,
    h: 2.5,
    color: 0x9d7144,
    roof: 0x523323,
  },
  {
    id: "dorm-qingxi",
    name: "青溪宿舍区",
    zone: "living",
    x: 32.0,
    y: 22.4,
    w: 4.0,
    d: 3.2,
    h: 3.0,
    color: 0x6a7a73,
    roof: 0x2b3835,
  },
  {
    id: "dorm-baisha",
    name: "白沙宿舍区",
    zone: "living",
    x: 32.0,
    y: 28.0,
    w: 4.2,
    d: 3.2,
    h: 3.0,
    color: 0x6f8178,
    roof: 0x2c3a37,
  },
  {
    id: "dorm-court",
    name: "宿舍连廊",
    zone: "living",
    x: 36.4,
    y: 24.9,
    w: 2.4,
    d: 4.0,
    h: 2.4,
    color: 0x61756f,
    roof: 0x293a36,
  },
  {
    id: "gym",
    name: "体育馆",
    zone: "sport",
    x: 33.1,
    y: 5.9,
    w: 5.8,
    d: 3.8,
    h: 2.8,
    color: 0x5d7076,
    roof: 0x24343b,
  },
  {
    id: "clinic",
    name: "校医院",
    zone: "service",
    x: 2.1,
    y: 20.0,
    w: 3.0,
    d: 2.4,
    h: 2.4,
    color: 0x6f7d82,
    roof: 0x2e3941,
  },
  {
    id: "medical-library",
    name: "医学院图书馆",
    zone: "story",
    x: 2.4,
    y: 25.8,
    w: 3.2,
    d: 3.0,
    h: 3.2,
    color: 0x59686e,
    roof: 0x242f35,
  },
];

export const campusPlazas: CampusPlaza[] = [
  { id: "gate-plaza", name: "南大门广场", x: 6.2, y: 28.4, w: 3.2, d: 2.8, color: 0x4b5b57 },
  { id: "canteen-plaza", name: "食堂前场", x: 12.0, y: 24.0, w: 4.2, d: 2.0, color: 0x56645c },
  { id: "lake-south-plaza", name: "湖畔广场", x: 16.3, y: 24.1, w: 3.8, d: 2.3, color: 0x4b625c },
  { id: "library-plaza", name: "图书馆入口广场", x: 22.5, y: 20.4, w: 4.5, d: 2.1, color: 0x5a5f58 },
  { id: "east-teaching-yard", name: "东教学区中庭", x: 31.2, y: 13.1, w: 5.7, d: 2.8, color: 0x555f5b },
  { id: "dorm-plaza", name: "白沙小广场", x: 32.4, y: 26.0, w: 4.0, d: 1.8, color: 0x4f625a },
  { id: "qiushi-plaza", name: "求是大讲堂前场", x: 20.9, y: 23.0, w: 3.6, d: 1.8, color: 0x56545d },
  { id: "medical-plaza", name: "医学院入口空地", x: 4.7, y: 23.0, w: 3.0, d: 2.4, color: 0x465655 },
];

export const campusRoads: CampusRoad[] = [
  {
    id: "south-main-axis",
    name: "南门主轴路",
    points: [
      { x: 7.8, y: 30.1 },
      { x: 8.8, y: 28.2 },
      { x: 11.6, y: 26.0 },
      { x: 14.2, y: 24.9 },
      { x: 17.5, y: 24.8 },
      { x: 20.1, y: 23.9 },
      { x: 22.8, y: 21.4 },
      { x: 24.2, y: 20.4 },
    ],
    color: 0x5b6661,
  },
  {
    id: "lake-loop",
    name: "启真湖环路",
    points: [
      { x: 11.9, y: 21.7 },
      { x: 13.4, y: 18.9 },
      { x: 17.3, y: 16.4 },
      { x: 21.2, y: 17.0 },
      { x: 23.7, y: 19.7 },
      { x: 22.1, y: 22.8 },
      { x: 18.2, y: 24.5 },
      { x: 14.2, y: 23.9 },
      { x: 11.9, y: 21.7 },
    ],
    color: 0x465956,
  },
  {
    id: "east-teaching-spine",
    name: "东教学区主路",
    points: [
      { x: 24.5, y: 20.1 },
      { x: 27.0, y: 17.2 },
      { x: 31.6, y: 14.5 },
      { x: 36.5, y: 14.5 },
      { x: 38.0, y: 12.2 },
    ],
    color: 0x56605c,
  },
  {
    id: "east-north-belt",
    name: "东区北侧横路",
    points: [
      { x: 29.7, y: 11.8 },
      { x: 32.4, y: 11.8 },
      { x: 35.7, y: 11.9 },
      { x: 39.0, y: 10.7 },
    ],
    color: 0x505b58,
  },
  {
    id: "dorm-branch",
    name: "生活区支路",
    points: [
      { x: 18.1, y: 24.9 },
      { x: 21.5, y: 23.7 },
      { x: 24.8, y: 23.2 },
      { x: 27.9, y: 25.5 },
      { x: 32.2, y: 26.9 },
      { x: 36.5, y: 26.9 },
    ],
    color: 0x505f58,
  },
  {
    id: "west-medical-road",
    name: "西南医学院路",
    points: [
      { x: 7.8, y: 30.1 },
      { x: 6.4, y: 27.8 },
      { x: 6.2, y: 24.3 },
      { x: 5.7, y: 22.8 },
      { x: 7.5, y: 18.4 },
      { x: 10.0, y: 13.5 },
    ],
    color: 0x485653,
  },
  {
    id: "library-east-link",
    name: "图书馆东连廊",
    points: [
      { x: 24.0, y: 20.5 },
      { x: 26.0, y: 20.0 },
      { x: 27.6, y: 18.0 },
    ],
    color: 0x525d59,
  },
];

export const campusWaters: CampusWater[] = [
  {
    id: "qizhen-lake",
    color: 0x173c47,
    points: [
      { x: 12.4, y: 18.8 },
      { x: 15.8, y: 15.7 },
      { x: 20.5, y: 15.7 },
      { x: 23.4, y: 18.4 },
      { x: 22.4, y: 22.0 },
      { x: 18.9, y: 24.0 },
      { x: 14.8, y: 23.5 },
      { x: 11.7, y: 21.2 },
    ],
  },
];

export const storyTasks: CampusTask[] = [
  {
    id: "library-basement",
    title: "核对闭馆记录",
    place: "基础图书馆",
    x: 24.2,
    y: 20.9,
    prompt: "E 核对图书馆闭馆记录",
    story: "借阅机还亮着，最后一条记录停在 23:47。备注栏只有一句：湖边不要回头。",
    completedText: "闭馆记录已取得",
  },
  {
    id: "lake-signal",
    title: "追踪湖面信号",
    place: "启真湖",
    x: 18.2,
    y: 24.4,
    prompt: "E 调整湖边接收器",
    story: "接收器扫过水面时出现了宿舍区的坐标，耳机里传来很轻的敲门声。",
    completedText: "湖面信号已锁定",
  },
  {
    id: "lecture-power",
    title: "恢复讲堂电源",
    place: "求是大讲堂",
    x: 22.2,
    y: 23.7,
    prompt: "E 重启配电箱",
    story: "电源恢复的一瞬间，舞台幕布后站着一排没有影子的人形。",
    completedText: "讲堂电源已恢复",
  },
  {
    id: "dorm-door",
    title: "检查白沙门禁",
    place: "白沙宿舍区",
    x: 34.3,
    y: 27.1,
    prompt: "E 读取白沙门禁日志",
    story: "门禁日志显示同一个学生在五分钟内刷过七栋楼，但他的卡早在三年前注销。",
    completedText: "门禁日志已读取",
  },
];



