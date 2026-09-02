import { createSeededRandom, hashSeed } from "./seededRandom";
import type { MedicalTopRoomId } from "./InteriorAssetLoader";

export type MedicalTopRoute = "normal" | "third-knock" | "false-602";
export type MedicalTopCctvPack = "A" | "B";
export type MedicalTopRecordAnomaly = "extra-return" | "revoked-rule" | "reader-listed";
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
  recordAnomaly: MedicalTopRecordAnomaly | null;
  abnormalTag: boolean;
  fuseAvailable: boolean;
  cctvPack: MedicalTopCctvPack;
  loadingText?: string;
}

export type MedicalTopModal =
  | { kind: "rules" }
  | { kind: "record"; revisit: boolean; anomaly: MedicalTopRecordAnomaly | null }
  | { kind: "skull"; abnormal: boolean }
  | { kind: "cctv"; pack: MedicalTopCctvPack };

export interface MedicalTopRolls {
  route: MedicalTopRoute;
  recordAnomaly: MedicalTopRecordAnomaly | null;
  abnormalTag: boolean;
  fuseAvailable: boolean;
  cctvPack: MedicalTopCctvPack;
}

export type MedicalRuleTone = "normal" | "red" | "struck" | "faded" | "corrupt";

export interface MedicalRuleLine {
  text: string;
  tone?: MedicalRuleTone;
  emphasis?: string;
}

/**
 * Each clause is kept as an authored line instead of a single flowing string.
 * This lets the notice reproduce overwritten, crossed-out and hostile edits
 * without putting the document inside a made-up card UI.
 */
export const MEDICAL_TOP_RULES: ReadonlyArray<{ lines: ReadonlyArray<MedicalRuleLine> }> = [
  { lines: [{ text: "夜间巡查时间为23:30至次日5:30，请随身携带巡查记录夹。" }] },
  { lines: [{ text: "六层开放房间为601、603、605。六层从未设置602室。" }] },
  { lines: [{ text: "请勿在教学区域饮食、奔跑或大声交谈。" }] },
  { lines: [{ text: "公告栏没有接通电源。如果它正在发光，请在阅读完毕前不要离开。" }] },
  { lines: [{ text: "进入房间前请核对门牌。门牌数字只能被确认一次。" }] },
  { lines: [
    { text: "靠近601后请保持安静。听见两声敲门，第二声结束后方可进入。" },
  ] },
  { lines: [
    { text: "如果听见第三声，请勿开门。" },
    { text: "第三声不在门里。", tone: "red" },
  ] },
  { lines: [
    { text: "离开值班室时请关闭照明，并确认巡查记录上只有你的姓名。" },
  ] },
  { lines: [
    { text: "如果记录上已经写有你的姓名，请不要再次签名。" },
    { text: "如果字迹尚未干，请不要确认那是不是你的字。" },
  ] },
  { lines: [
    { text: "走廊方形灯具共十二盏。" },
    { text: "请不要数。" },
    { text: "请确认它们一共有十二盏。" },
  ] },
  { lines: [
    { text: "夜间可能听见病床经过走廊。请站到墙边，为医护运输让出通道。" },
  ] },
  { lines: [{ text: "六层没有病床。", tone: "red" }] },
  { lines: [
    { text: "如果病床声停在你的身后，请继续面向前方。" },
    { text: "不要让它知道你已经让开。", tone: "red" },
  ] },
  { lines: [{ text: "603内的白布用于覆盖教学模型，请勿擅自掀开。" }] },
  { lines: [
    { text: "如果白布下方正在呼吸，请检查标本编号，不要检查呼吸来源。" },
  ] },
  { lines: [
    { text: "本层所有教学标本编号均以“M”开头。" },
    { text: "R-1953不是教学标本。", tone: "red" },
  ] },
  { lines: [
    { text: "走廊中央窗户应当保持关闭。发现窗户开启时，请通知值班人员。" },
    { text: "不要通知窗外的值班人员。", tone: "red" },
  ] },
  { lines: [{ text: "605监控画面存在七秒延迟。" }] },
  { lines: [
    { text: "当监控画面中出现两个人时，请勿回头。关闭画面，背向房门离开。" },
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
    { text: "走廊灯光将于零时自动关闭。灯光关闭后请立即前往电梯。" },
  ] },
  { lines: [
    { text: "不要走向熄灭的灯。" },
    { text: "不要让熄灭的灯走向你。", tone: "red" },
  ] },
  { lines: [
    { text: "电梯到达前请保持呼吸。" },
    { text: "请保　呼吸。", tone: "red" },
    { text: "请停止呼吸。", tone: "red" },
    { text: "呼吸呼吸呼吸呼吸呼吸呼吸呼吸呼吸", tone: "corrupt" },
  ] },
  { lines: [
    { text: "进入电梯后，请确认轿厢内没有其他人。" },
    { text: "如果只有你一个人，请重新确认你是不是“其他人”。", tone: "red" },
  ] },
  { lines: [
    { text: "本守则共二十七条。请勿阅读不存在的第二十八条。", emphasis: "请勿阅读不存在的第二十八条。" },
  ] },
];

