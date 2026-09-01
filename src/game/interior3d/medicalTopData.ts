import { createSeededRandom, hashSeed } from "./seededRandom";
import type { MedicalTopRoomId } from "./InteriorAssetLoader";

export type MedicalTopRoute = "normal" | "third-knock" | "false-602";
export type MedicalTopCctvPack = "A" | "B";
export type MedicalTopStage = "notice" | "rules" | "bed-blackout" | "bed" | "rooms" | "escape-warning" | "escape" | "transition";
export type MedicalTopRoomState = "sealed" | "loading" | "open" | "complete";

export interface MedicalTopSnapshot {
  stage: MedicalTopStage;
  route: MedicalTopRoute;
  violations: number;
  sedativeShield: boolean;
  hasFuse: boolean;
  currentTarget?: MedicalTopRoomId | "602" | "elevator" | "notice";
  rooms: Record<MedicalTopRoomId, MedicalTopRoomState>;
  roomLabels: Record<MedicalTopRoomId, string>;
  abnormalTag: boolean;
  fuseAvailable: boolean;
  cctvPack: MedicalTopCctvPack;
  loadingText?: string;
}

export type MedicalTopModal =
  | { kind: "rules" }
  | { kind: "record"; revisit: boolean }
  | { kind: "skull"; abnormal: boolean }
  | { kind: "cctv"; pack: MedicalTopCctvPack };

export interface MedicalTopRolls {
  route: MedicalTopRoute;
  abnormalTag: boolean;
  fuseAvailable: boolean;
  cctvPack: MedicalTopCctvPack;
}

export type MedicalRuleTone = "normal" | "red" | "struck" | "faded" | "corrupt";

export interface MedicalRuleLine {
  text: string;
  tone?: MedicalRuleTone;
}

/**
 * Each clause is kept as an authored line instead of a single flowing string.
 * This lets the notice reproduce overwritten, crossed-out and hostile edits
 * without putting the document inside a made-up card UI.
 */
