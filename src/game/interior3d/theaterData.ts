import type { StoryState } from "../storyData";

export type TheaterStage =
  | "foyer-reel"
  | "foyer-story"
  | "main-hall"
  | "backstage-approach"
  | "backstage-dark"
  | "mirror-target"
  | "mirror-sequence"
  | "cut-song-target"
  | "cut-song-story"
  | "chase"
  | "audience-target"
  | "camera-align"
  | "light-shutdown"
  | "blackout"
  | "projection"
  | "finale"
  | "complete";

export type TheaterModal = "foyer" | "mirror" | "cut-song" | "blackout" | "finale";

export interface TheaterSnapshot {
  stage: TheaterStage;
  hasFilm: boolean;
  mirrorLightsOn: boolean;
  ghostVisible: boolean;
  objective?: { x: number; z: number };
  ghost?: { x: number; z: number };
}

export interface TheaterPoint {
  x: number;
  y: number;
  z: number;
  radius?: number;
  yaw?: number;
}

export interface TheaterBounds3D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Stable runtime name assigned to the authored corner door before batching. */
export const THEATER_MAIN_DOOR_VISUAL_NAME = "theater_main_hall_authored_door";
export const THEATER_BACKSTAGE_DOOR_VISUAL_NAME = "theater_backstage_authored_door";
/** Highest backstage landing door, opening into the auditorium rear-left corner. */
export const THEATER_BACKSTAGE_REAR_DOOR_VISUAL_NAME = "theater_backstage_rear_authored_door";
/** Same Su Wan close-up already established by the agriculture/medicine hall. */
export const THEATER_SUWAN_JUMPSCARE_SPRITE = "library-shelf" as const;
/**
 * Version every theater bitmap request so long-lived browser/CDN caching can
 * stay immutable without pinning a replaced image forever.
 */
export const THEATER_IMAGE_CACHE_VERSION = "theater-images-v2-projection-preload";

export interface TheaterWalkableSurface {
  minX: number; maxX: number; minZ: number; maxZ: number; y: number;
}

/**
 * Ground height of the authored theater at any XZ position. The glass foyer
 * sits on a 1.65 m platform, the auditorium descends in 18 cm terraces toward
 * the stage, and metadata describes the stage/backstage treads. Shared by player
 * locomotion (Interior3D) and collision rasterization (InteriorAssetLoader)
 * so walking and blocking never drift apart.
 */
export function theaterFloorHeightAt(x: number, z: number, surfaces?: TheaterWalkableSurface[]): number {
  // Metadata records the actual GLB tread tops, including both backstage
  // flights and the two short staircases onto the stage. First match wins.
  if (surfaces) {
    for (const surface of surfaces) {
      if (x >= surface.minX && x <= surface.maxX && z >= surface.minZ && z <= surface.maxZ) return surface.y;
    }
  }
  if (z < -13.68) return 1.65;
  if (x > 22.92) return z < -12.43 ? 1.65 : -0.15;
  if (z < -12.28) return 1.65;
  if (z < -11.28) return 1.47;
  if (z < -10.28) return 1.29;
  if (z < -9.28) return 1.11;
  if (z < -8.28) return 0.93;
  if (z < -5.88) return 0.75;
  if (z < -4.88) return 0.57;
  if (z < -3.88) return 0.39;
  if (z < -2.88) return 0.21;
  if (z < -1.88) return 0.03;
  return z >= 1.406 ? 0.57 : 0;
}

