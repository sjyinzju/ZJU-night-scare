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
    h: 3.0,
    color: 0x6e625a,
    roof: 0x2b3835,
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
    name: "小剧场",
    zone: "story",
    x: 11.1,
    y: 9.4,
    w: 2.0,
    d: 1.8,
    h: 2.8,
    color: 0x735d78,
    roof: 0x312b3a,
  },
  {
    id: "west-teaching",
    name: "西教学区",
    zone: "academic",
    x: 11.3,
    y: 18.8,
    w: 2.8,
    d: 3.4,
    h: 3.1,
    color: 0x776553,
    roof: 0x3f3933,
  },
  {
    id: "ocean-building",
    name: "海洋大楼",
    zone: "academic",
    x: 2.6,
    y: 16.6,
    w: 1.6,
    d: 2.6,
    h: 3.0,
    color: 0x66777c,
    roof: 0x2c383e,
  },
  {
    id: "agri-life",
    name: "农生环组团",
    zone: "academic",
    x: 31.4,
    y: 27.6,
    w: 3.8,
    d: 2.0,
    h: 3.0,
    color: 0x6f7860,
    roof: 0x35402e,
  },
  {
    id: "medical-college",
    name: "医学院",
    zone: "academic",
    x: 11.0,
    y: 28.6,
    w: 3.5,
    d: 1.7,
    h: 3.0,
    color: 0x6f7d82,
    roof: 0x2e3941,
  },
  {
    id: "library",
    name: "基础图书馆",
    zone: "academic",
    x: 32.1,
    y: 12.0,
    w: 3.2,
    d: 3.0,
    h: 4.6,
    color: 0x8b4f3d,
    roof: 0x4e2928,
    labelOffset: -20,
  },
  {
    id: "east-teaching-1",
    name: "东1教学楼",
    zone: "academic",
    x: 30.0,
    y: 16.2,
    w: 2.2,
    d: 1.7,
    h: 3.1,
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
    h: 3.1,
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
    h: 3.4,
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
    h: 3.4,
    color: 0x9c7655,
    roof: 0x4d3b31,
  },
  {
    id: "gym",
    name: "体育馆",
    zone: "sport",
    x: 34.3,
    y: 4.2,
    w: 3.5,
    d: 1.9,
    h: 2.8,
    color: 0x5d7076,
    roof: 0x24343b,
  },
  {
    id: "medical-library",
    name: "图书馆医学分馆",
    zone: "story",
    x: 17.4,
    y: 28.5,
    w: 3.9,
    d: 1.8,
    h: 3.2,
    color: 0x59686e,
    roof: 0x242f35,
  },
  {
    id: "life-science",
    name: "生命科学学院",
    zone: "academic",
    x: 24.2,
    y: 28.2,
    w: 4.0,
    d: 2.0,
    h: 3.0,
    color: 0x6d786a,
    roof: 0x333d30,
  },
  {
    id: "environment-college",
    name: "环境与资源学院",
    zone: "academic",
    x: 37.3,
    y: 24.3,
    w: 2.4,
    d: 3.4,
    h: 3.0,
    color: 0x6a766f,
    roof: 0x303b36,
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
    name: "红线主路",
    points: [
      { x: 6.8, y: 30.6 },
      { x: 11.0, y: 30.6 },
      { x: 17.6, y: 30.6 },
      { x: 24.0, y: 30.6 },
      { x: 31.8, y: 30.4 },
      { x: 36.2, y: 30.0 },
      { x: 36.5, y: 24.5 },
      { x: 36.5, y: 18.8 },
      { x: 36.4, y: 15.8 },
      { x: 37.0, y: 11.8 },
      { x: 37.6, y: 8.8 },
      { x: 33.0, y: 8.8 },
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
    points: [
      { x: 14.5, y: 14.8 },
      { x: 15.0, y: 10.2 },
      { x: 14.2, y: 8.2 },
      { x: 23.4, y: 8.2 },
      { x: 24.0, y: 8.4 },
      { x: 24.5, y: 10.8 },
      { x: 24.5, y: 14.8 },
      { x: 26.5, y: 20.5 },
      { x: 23.4, y: 22.8 },
      { x: 19.0, y: 22.6 },
      { x: 16.1, y: 21.9 },
      { x: 14.9, y: 17.2 },
      { x: 14.5, y: 14.8 },
    ],
    color: 0x465956,
  },
  {
    id: "dorm-branch",
    name: "宿舍区支路",
    points: [
      { x: 10.2, y: 8.2 },
      { x: 7.3, y: 8.1 },
      { x: 4.2, y: 8.0 },
      { x: 4.2, y: 11.0 },
      { x: 9.6, y: 11.6 },
    ],
    color: 0x505f58,
  },
  {
    id: "baisha-ocean-link",
    name: "白沙海洋连路",
    points: [
      { x: 4.2, y: 11.0 },
      { x: 4.5, y: 18.5 },
    ],
    color: 0x4b5b55,
  },
  {
    id: "west-medical-road",
    name: "西南医学院路",
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
    name: "图书馆东连廊",
    points: [
      { x: 27.4, y: 15.9 },
      { x: 28.7, y: 15.9 },
      { x: 32.0, y: 16.0 },
      { x: 36.4, y: 15.8 },
    ],
    color: 0x525d59,
  },
  {
    id: "lake-admin-bridge",
    name: "湖东行政连路",
    points: [
      { x: 23.4, y: 22.8 },
      { x: 25.8, y: 21.8 },
      { x: 28.2, y: 20.8 },
      { x: 30.4, y: 20.0 },
      { x: 33.6, y: 20.6 },
      { x: 36.5, y: 21.5 },
    ],
    color: 0x505f58,
  },
  {
    id: "west-teaching-grid",
    name: "西教学区入口短路",
    points: [
      { x: 10.2, y: 18.5 },
      { x: 10.8, y: 19.5 },
      { x: 10.8, y: 20.8 },
    ],
    color: 0x505b58,
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