export const MEDICAL_601_RECORD = [
  "六层夜间巡查记录",
  "",
  "2008年3月5日 23:47　601：正常　603：封存　605：信号中断　返回人数：1",
  "2008年3月6日 23:47　601：正常　603：无人　605：信号中断　返回人数：2",
  "2008年3月7日 23:47　601：未进入　603：已归还　605：正在观看　返回人数：1",
  "2008年3月8日 23:47　601：已到　603：已到　605：已到　返回人数：0",
  "",
  "补记：病床已让行。",
  "补记：602门牌已纠正。",
  "补记：六层窗口从未开启。",
  "补记：1953年的封存物不得经由六层电梯转运。",
  "",
] as const;

export const MEDICAL_601_OBSERVATIONS = [
  "四份记录都停在23:47，像是同一分钟被重复抄写了四遍。",
  "“返回人数”从1变成2，又变成0；纸页边缘却只有一组指纹。",
  "最后的签名不是墨水。红色正从“林伟”两个字里慢慢渗出来。",
  "最早一页的纸张已经发黄，最新一页却和你今晚携带的记录纸完全相同。有人提前写完了这次巡查。",
] as const;

export const MEDICAL_601_ANOMALIES: Readonly<Record<MedicalTopRecordAnomaly, {
  lines: ReadonlyArray<MedicalRuleLine>;
  scareText: string;
}>> = {
  "extra-return": {
    lines: [
      { text: "2008年3月9日 23:47　601：门已开启　603：标签已更换　605：正在播放　返回人数：2" },
      { text: "补记：第二名巡查员与第一名拥有同一张脸。", tone: "faded" },
      { text: "守则第8条：离开值班室前，记录上只能有你的姓名。", tone: "struck" },
      { text: "你刚才没有签名。记录上却已经有了两个你。", tone: "corrupt" },
      { text: "多出来的人正在和你一起读这份记录。", tone: "red" },
    ],
    scareText: "纸页旁边传来翻页声。你没有碰它。",
  },
  "revoked-rule": {
    lines: [
      { text: "临时修订：第11条作废。病床经过时请站在走廊中央。", tone: "struck" },
      { text: "红笔复核：第11条从未作废。第12条也从未说过真话。", tone: "red" },
      { text: "昨夜巡查员依照作废条款站在中央。返回人数：0。", tone: "faded" },
      { text: "记录夹边缘有四道平行压痕，间距与病床脚轮完全相同。", tone: "faded" },
      { text: "病床已完成巡查。", tone: "corrupt" },
    ],
    scareText: "门外的脚轮停了。它像是在等你站到中央。",
  },
  "reader-listed": {
    lines: [
      { text: "下一次巡查员：正在阅读本页的人。", tone: "red" },
      { text: "到岗时间：2008年3月8日 23:47（已签到）", tone: "faded" },
      { text: "签名字迹仍然潮湿，墨水沿着你的姓往纸张背面渗。", tone: "faded" },
      { text: "如尚未到岗，请不要抬头。值班室里还有一份你正在阅读的记录。", tone: "corrupt" },
    ],
    scareText: "记录末尾的签名，和你刚才写下的一模一样。",
  },
};

export const MEDICAL_603_LABELS = {
  normal: "M-603-17 / 教学颅骨 / 入库：2001-09-03",
  abnormal: "R-1953 / 姓名：林伟 / 入库：今晚23:47 / 状态：已返回",
} as const;

export const MEDICAL_603_OBSERVATIONS = {
  normal: [
    "标签的塑封已经泛黄，编号与守则中的教学标本格式一致。",
    "颅骨后脑有一道旧划痕，像是曾经被固定在别的展示架上。",
    "白布边缘仍在缓慢起伏。你对照第15条，只检查编号，没有去寻找呼吸来自哪里。",
  ],
  abnormal: [
    "标签背面的胶还没有干，‘今晚23:47’像是你进入603以后才打印出来。",
    "守则第16条说所有教学标本都以M开头；R-1953却和601记录一起写着林伟。",
    "守则第9条不允许重复签名。标签上的姓名却像被不同的人写过七次，每一次都是林伟。",
    "白布下的呼吸在你读出R-1953以后停了。病床床垫却在没有重量的地方慢慢凹下去。",
    "‘状态：已返回’不是标本状态。你移开视线时，颅骨已经更靠近603房门。",
  ],
} as const;