export interface TheaterGameplayMeta {
  walkableSurfaces: TheaterWalkableSurface[];
  spawn: TheaterPoint;
  film: TheaterPoint & { objectName: string };
  mainDoor: TheaterPoint & {
    width: number;
    height: number;
    depth: number;
    authoredVisualBounds?: TheaterBounds3D;
  };
  removedAudienceRows?: TheaterBounds3D & { minRowSpanX?: number; maxRowSpanX?: number; maxRowDepth?: number };
  removedAudienceSections?: Array<TheaterBounds3D & { minRowSpanX?: number; maxRowSpanX?: number; maxRowDepth?: number }>;
  foyerBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    dividerZ: number;
    doorwayMinX: number;
    doorwayMaxX: number;
  };
  mainHallThreshold: TheaterPoint;
  stageFlash: TheaterPoint & { width: number; height: number; image: string };
  backstageThreshold: TheaterPoint;
  backstageDoor: TheaterGameplayMeta["mainDoor"];
  backstageRearDoor: TheaterGameplayMeta["mainDoor"];
  consoleSwitch: TheaterPoint;
  mirror: TheaterPoint;
  photoFrame: TheaterPoint & { model: string; objectName: string; scale?: number };
  mirrorBulbs: TheaterPoint[];
  ghost: TheaterPoint & { model: string; objectName: string; yaw?: number };
  backstageEscape: TheaterPoint & { backstageMinX: number };
  audienceCenter: TheaterPoint;
  projection: TheaterPoint & { width: number; height: number };
  stageLightTarget: TheaterPoint;
  lighting: {
    foyerTubes: TheaterPoint[];
    backstageTubes: TheaterPoint[];
    hallSquares: TheaterPoint[];
  };
}

export type TheaterFoyerChoice = "compare-receipt" | "compare-photo" | "inspect-splice";
export type TheaterPromiseChoice = "send-team" | "respect-baiqiu" | "stabilize-anchor";
export type TheaterWarningChoice = "suwan-warning" | "reserve-judgment" | "memorize-warning";
export type TheaterEvidenceChoice = "original-lyric" | "edit-log" | "target-list";
export type TheaterTrackChoice = "cut-track" | "preserve-track" | "isolate-track";
export type TheaterWakeChoice = "call-baiqiu" | "restore-warning" | "send-signal";
export type TheaterFinalAction = "together" | "broadcast" | "leave" | "force";

export interface TheaterEnding {
  id: "romance" | "dawn" | "public" | "escape" | "sacrifice" | "audience" | "nightmare";
  title: string;
  tone: "good" | "true" | "escape" | "bad";
  body: string[];
}

const has = (state: StoryState, item: StoryState["inventory"][number]) => state.inventory.includes(item);
const flag = (state: StoryState, key: string) => Boolean(state.flags[key]);

function evidenceGroupCount(state: StoryState): number {
  const victimTimeline = flag(state, "foyerReelMatchedReceipt")
    || (has(state, "receipt")
      && (has(state, "diary") || flag(state, "timeline_linked") || flag(state, "library_fall_witnessed")));
  const humanCrime = flag(state, "theaterEditLogCopied")
    && (has(state, "key_card") || flag(state, "checked_fall_window") || flag(state, "medicalBasementComplete"));
  const suwanProtection = (has(state, "photograph") || flag(state, "foyerReelMatchedPhoto"))
    && (flag(state, "theaterOriginalLyricCopied") || flag(state, "memorizedOriginalWarning") || flag(state, "medicalBasementConclusionProtector"));
  return Number(victimTimeline) + Number(humanCrime) + Number(suwanProtection);
}

function realityAnchorCount(state: StoryState): number {
  return [
    has(state, "photograph"),
    has(state, "diary"),
    has(state, "owl_feather"),
    flag(state, "theaterPreparedRealityAnchor"),
    flag(state, "lakeEvidenceSent"),
    flag(state, "baiqiuBond"),
    flag(state, "library_fall_witnessed"),
  ].filter(Boolean).length;
}

export function isBaiqiuAwake(state: StoryState): boolean {
  const relationship = flag(state, "baiqiuBond")
    && state.stats.affection >= 30
    && flag(state, "finalCalledBaiqiu");
  const truth = has(state, "photograph")
    && (flag(state, "theaterOriginalLyricCopied") || flag(state, "memorizedOriginalWarning"))
    && (flag(state, "finalRestoredWarning") || flag(state, "theaterTargetListCopied"));
  const protection = has(state, "talisman")
    && state.stats.affection >= 20
    && flag(state, "theaterTargetListCopied");
  return relationship || truth || protection;
}

function teamReady(state: StoryState): boolean {
  return state.stats.trust >= 60
    && flag(state, "yichengTrustsYou")
    && flag(state, "finalSentSignal")
    && (flag(state, "theaterEvidenceBackedUp") || flag(state, "lakeEvidenceSent"));
}