export const MEDICAL_TOP_RULES: ReadonlyArray<{ lines: ReadonlyArray<MedicalRuleLine> }> = [
  { lines: [{ text: "六层夜间巡查时间为23:30至次日5:30，请保持安静。" }] },
  { lines: [
    { text: "六层仅设601、603、605。六层从未设置602室。" },
    { text: "六层设有602室。", tone: "struck" },
    { text: "被划掉的房间不会因此消失。", tone: "red" },
  ] },
  { lines: [
    { text: "如果离开601后看见602，请勿触碰房门。" },
    { text: "先检查605，再返回603，最后复核601。" },
    { text: "不要让门牌知道你看得见它。", tone: "red" },
  ] },
  { lines: [
    { text: "公告栏没有接通电源。" },
    { text: "如果它正在发光，请在阅读完毕前不要离开。" },
    { text: "它不是为了让你看清才亮起来的。", tone: "faded" },
  ] },
  { lines: [
    { text: "除疏散状态外，走廊内禁止奔跑。" },
    { text: "若身后有人奔跑，请继续步行。它会先超过你。", tone: "red" },
  ] },
  { lines: [
    { text: "601门内响起两声敲门后，方可进入。" },
    { text: "敲门声来自门内。门内没有人。", tone: "faded" },
  ] },
  { lines: [
    { text: "如果听见第三声，请先巡查603和605。" },
    { text: "再次返回时，它只会敲两声。" },
    { text: "第三声不是敲门，是确认。", tone: "red" },
  ] },
  { lines: [
    { text: "601巡查记录每晚只允许出现一名巡查员。" },
    { text: "返回人数大于1时，请不要寻找多出来的人。" },
  ] },
  { lines: [
    { text: "如果记录上的姓名为林伟，请勿划掉。" },
    { text: "他仍在完成本次巡查。", tone: "red" },
    { text: "他已经完成本次巡查。", tone: "struck" },
  ] },
  { lines: [
    { text: "不要回答房间内对你姓名的确认。" },
    { text: "值班人员不会询问姓名。林伟会。", tone: "red" },
  ] },
  { lines: [
    { text: "病床经过六层时，请紧贴任意一侧墙壁。" },
    { text: "必须为亡魂让出中央通道。" },
  ] },
  { lines: [
    { text: "红灯熄灭时，病床不应存在。" },
    { text: "如果你仍然看得见它，请确认闭眼的是不是你。", tone: "corrupt" },
  ] },
  { lines: [
    { text: "603内的颅骨均为教学标本，请先检查标签。" },
    { text: "请先看编号，再看它有没有转向你。", tone: "faded" },
  ] },
  { lines: [
    { text: "教学标本编号均以“M”开头。" },
    { text: "红色批注：R-1953不是教学标本。", tone: "red" },
  ] },
  { lines: [
    { text: "请勿清点颅骨的牙齿。" },
    { text: "多出的那一颗会清点你。", tone: "red" },
  ] },
  { lines: [
    { text: "蓝色镇静剂可用于一次紧急处置。" },
    { text: "药瓶空着也是正常现象。", tone: "struck" },
    { text: "你喝下去以后，它就不是空的了。", tone: "red" },
  ] },
  { lines: [
    { text: "备用保险丝不会阻止停电。" },
    { text: "它只会让停电来得晚一些。晚到足够你逃走。", tone: "faded" },
  ] },
  { lines: [
    { text: "605监控画面存在七秒延迟。" },
    { text: "七秒不是设备故障。那七秒还没有发生。", tone: "red" },
  ] },
  { lines: [
    { text: "当监控画面中出现两个人时，请勿回头。" },
    { text: "关闭画面，背向房门离开。" },
  ] },
  { lines: [
    { text: "如果监控里的你先转过身，请停止移动。" },
    { text: "直到它替你转回来。", tone: "red" },
  ] },
  { lines: [
    { text: "请勿跟随赤脚脚印。" },
    { text: "请勿跟随穿鞋脚印。" },
    { text: "走廊内没有脚印。", tone: "red" },
  ] },
  { lines: [
    { text: "不要回答广播中的点名。医学院不会在夜间点名。" },
    { text: "若广播没有念到你的名字，请立即回答。", tone: "red" },
  ] },
  { lines: [
    { text: "发现红色文字属于打印故障，请忽略。" },
    { text: "红色文字不属于打印故障。", tone: "red" },
  ] },
  { lines: [
    { text: "走廊灯光开始逐盏熄灭后，请在最后一盏熄灭前进入电梯。" },
    { text: "电梯外的人不会被算作巡查员。", tone: "red" },
  ] },
  { lines: [
    { text: "使用备用保险丝后，仍须遵守第二十四条。" },
    { text: "保险丝延长的是灯光，不是你的时间。", tone: "faded" },
  ] },
  { lines: [
    { text: "电梯到达前请保持呼吸。" },
    { text: "请保　呼吸。请停止呼吸。", tone: "corrupt" },
    { text: "呼吸呼吸呼吸呼吸呼吸呼吸呼吸", tone: "red" },
  ] },
  { lines: [
    { text: "本守则共二十七条。" },
    { text: "第二十八条已由上一位巡查员带走。", tone: "struck" },
  ] },
  { lines: [
    { text: "请勿阅读不存在的第二十八条。", tone: "red" },
    { text: "请勿阅读不存在的第二十八条。", tone: "corrupt" },
    { text: "你已经读完了。现在它知道由谁接班。", tone: "red" },
  ] },
];