export const MEDICAL_605_TRUTH = "录像摄于2008年3月8日，时间与601记录完全一致。林伟怀里抱着编号R-1953的档案；那并不是教学标本，而是一份从1953年地下封存库取出的旧病理档案。他不是从地下逃到六层，而是在重复一条早已被写进巡查记录的路线。缺失的七秒里，他进入了电梯；跟在他身后的女人却在电梯开门以前，就已经站在六层。";

export const MEDICAL_605_ANOMALY = {
  A: "白衣女人始终落后林伟半步。她穿着1953年照片中的旧式白衣和绣花鞋，袖口正在滴水；最后一帧里身体仍朝前，脸却已经越过肩膀直视监控。她是苏婉，或者有人正借用苏婉的样子。",
  B: "同一时间码里出现了两个林伟。下一帧两人同时消失，本应关闭的电梯里却停着刚才经过走廊的病床；苏婉站在床后，绣花鞋没有接触地面，隔着整条走廊直视监控。",
} as const;

export const MEDICAL_605_CHOICES = {
  A: [
    { id: "r1953", label: "核对R-1953标签", evidence: "林伟主动把档案带向B1。", outcome: ["档案封条不是今晚拆开的。封口处叠着2001年、1994年和更早的旧胶痕，每隔七年就有人重新封存一次。", "最底层露出的登记栏写着“苏婉，1953”。姓名旁边没有死亡标记，只有两个字：转运。", "林伟带走档案不是为了放出她。他像是在阻止地下的人再次修改这份记录。"] },
    { id: "ghost", label: "追踪白衣女人", evidence: "她在林伟进入画面前已经站在电梯旁。", outcome: ["你逐帧追踪白衣女人。她从未碰过林伟，每一次出现都站在他与电梯之间，像在拦住他继续向下。", "她脚下没有湿脚印，水痕却从袖口一路指向605摄像机。画面边缘短暂出现手写字：不要让档案回到地下。", "这与校园传言相反。至少在这段录像里，苏婉不是追逐者，更像一名失败的阻拦者。"] },
  ],
  B: [
    { id: "timecode", label: "核对倒退的时间码", evidence: "录像被人为拼接过。", outcome: ["两个林伟并非同时存在：右侧画面比左侧晚七秒，却被强行覆盖在同一时间码上。有人剪掉了真正位于两段之间的内容。", "残留的一帧里，林伟把R-1953塞进电梯门缝，白衣女人则站在他身后，双手抓住另一条从地下伸出的黑影。", "七秒延迟不是故障，而是一段被反复删除、又不断自行恢复的证据。"] },
    { id: "reflection", label: "查看电梯门内", evidence: "病床曾随电梯下降到B1。", outcome: ["你放大电梯区域。病床先于开门动作出现在轿厢里，仿佛录像漏掉的不是七秒，而是一次完整的上行。", "苏婉站在床后，面对镜头，用口型重复“不要下来”。她没有推动病床；床栏另一侧始终有一只不属于她的手。", "那只手从B1方向把床拖回黑暗。病床下降不是运输，而是有人在把1953年的封存物重新送回地下。"] },
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
  const abnormalTag = tagOverride === "abnormal" || (tagOverride !== "normal" && random() < 0.5);
  const fuseAvailable = fuseOverride === "1" || (fuseOverride !== "0" && random() < 0.4);
  const cctvPack = cctvOverride === "B" || (cctvOverride !== "A" && random() < 0.5) ? "B" : "A";

  // Keep the patrol-record roll on its own stream so adding this authored
  // anomaly does not silently reshuffle the established tag/fuse/CCTV seed.
  const recordOverride = params.get("medicalRecord");
  const recordRandom = createSeededRandom(hashSeed(`${seed}:medical-top-record-v1`));
  const anomalyIds: MedicalTopRecordAnomaly[] = ["extra-return", "revoked-rule", "reader-listed"];
  const recordAnomaly = recordOverride === "normal"
    ? null
    : anomalyIds.includes(recordOverride as MedicalTopRecordAnomaly)
      ? recordOverride as MedicalTopRecordAnomaly
      : recordRandom() < 0.55
        ? anomalyIds[Math.floor(recordRandom() * anomalyIds.length)]
        : null;
  return {
    route,
    recordAnomaly,
    abnormalTag,
    fuseAvailable,
    cctvPack,
  };
}