function escapeReady(state: StoryState): boolean {
  return state.stats.stamina >= 25
    || has(state, "energy")
    || has(state, "talisman")
    || flag(state, "theaterCommandTrackCut")
    || flag(state, "theaterTrackIsolated");
}

export function resolveTheaterEnding(state: StoryState, action: TheaterFinalAction): TheaterEnding {
  const anchors = realityAnchorCount(state);
  const evidence = evidenceGroupCount(state);
  const awake = isBaiqiuAwake(state);
  const trackSafe = flag(state, "theaterCommandTrackCut") || flag(state, "theaterTrackIsolated");
  const agency = action === "together" && awake && flag(state, "baiqiuAgencyRespected");
  const careCount = [
    flag(state, "baiqiuReassured"),
    flag(state, "askedHowToHelpBaiqiu"),
    flag(state, "theaterPromisedAgency"),
  ].filter(Boolean).length;

  if (state.stats.sanity <= 20 && anchors < 2) {
    return {
      id: "nightmare",
      title: "无尽噩梦",
      tone: "bad",
      body: [
        "你在医院醒来，手腕被固定在床栏上。值班医生说小剧场多年前已经封闭，昨夜天气晴朗，保卫处也没有接到任何报警。窗外阳光很亮，玻璃上却不断有雨水滑过。",
        "医生俯身整理被角，胸前工牌写着“杜学民”。你记得这个名字属于三个月前的死者。走廊尽头的时钟停在23:47，秒针每走一格，门缝下便卷进一小截烧焦的胶片。",
        "床头柜里找不到老照片、日记残页和猫头鹰羽毛。抽屉中放着一份刚打印的诊断书，逐项解释你如何虚构林伟、苏婉与白秋。最后一栏空着，护士把笔塞进你手里，要你签字承认那些名字从未存在。",
        "你把笔扔到地上，门外立刻响起第三轨。唱段里的『不要』已经被刮净，只剩你的姓名沿着墙壁一遍遍靠近。输液架的反光中，剧场红幕在走廊尽头升起，白秋坐在第四排，始终没有回头。",
        "夜班交接记录写着：病人情绪稳定后，可继续播放。新来的护士按下开关，病房门随即从外面锁死。",
        "你闭上眼睛，仍能看见片轴转动。下一格画面里，主演一栏已经换成你的名字。",
      ],
    };
  }

  if (action === "together" && awake && state.stats.sanity > 20 && has(state, "photograph") && trackSafe && evidence >= 2) {
    if (
      flag(state, "baiqiuBond")
      && state.stats.affection >= 45
      && agency
      && careCount >= 2
    ) {
      return {
        id: "romance",
        title: "雨停以后",
        tone: "true",
        body: [
          "你问白秋还能不能站起来。她扶着总控台，试了两次，终于把手覆在你的手背上。『我自己来，』她喘着气说，『你陪我按。』",
          "两只手同时压下断开键。姓名轨发出刺耳的倒带声，焦黑的胶片从机器里成团涌出。苏婉唱完整了『不要应声』，陈九身后的黑影随红幕一起塌落。他还想爬向开关，张一诚已经带人从侧门冲上舞台。",
          "警察赶到后，白秋坐在观众席第一排，从第一次听见戏腔讲到今晚。你把照片和目标名单放在她手边。记录员沉默片刻，划掉姓名后面的『患者』，重新写下『证人』。",
          "旧案在一个月后重启。林伟坠楼前的通话、杜学民死亡后的登录记录和R-1953原唱被列入同一份卷宗。苏婉的照片离开猎奇展板，连同她留下的唱词一起送进校史档案室。",
          "白秋按新的治疗计划定期复诊。她想独处时会直接告诉你，睡不着时也会在凌晨打电话来。你有时陪她说到天亮，有时只在电话那边听着雨声。",
          "毕业那天又下了一阵急雨。她撑开伞，走出两步后停下来，把伞沿朝你这边挪了挪。远处钟楼敲过十二下，小剧场的旧钟再也没有停回23:47。",
        ],
      };
    }
    return {
      id: "dawn",
      title: "共赴晨光",
      tone: "true",
      body: [
        "白秋听见你的问题，手指离开了确认键。她扶着椅背站起来，走到总控台前，清楚地说了一声『断开』。你按住左侧开关，她按下右侧按钮。",
        "被剪掉的否定词重新回到唱段里。苏婉站在舞台侧门前，听完整卷胶片后慢慢松开抵住门板的手。她向观众席点了一次头，旧戏服随放映机的白光渐渐透明。",
        "陈九还在喊集体幻觉，胶片、日记与控制台缓存已经被同时封存。张一诚带人守住出口，杜学民的师弟逐项核对设备编号。白秋确认最后一件证物后，警察才关上后台木门。",
        "她暂时没有谈原谅，只要求把自己的诊疗摘要全部复印一份。第二天离校前，她将最早那句『有人在改声音』用红笔圈出来，签上姓名和日期。",
        "林伟的坠楼报告随后被退回重查。农医馆那张空白小票有了正式的证物编号，苏婉的唱段也恢复原始顺序。曾经被当成疯话的几句话，终于有人逐字读完。",
        "23:47第一次继续向前。电子钟跳到23:48时，雨刚好停下。你和白秋并肩走出门厅，身后只剩片轴停止转动的轻响。",
      ],
    };
  }

  if (action === "broadcast" && flag(state, "theaterTrackPreserved") && state.stats.clues >= 70 && evidence === 3 && teamReady(state)) {
    return {
      id: "public",
      title: "拨云见日",
      tone: "good",
      body: [
        "完整编辑包、门禁时间与受害者名单上传成功，校外服务器随即返回三份校验码。张一诚等到安全信号后才带人进入，警察赶到时，陈九还蹲在总控台下拔硬盘。",
        "苏婉的原唱、林伟留下的路线和白秋遭受的每次播放被原样写进询问记录。旧案重新调查，坠楼报告中的『意外』被暂时撤下，所有经手人的姓名重新接受核对。",
        "公开数据将农医馆借阅、白沙诊疗记录、医学院死亡账号和启真湖边缺失的监控接在同一条时间线上。三名已经离校的学生看到名单后主动联系调查组，又补回两段被删去的证词。",
        "听证会那天，白秋自己走到话筒前。她承认曾经害怕，也逐次说清陈九播放第三轨的日期。有人试图用病历打断她，主持人翻开已经校验的门禁记录，请她继续讲完。",
        "苏婉与林伟的名字后来被刻在小剧场修缮说明的第一页。门厅没有摆女鬼传说，只陈列R-1953的复制件，以及那句恢复后的『不要应声』。",
        "结案通知送达时，张一诚带着两瓶酒去看林伟。雨停得很早，他把其中一瓶留在碑前，说：『这回你的话，有人信了。』",
      ],
    };
  }

  if (action === "leave" && awake && escapeReady(state)) {
    return {
      id: "escape",
      title: "远走高飞",
      tone: "escape",
      body: [
        "你关掉最近的扬声器，拉开主入口的木门。白秋自己跨过门槛，你跟着她冲进雨里。跑到广场尽头时，舞台深处仍有倒带声追出来，一直混进雷声。",
        evidence >= 2
          ? "随身带出的证据让调查组立刻封锁了陈九能够再次使用的设备。原始胶片仍留在剧场，23:47的循环没有彻底断开；至少短时间内，第三轨无法再接入新的姓名。"
          : "你没能带出足够证据。陈九和千绳会重新藏回传言背后，校方通报只写设备故障。多年以后，一张旧剧票寄到你们住处，开演时间仍印着23:47。",
        "你们当夜坐上离校的长途车。白秋一路没有睡，反复确认手机里的消息有没有被改动。天快亮时，她靠着车窗说：『是我决定走的。以后要回去，也由我自己决定。』",
        "第二天，调查人员发现小剧场重新上锁。控制台、胶片和陈九全都不见了，第四排留下两个并排的湿脚印。监控只拍到苏婉站在侧门前，画面随后被白光烧穿。",
        "你们在南方住了下来。白秋继续接受治疗，状态渐渐稳定。每逢暴雨，你们都会互相确认位置；电话接通后，她总会先说一句约定好的暗号。",
        "第三年夏天，楼下信箱又出现一张没有寄件人的节目单。白秋看完，将它撕成两半放进证物袋。她拨通张一诚的电话，说自己准备回去把那场戏收尾。",
      ],
    };
  }

  if (action === "force" && flag(state, "yichengTrustsYou") && !teamReady(state) && (state.stats.stamina < 25 || !trackSafe)) {
    return {
      id: "sacrifice",
      title: "血色兄弟",
      tone: "bad",
      body: [
        "信号只送出去一半，张一诚误判了进入时机。他从侧门冲上舞台，替你挡住陈九挥下来的刀。警察制服陈九时，张一诚已经倒在烧焦的胶片旁，手里还攥着你们约好的信号灯。",
        "救护车开出校门不到十分钟，医生便盖住了他的脸。警方报告写他『协助控制嫌疑人』，没有记录他进门前喊的那句『先带他们走』。白秋要求记录员重新打开笔，把原话补了进去。",
        "她一路握着那张未及时上传的名单，一遍遍念出张一诚与林伟的名字。名单边缘被雨水泡软，她仍不肯松手，直到每个名字都进入正式笔录。",
        "陈九被关押，姓名轨停止运转，苏婉也随着最后一段原唱消失。舞台保住了，准备不足留下的空缺却再也补不上。你后来每次听到安全信号，都会想起那晚缺失的后半句。",
        "葬礼那天下着小雨。你带了两瓶酒，把一瓶放在张一诚墓前，另一瓶放到林伟旁边。白秋站了很久，低声把苏婉完整的警告念给他们听。",
        "清明以后，墓前常有人放下一张复印的剧票。背面只写一句话：别急着冲进去，等同伴把信号发完。",
      ],
    };
  }

  return {
    id: "audience",
    title: "最后一位观众",
    tone: "bad",
    body: [
      "白秋还没有从姓名轨里醒来，你已经替她按下最后一步。她的手从总控台边缘滑落，舞台上的黑影随即停住，慢慢换成与你相同的站姿。",
      "投影里的观众同时转头看向镜头。现实座椅全都空着，最后一排却传来椅垫下沉的闷响，接着是第二个、第三个。声音一排排向你靠近，停在身后的第四排。",
      "陈九离开总控台，所有按钮依照你的选择自行复位。胶片剪下你的声音，拼出新的引导词，耐心告诉下一位来访者：只差最后一个勇敢的动作，只要自愿走上舞台。",
      "白秋的名字从目标名单上消失，也没有回到诊疗档案。你想喊她，喉咙里却传出苏婉唱段被删去否定词后的半句。白秋抬起头时，眼睛已经映不出你的影子。",
      "放映机熄灭后，剧场里响起掌声。你在黑暗中站了很久，直到陈九替你披上一件旧戏服，把你领到红幕中央。",
      "第二天，门厅多出一张没有墨迹的新海报。雨水流过玻璃时，主演栏浮现你的名字，观众一栏写着：下一位。开演时间仍是23:47。",
    ],
  };
}

export const THEATER_STEPS = [
  "拾取最后一盒胶片",
  "进入主剧场",
  "调查发光的后台镜子",
  "恢复化妆镜照明",
  "查看相框中的镜像",
  "读取被剪过的唱段",
  "逃回观众席",
  "看完最后一场演出",
  "作出最终选择",
] as const;

export function theaterProgressIndex(stage: TheaterStage): number {
  if (stage === "foyer-reel" || stage === "foyer-story") return 0;
  if (stage === "main-hall") return 1;
  if (stage === "backstage-approach") return 2;
  if (stage === "backstage-dark") return 3;
  if (stage === "mirror-target" || stage === "mirror-sequence") return 4;
  if (stage === "cut-song-target" || stage === "cut-song-story") return 5;
  if (stage === "chase" || stage === "audience-target") return 6;
  if (stage === "camera-align" || stage === "light-shutdown" || stage === "blackout" || stage === "projection") return 7;
  return 8;
}