export const MEDICAL_601_RECORD = [
  "六层夜间巡查记录",
  "",
  "3月5日 23:47　601：正常　603：封存　605：信号中断　返回人数：1",
  "3月6日 23:47　601：正常　603：无人　605：信号中断　返回人数：2",
  "3月7日 23:47　601：未进入　603：已归还　605：正在观看　返回人数：1",
  "3月8日 23:47　601：已到　603：已到　605：已到　返回人数：0",
  "",
  "补记：病床已让行。",
  "补记：602门牌已纠正。",
  "补记：六层窗口从未开启。",
  "",
  "本次巡查员：",
  "林伟",
] as const;

export const MEDICAL_601_OBSERVATIONS = [
  "四份记录都停在23:47，像是同一分钟被重复抄写了四遍。",
  "“返回人数”从1变成2，又变成0；纸页边缘却只有一组指纹。",
  "最后的签名不是墨水。红色正从“林伟”两个字里慢慢渗出来。",
] as const;

export const MEDICAL_603_LABELS = {
  normal: "M-603-17 / 教学颅骨 / 入库：2018-09-03",
  abnormal: "R-1953 / 姓名：林伟 / 入库：今晚23:47 / 状态：已返回",
} as const;

export const MEDICAL_603_OBSERVATIONS = {
  normal: [
    "标签的塑封已经泛黄，编号与守则中的教学标本格式一致。",
    "颅骨后脑有一道旧划痕，像是曾经被固定在别的展示架上。",
  ],
  abnormal: [
    "标签背面的胶还没有干，‘今晚23:47’像是刚刚才打印出来。",
    "R-1953不是教学编号。姓名栏却写着林伟——和601记录上的签名完全相同。",
    "你移开视线时，颅骨与603房门之间的角度似乎变了一点。",
  ],
} as const;

export const MEDICAL_605_TRUTH = "录像时间与601记录一致。林伟怀里抱着编号R-1953的档案。他不是从地下逃到六层，而是在完成一条预先写好的巡查路线。录像缺失的七秒里，他进入了电梯；跟在他身后的东西比他更早出现在六层。";

export const MEDICAL_605_ANOMALY = {
  A: "白衣影子始终落后林伟半步，但它的倒影比林伟先经过每一扇门。最后一帧里，身体仍朝前，头却已经转向监控。",
  B: "两个林伟拥有同一个时间码。一个走向605，另一个从电梯里倒退出来；电梯反光中还停着刚才经过你的病床。",
} as const;

export const MEDICAL_605_CHOICES = {
  A: [
    { id: "r1953", label: "核对R-1953标签", evidence: "林伟主动把档案带向B1。" },
    { id: "ghost", label: "追踪白衣鬼影", evidence: "它在林伟进入画面前已经站在电梯旁。" },
  ],
  B: [
    { id: "timecode", label: "核对倒退的时间码", evidence: "录像被人为拼接过。" },
    { id: "reflection", label: "查看电梯反光", evidence: "病床曾随电梯下降到B1。" },
  ],
} as const;

export function rollMedicalTop(seed: number): MedicalTopRolls {
  const params = new URLSearchParams(window.location.search);
  const random = createSeededRandom(hashSeed(`${seed}:medical-top-v1`));
  const routeRoll = random();
  const routeOverride = params.get("medicalRoute");
  const route: MedicalTopRoute = routeOverride === "third"
    ? "third-knock"
    : routeOverride === "602"
      ? "false-602"
      : routeOverride === "normal"
        ? "normal"
        : routeRoll < 0.4
          ? "normal"
          : routeRoll < 0.7
            ? "third-knock"
            : "false-602";
  const tagOverride = params.get("medicalTag");
  const fuseOverride = params.get("medicalFuse");
  const cctvOverride = params.get("medicalCctv");
  return {
    route,
    abnormalTag: tagOverride === "abnormal" || (tagOverride !== "normal" && random() < 0.5),
    fuseAvailable: fuseOverride === "1" || (fuseOverride !== "0" && random() < 0.3),
    cctvPack: cctvOverride === "B" || (cctvOverride !== "A" && random() < 0.5) ? "B" : "A",
  };
}
