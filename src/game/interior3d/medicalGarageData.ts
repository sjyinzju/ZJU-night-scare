export type MedicalGarageStage =
  | "opening"
  | "dark"
  | "warning"
  | "visible"
  | "fading"
  | "recovery"
  | "document"
  | "seal"
  | "stairs"
  | "transition";

export type MedicalGarageTarget = "node" | "candle" | "stairs";

export interface MedicalGarageSnapshot {
  stage: MedicalGarageStage;
  violations: number;
  activatedNodes: number;
  totalNodes: number;
  currentNode: number | null;
  hasCandle: boolean;
  target: MedicalGarageTarget;
  ghostVisible: boolean;
  loadingText?: string;
}

export type MedicalGarageModal = { kind: "opening" } | { kind: "document" };

export const MEDICAL_GARAGE_OPENING = [
  "电梯停在地下车库。门刚打开，暴雨声便从四周的通风井同时灌了进来。",
  "车库四周本应埋在地底，此刻却不断透进惨白的雷光。每一次闪电落下，远处都会多出一排原本不存在的脚印。",
  "今晚的闪电会短暂唤醒手电筒。光消失以后，不要留在原地；白布里的亡魂只在雷光中现身。",
  "林伟留下的图上，七根立柱被一条倒转的北斗线依次穿过。每抵达一处阵眼，脚下的红痕便会自行接向下一根柱子。",
  "黑暗时沿红痕前进。雷光亮起时，它会在你正前方现身，并朝你越来越快地飘来。看着它，后退，设法在它触碰你以前进入阵眼。",
  "只要红圈闭合，它就会暂时散去。但下一声雷会让它从更近的地方回来。",
  "不要把后背交给它。也不要让它碰到你。",
] as const;

export const MEDICAL_GARAGE_DOCUMENT = [
  "柱后的水渍下面压着一页巡查记录。",
  "日期是2008年3月8日，时间停在23:47。纸张已经发黄，最后几行字却像刚刚写完。",
  "我以为唱歌的女人在追我。",
  "我以为那阵唱声属于苏婉，也以为白布下面只是她没有被带走的尸体。直到第一次闪电照亮车库，我才看见它没有脚，白布里面却挤着不止一个人的轮廓。",
  "苏婉一直站在通往地下的楼梯口。她没有追我。每次白布里的东西靠近，她都会挡在它前面，像是在阻止它回到仓库。",
  "我试着喊她的名字。她没有回头，只在墙上留下四个被雨水冲淡的字：不要归还。",
  "R-1953不能送回地下。白布里的不是苏婉。它是那些被写进同一编号、却从来没有姓名的人。",
  "七根柱子连起来以后，把蜡烛留在最后一根柱子前。红线闭合以前，不要踏进楼梯间；那里太窄，它会比雷光更早碰到你。",
  "不要吹灭它。火灭的时候，白布下面会睁开更多眼睛。",
  "记录背面还有一行重复了七遍的铅笔字：我已经把它留在上面。最后一遍的‘上面’，被另一种字迹改成了‘你后面’。",
  "签名被水泡开，只剩下一个仍在渗墨的‘林’字。旁边却多出一道湿漉漉的指印，像是刚有人替他按过确认。",
  "你抬起头。黑暗里没有任何东西。",
  "下一声雷，却是从你脚下传来的。",
] as const;

export const MEDICAL_GARAGE_STEPS = [
  "进入雨夜车库",
  "点亮七柱封印",
  "取得封印蜡烛",
  "阅读林伟记录",
  "完成倒斗阵",
  "前往地下仓库",
] as const;
