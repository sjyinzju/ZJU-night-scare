import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { assetUrl } from "../assetPath";
import { audioManager } from "../audio/audioManager";
import { JumpscarePipeline } from "../JumpscarePipeline";
import { prepareJumpscareSprite } from "../jumpscareAssets";
import { useGameStore } from "../store";
import type { Interior3D } from "./Interior3D";
import {
  THEATER_SUWAN_JUMPSCARE_SPRITE,
  THEATER_IMAGE_CACHE_VERSION,
  isBaiqiuAwake,
  resolveTheaterEnding,
  type TheaterEnding,
  type TheaterFinalAction,
  type TheaterModal,
  type TheaterSnapshot,
} from "./theaterData";

interface TheaterExperienceProps {
  active: boolean;
  engineRef: React.RefObject<Interior3D | null>;
  snapshot: TheaterSnapshot | null;
  modal: TheaterModal | null;
  onModalClosed: () => void;
}

type FinaleStage = "common" | "wake" | "action" | "ending" | "epilogue" | "finished";

const MIRROR_IMAGES = [
  "images/theater/theater-mirror-01-normal.png",
  "images/theater/theater-mirror-02-suwan.png",
  "images/theater/theater-mirror-03-secondary-face.png",
] as const;

const COMMON_PROJECTION_IMAGES = [
  "images/theater/theater-reel-r01-suwan-stage.png",
  "images/theater/theater-reel-r02-warning.png",
  "images/theater/theater-reel-r03-chen-edit.png",
  "images/theater/theater-reel-r04-linwei.png",
  "images/theater/theater-reel-r05-route.png",
  "images/theater/theater-reel-r06-door.png",
  "images/theater/theater-reel-r08-refusal.png",
  "images/theater/theater-reel-r09-present.png",
] as const;

const COMMON_PROJECTION_CAPTIONS = [
  "1953年，苏婉在第三折里留下警告：不要应声，不要回头，离开窗边",
  "剪刀从每句话前刮走“不要”，乳剂上的白痕至今没有褪尽",
  "陈九借死者的账号重排声音，把救人的唱段剪成了索命的命令",
  "林伟带走R-1953，想赶在坠楼以前让张超听见完整原唱",
  "借阅记录、诊疗档案、门禁和湖边监控，终于在同一条时间线上接合",
  "苏婉守在舞台与木门之间，五十多年没有让仪式越过这道幕布",
  "你把被刮掉的拒绝逐字接回胶片，姓名轨第一次出现了停顿",
  "胶片停在今夜23:47，舞台把最后一次回答留给仍然活着的人",
] as const;

const EPILOGUE = [
  "后来，紫金港仍有人讲起那场暴雨。新生从小剧场门前经过，总会放慢脚步，隔着封条看一眼门厅里的旧钟。有人听见过戏腔，有人只听见雨水顺着玻璃往下淌。故事传到第二年，细节已经变了许多，23:47这个时间却始终没人记错。",
  "调查人员从农医馆搬出积灰的借阅册，又找回白沙宿舍没有寄出的求救信。餐厅证词、医学院诊疗档案、死亡账号的登录记录和启真湖边缺失的监控，被一页页排在长桌上。原先散落在校园里的怪谈，终于接回了日期和姓名。",
  "林伟在笔记末页写过：那个女人一直叫他离开窗边。他带走R-1953，想找张超听完第三折。等这句话重新出现在报告里，已经没有人能把他从楼下扶起来。至少那张薄薄的纸留下了他的原话，事故栏旁也添上了重新调查的红章。",
  "苏婉的照片后来被放进档案袋。相纸里的她仍穿着旧戏服，眼睛望向舞台侧门。她守了五十多年，唱词被剪过一遍又一遍，嘴里那句『不要』仍留在最旧的胶片上。每逢剧场断电，门内偶尔会响起最后半句，声音很轻，也很完整。",
  "关于白秋，档案里留下过许多互相冲突的字句。有人写她病了，有人写她拒绝配合，也有人终于照着她的叙述记录：第三轨响起以后，她看见苏婉挡在门前。那一夜之后，她的名字该写在什么位置，取决于谁肯把她的话听到最后。",
  "张一诚把借阅小票压在透明袋里，杜学民的师弟逐页核对诊疗时间。老照片、日记残页、猫头鹰羽毛和门禁卡安静地躺在证物桌上。它们没有再发光；灯下留下的划痕、指纹和墨迹已经足够说明，曾有人看见这一切，也曾有人费尽力气把它写下来。",
  "校园很快恢复了原来的样子。清晨第一班校车照常经过启真湖，食堂窗口升起白雾，医学院六楼重新上锁。只有值夜的人多了一条口头规矩：听见有人在黑暗里叫名字，先确认声音从哪里来，再看清身边的人还在不在。",
  "后来再有人说起女鬼，学长会提醒他把故事讲慢一点。别漏掉林伟手里的胶片，别漏掉白秋发出的消息，也别漏掉苏婉唱词开头那两个字。一个名字从记录里消失，往往只需很短的一刀；把它写回来，需要许多人守住同一份证词。",
  "那只停了很久的钟终于向前跳了一格。雨声渐小，红灯一盏盏熄灭，片轴也在最后一次空转后停住。天亮以前，门厅里传来木门合上的轻响，像有人演完戏，终于走出了后台。",
  "第二天早晨，玻璃外的积水映着灰白的天。经过的人不会知道昨夜谁走出了小剧场，也不会知道谁仍留在胶片深处。他们只会看见封条下面多了一行手写字：听完别人说话，也让每个人亲口说出自己的选择。",
] as const;

const FOYER_STORY_TITLES = ["谁动过胶片", "把真相交给谁", "最后一轨"] as const;

const FOYER_STORY_PAGES = [
  [
    "　　门厅里没有售票员。玻璃外的广场被暴雨切成一层层灰白斜线，雷声压过屋檐时，票务台后的老挂钟便倒退一格，最后始终停在23:47。你来时明明看见主剧场的木门紧闭，此刻门缝里却漏出一线暗红，像里面有人正等着检票。雨水沿着玻璃门框爬进来，在地砖上留下一串走向前台、却没有返回的湿脚印。",
    "　　胶片铁盒平放在前台桌面，盒盖没有积灰，锁扣内侧却留着半圈新鲜指纹。褪色标签上写着『苏婉·第三折』与编号R-1953，封口的旧蜡早已断开，外面又贴了一层近年才有的透明拼接胶带。片盒底部还带着检片机的余温，显然刚从转轴上取下来。",
    "　　林伟在农医馆笔记里说，那段女人的唱腔连续三夜从不同方向叫他的名字；最早的一份调查笔录里，他还坚持那女人说的是『有人要害你』。可当时所有人都把这句话当作幻听，直到他沿着歌声走向窗边。如今同一卷胶片出现在最终地点，时间也与那张空白借阅小票完全重合。笔记最后一页被撕走，只剩半个墨迹很重的『不』字。",
    "　　闪电再亮一次，铁盒里的片轴竟自行转过一格。旧乳剂上先掠过穿戏服的苏婉，随后浮出林伟、白秋与你的名字；三个人都出生在1953年以后，名字却像早就等在胶片里。齿孔旁有一道尚未干透的切口，透明胶带上沾着新灰，说明今晚仍有人守着剪接台。",
  ],
  [
    "　　这盒胶片既是证词，也是仍连着后台设备的一段载体。它能证明苏婉留下过警告，也可能在你播放它的瞬间，把新的声音、位置和姓名送回剪接台。陈九最擅长截走一句话的前半段，等旁人替他补完后面的谎言。片尾有一格感光异常，像一只眼睛贴在门厅这一侧看着你。",
    "　　手机只剩一格信号。张一诚发来的安全暗号停在半小时前，杜学民师弟则反复提醒你，真正的杜学民早已死亡，今晚仍在使用那个账号的人只能是陈九。若证据没有先传出去，等剧场重新上锁，明天所有门禁与诊疗记录都可能再次变成一场『集体幻觉』。信号图标亮一下又熄灭，屏幕却自行弹出『杜医生正在输入』。",
    "　　白秋最后一条消息只有两行：『如果你找到我，先听我说完。别再让别人替我解释我看见了什么。』你想起陈九把她的每一次警告都写成发病，又把她与人的疏远说成治疗需要。他等着恐惧耗空一个活人，再等周围的人先不相信她；此刻替她决定，同样可能落进他的安排。聊天框底部还有一段没发出的录音，时长恰好十一秒。",
    "　　雷光越过玻璃，照片、日记和猫头鹰羽毛在桌面上投出三道方向不同的影子。你只能先固定一种关系：把证据交给场外的人，把选择还给白秋，或用已经确认过的实物校准胶片。木门后传来三下轻响，像有人用指节催你快些决定；挂钟的秒针仍旧停着。",
  ],
  [
    "　　你把胶片贴近票务台残存的检片灯，逐格转动片轴。1953年的唱词从头到尾都在警告来人，每一句开头都留着同样的两个字：『不要』。不要应声，不要回头，离开窗边，不要把名字交给他们。那些字很浅，像被刀尖从画面上刮过，却没有完全刮净。每处刮痕旁都有苏婉用铅笔补回的小点，连起来正好指向后台。",
    "　　新接入的一轨只保留了后半句：应声、回头、到窗边来。波形边缘还有三处生硬停顿，正好容得下林伟、白秋和张超。林伟听见的女声原本在救他；有人借苏婉的声音，把救人的警告重新排列成了命令。三个人名的拼口颜色更新，制作时间与今晚的门禁记录只差两分钟。",
    "　　老照片背面那句『若我不能出去，就让他们也不能出去』与齿孔间的铅笔校对出自同一只手。苏婉没有在剧场里等祭品；她先发现旧医学院的人在用唱段和名字做试验，随后用自己的声音封住了通道。陈九把她写成恶鬼，只因为死者无法替自己补回被剪掉的字。照片边缘还有一道反复折叠的痕迹，展开后露出两个小字：侧门。",
    "　　胶片末端忽然停住。最里面只剩一句极细的手写警告：『后来听见我的人，请先相信还活着的人。』主剧场门后的红光随雷声熄灭了一瞬。门锁内部随即传来齿轮空转的声音，仿佛这句话等了许多年，终于等到一个肯读完它的人。",
  ],
] as const;

const THEATER_RED_TEXT = new Set(["23:47", "『不要』", "“不要”", "说“不”"]);
const THEATER_RED_PATTERN = /(23:47|『不要』|“不要”|说“不”)/g;

function renderTheaterText(text: string) {
  return text.split(THEATER_RED_PATTERN).map((part, index) => (
    THEATER_RED_TEXT.has(part)
      ? <span className="theaterRedText" key={`${part}-${index}`}>{part}</span>
      : part
  ));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function updateStory(
  flags: Record<string, boolean>,
  stats: Partial<{ sanity: number; stamina: number; clues: number; trust: number; affection: number }> = {},
  log?: string,
) {
  let nextState = useGameStore.getState().storyState;
  useGameStore.getState().setStoryState((previous) => {
    nextState = {
      ...previous,
      flags: { ...previous.flags, ...flags },
      stats: {
        ...previous.stats,
        sanity: clamp(previous.stats.sanity + (stats.sanity ?? 0)),
        stamina: clamp(previous.stats.stamina + (stats.stamina ?? 0)),
        clues: clamp(previous.stats.clues + (stats.clues ?? 0)),
        trust: clamp(previous.stats.trust + (stats.trust ?? 0)),
        affection: clamp(previous.stats.affection + (stats.affection ?? 0)),
      },
      log: log ? [log, ...previous.log].slice(0, 6) : previous.log,
    };
    return nextState;
  });
  return nextState;
}

export default function TheaterExperience({
  active,
  engineRef,
  snapshot,
  modal,
  onModalClosed,
}: TheaterExperienceProps): React.ReactElement | null {
  const [foyerPage, setFoyerPage] = useState(0);
  const [cutSongPage, setCutSongPage] = useState(0);
  const [mirrorIndex, setMirrorIndex] = useState(0);
  const [projectionIndex, setProjectionIndex] = useState(-1);
  const [finaleStage, setFinaleStage] = useState<FinaleStage>("common");
  const [ending, setEnding] = useState<TheaterEnding | null>(null);
  const [advanceLocked, setAdvanceLocked] = useState(false);
  const [projectionLoadState, setProjectionLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [projectionLoadAttempt, setProjectionLoadAttempt] = useState(0);
  const mirrorStartedAt = useRef(0);
  const endingStartedAt = useRef(0);
  const mirrorScareTriggered = useRef(false);
  const preloadedImages = useRef<HTMLImageElement[]>([]);
  const baiqiuBond = useGameStore((state) => Boolean(state.storyState.flags.baiqiuBond));

  const projectionImages = useMemo(() => [
    ...COMMON_PROJECTION_IMAGES.slice(0, 6),
    baiqiuBond
      ? "images/theater/theater-reel-r07a-baiqiu-remembers.png"
      : "images/theater/theater-reel-r07b-baiqiu-lost.png",
    ...COMMON_PROJECTION_IMAGES.slice(6),
  ], [baiqiuBond]);

  const projectionCaptions = useMemo(() => [
    ...COMMON_PROJECTION_CAPTIONS.slice(0, 6),
    baiqiuBond
      ? "白秋认出了那道影子，也终于认出自己从未失去判断"
      : "白秋仍被困在别人替她写下的诊断与姓名之间",
    ...COMMON_PROJECTION_CAPTIONS.slice(6),
  ], [baiqiuBond]);

  useEffect(() => {
    if (!active) return;
    preloadedImages.current = MIRROR_IMAGES.map((relativePath) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.src = assetUrl(relativePath, THEATER_IMAGE_CACHE_VERSION);
      void image.decode().catch((error) => console.warn(`[Theater] Image preload failed: ${relativePath}`, error));
      return image;
    });
    void prepareJumpscareSprite(THEATER_SUWAN_JUMPSCARE_SPRITE);
    void audioManager.prepareJumpscare();
    return () => { preloadedImages.current = []; };
  }, [active]);

  const theaterRuntimeReady = snapshot !== null;
  useEffect(() => {
    if (!active || !theaterRuntimeReady) return;
    void engineRef.current?.preloadTheaterProjection(projectionImages).catch((error) => {
      console.warn("[Theater] Projection preload was incomplete; playback will retry failed images.", error);
    });
  }, [active, engineRef, projectionImages, theaterRuntimeReady]);

  useEffect(() => {
    if (!active || modal !== "mirror") return;
    setMirrorIndex(0);
    mirrorStartedAt.current = performance.now();
    mirrorScareTriggered.current = false;
  }, [active, modal]);

  const advanceMirror = useCallback(() => {
    if (modal !== "mirror" || mirrorScareTriggered.current) return;
    const minimum = mirrorIndex === 2 ? 1500 : 350;
    if (performance.now() - mirrorStartedAt.current < minimum) return;
    if (mirrorIndex < 2) {
      setMirrorIndex((index) => index + 1);
      mirrorStartedAt.current = performance.now();
      return;
    }
    mirrorScareTriggered.current = true;
    JumpscarePipeline.executeStoryEffect(
      "ghost_close",
      1,
      "镜子里的脸没有跟你转头",
      THEATER_SUWAN_JUMPSCARE_SPRITE,
      6,
    );
    window.setTimeout(() => {
      onModalClosed();
      engineRef.current?.completeTheaterMirror();
    }, 1050);
  }, [engineRef, mirrorIndex, modal, onModalClosed]);

  useEffect(() => {
    if (modal !== "mirror") return;
    const delay = mirrorIndex === 2 ? 1500 : 3000;
    const timer = window.setTimeout(advanceMirror, delay);
    return () => window.clearTimeout(timer);
  }, [advanceMirror, mirrorIndex, modal]);

  useEffect(() => {
    if (!active || snapshot?.stage !== "light-shutdown") return;
    audioManager.fadeForTheaterBlackout(4800);
  }, [active, snapshot?.stage]);

  useEffect(() => {
    if (!active || modal !== "blackout") return;
    const timer = window.setTimeout(() => {
      onModalClosed();
      engineRef.current?.beginTheaterProjection();
      setProjectionIndex(0);
      audioManager.restartForTheaterProjection(0.11, 1100);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [active, engineRef, modal, onModalClosed]);

  useEffect(() => {
    if (!active || snapshot?.stage !== "projection" || projectionIndex < 0) return;
    const image = projectionImages[projectionIndex];
    if (!image) {
      setProjectionLoadState("idle");
      setProjectionIndex(-1);
      engineRef.current?.finishTheaterProjection();
      return;
    }
    let cancelled = false;
    let unlock: number | undefined;
    let advance: number | undefined;
    setAdvanceLocked(true);
    setProjectionLoadState("loading");
    const runtime = engineRef.current;
    if (!runtime) {
      setProjectionLoadState("error");
      console.error(`[Theater] Projection runtime was unavailable for ${image}`);
    } else {
      void runtime.showTheaterProjection(image).then((shown) => {
        if (cancelled) return;
        if (!shown) throw new Error(`Projection request became inactive before display: ${image}`);
        setProjectionLoadState("ready");
        unlock = window.setTimeout(() => setAdvanceLocked(false), 350);
        // The four-second viewing window starts only after the texture is ready
        // and has been assigned to the projection material.
        advance = window.setTimeout(() => setProjectionIndex((index) => index + 1), 4000);
      }).catch((error) => {
        if (cancelled) return;
        setProjectionLoadState("error");
        setAdvanceLocked(false);
        console.error(`[Theater] Projection image failed to load: ${image}`, error);
      });
    }
    return () => {
      cancelled = true;
      if (unlock !== undefined) window.clearTimeout(unlock);
      if (advance !== undefined) window.clearTimeout(advance);
    };
  }, [active, engineRef, projectionImages, projectionIndex, projectionLoadAttempt, snapshot?.stage]);

  const advanceProjection = useCallback(() => {
    if (snapshot?.stage !== "projection" || advanceLocked || projectionIndex < 0) return;
    if (projectionLoadState === "error") {
      setProjectionLoadAttempt((attempt) => attempt + 1);
      return;
    }
    if (projectionLoadState !== "ready") return;
    setProjectionIndex((index) => index + 1);
  }, [advanceLocked, projectionIndex, projectionLoadState, snapshot?.stage]);

  useEffect(() => {
    if (modal === "finale") {
      setFinaleStage("common");
      setEnding(null);
    }
  }, [modal]);

  const finishEpilogue = useCallback(() => {
    setFinaleStage("finished");
    engineRef.current?.completeTheater();
  }, [engineRef]);

  const advanceEnding = useCallback(() => {
    if (finaleStage === "ending") {
      if (performance.now() - endingStartedAt.current < 3000) return;
      setFinaleStage("epilogue");
      return;
    }
  }, [finaleStage]);

  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (modal === "mirror") advanceMirror();
      else if (snapshot?.stage === "projection") advanceProjection();
      else if (finaleStage === "ending") advanceEnding();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, advanceEnding, advanceMirror, advanceProjection, finaleStage, modal, snapshot?.stage]);

  if (!active) return null;

  const chooseFoyer = (flags: Record<string, boolean>, stats: Parameters<typeof updateStory>[1], log: string) => {
    updateStory(flags, stats, log);
    if (foyerPage < 2) setFoyerPage((page) => page + 1);
    else {
      onModalClosed();
      engineRef.current?.completeTheaterFoyer();
    }
  };

  const chooseCutSong = (flags: Record<string, boolean>, stats: Parameters<typeof updateStory>[1], log: string) => {
    updateStory(flags, stats, log);
    if (cutSongPage === 0) setCutSongPage(1);
    else {
      onModalClosed();
      engineRef.current?.completeTheaterCutSong();
    }
  };

  const chooseWake = (id: "call" | "warning" | "signal") => {
    if (id === "call") updateStory({ finalCalledBaiqiu: true }, { affection: 6, sanity: 2 }, "你先喊出了白秋的名字，没有替她回答。 ");
    if (id === "warning") updateStory({ finalRestoredWarning: true }, { clues: 5, sanity: 2 }, "你把苏婉被剪掉的“不要”重新念完整。 ");
    if (id === "signal") updateStory({ finalSentSignal: true }, { trust: 5, clues: 3 }, "你先把编辑记录与目标名单发给场外同伴。 ");
    setFinaleStage("action");
  };

  const chooseAction = (action: TheaterFinalAction) => {
    const current = useGameStore.getState().storyState;
    const next = updateStory(
      {
        finalActionTogether: action === "together",
        finalActionBroadcast: action === "broadcast",
        finalActionLeave: action === "leave",
        finalActionForce: action === "force",
        baiqiuAgencyRespected: action === "together" && isBaiqiuAwake(current),
      },
      action === "force" ? { stamina: -8, sanity: -4 } : action === "together" ? { affection: 5, sanity: 3 } : {},
      `你选择了终章行动：${action}。`,
    );
    const resolved = resolveTheaterEnding(next, action);
    setEnding(resolved);
    setFinaleStage("ending");
    endingStartedAt.current = performance.now();
  };

  return (
    <>
      {modal === "foyer" && (
        <section className="theaterNarrativeOverlay">
          <div className="storyModal theaterStoryModal" role="dialog" aria-label="最后一盒胶片">
            <div className="storyKicker"><span>终章</span><b>小剧场 / 门厅</b></div>
            <h1>{FOYER_STORY_TITLES[foyerPage]}</h1>
            <div className="storyText">
              {FOYER_STORY_PAGES[foyerPage].map((paragraph, index) => (
                <p
                  key={paragraph}
                  className={index === FOYER_STORY_PAGES[foyerPage].length - 1 ? "theaterShockLine" : undefined}
                  style={{ "--story-line-delay": `${180 + index * 260}ms` } as CSSProperties}
                >
                  {renderTheaterText(paragraph)}
                </p>
              ))}
            </div>
            <div className="choiceList">
              {foyerPage === 0 && <>
                <button className="choiceButton" onClick={() => chooseFoyer({ foyerReelMatchedReceipt: true }, { clues: 6 }, "借阅小票与胶片都停在23:47。")}>用借阅小票比对片盒编号<em>受害时间线 / 线索 +6</em></button>
                <button className="choiceButton" onClick={() => chooseFoyer({ foyerReelMatchedPhoto: true }, { clues: 5 }, "照片背后的1953与胶片首演年份一致。")}>把苏婉老照片贴近检片灯<em>苏婉证据 / 线索 +5</em></button>
                <button className="choiceButton" onClick={() => chooseFoyer({ foyerSawModernSplice: true }, { sanity: -3, clues: 4 }, "你辨认出胶片上近年才使用的拼接材料。")}>拆开片头，检查新接入的拼口<em>人为编辑 / 线索 +4 / 理智 -3</em></button>
              </>}
              {foyerPage === 1 && <>
                <button className="choiceButton" onClick={() => chooseFoyer({ theaterEvidenceBackedUp: true }, { trust: 6 }, "你把胶片关键帧发送给张一诚和调查者。")}>先把关键帧发给场外同伴<em>团队支援 / 信任 +6</em></button>
                <button className="choiceButton" onClick={() => chooseFoyer({ theaterPromisedAgency: true, baiqiuReassured: true }, { affection: 8, sanity: 2 }, "你答应找到白秋以后，先听她说，不替她决定。")}>回复白秋：我先听你说，不替你决定<em>白秋自主 / 好感度 +8 / 理智 +2</em></button>
                <button className="choiceButton" onClick={() => chooseFoyer({ theaterPreparedRealityAnchor: true }, { sanity: 5 }, "你用现有证物校准了胶片里反复变化的画面。")}>用日记和羽毛固定变化中的画面<em>现实锚 / 理智 +5</em></button>
              </>}
              {foyerPage === 2 && <>
                <button className="choiceButton" onClick={() => chooseFoyer({ theaterUnderstoodSuwan: true }, { clues: 4 }, "你确认苏婉留下的从头到尾都是警告。")}>承认苏婉一直在阻止仪式<em>苏婉保护证据 / 线索 +4</em></button>
                <button className="choiceButton" onClick={() => chooseFoyer({ theaterReservedJudgment: true }, { sanity: 2, trust: 2 }, "你决定在听完原唱前不替任何人定性。")}>暂不下结论，保留每一种解释<em>理智 +2 / 信任 +2</em></button>
                <button className="choiceButton" onClick={() => chooseFoyer({ memorizedOriginalWarning: true }, { sanity: -1, clues: 3 }, "你记住了完整警告：不要应声，不要回头，离开窗边。")}>逐字记住被剪掉的完整警告<em>终局唤醒 / 线索 +3</em></button>
              </>}
            </div>
          </div>
        </section>
      )}

      {modal === "mirror" && (
        <section className="theaterImageSequence" onClick={advanceMirror} aria-label={`镜中照片 ${mirrorIndex + 1}/3`}>
          <img crossOrigin="anonymous" src={assetUrl(MIRROR_IMAGES[mirrorIndex], THEATER_IMAGE_CACHE_VERSION)} alt={["镜中只有玩家视角与身后的戏服架", "苏婉出现在镜中视线中央", "视线边缘贴近一张不应存在的脸"][mirrorIndex]} />
          <span>{mirrorIndex + 1} / 3</span>
          {mirrorIndex < 2 && <p>点击任意位置或按任意键继续</p>}
        </section>
      )}

      {modal === "cut-song" && (
        <section className="theaterNarrativeOverlay">
          <div className="storyModal theaterStoryModal" role="dialog" aria-label="被剪过的唱段">
            <div className="storyKicker"><span>终章</span><b>小剧场 / 后台控制台</b></div>
            <h1>被剪过的唱段</h1>
            <div className="storyText theaterTranscript">
              {cutSongPage === 0 ? <>
                <p>　　控制台没有播放声音。屏幕先显示『杜学民账号已登录』，随后吐出两列逐字转写。左列标注为1953年原胶片，时间码从23:46:51开始。账号头像仍是医院证件照，登录位置却写着你脚下这间后台：</p>
                <p className="theaterOriginalText">不要应声　不要回头　离开窗边　不要把名字交给他们</p>
                <p>　　右列标注为『今晚循环／第三轨』，长度只比原唱短了十一秒。每个缺口都被红框圈出，修改者一栏始终显示同一个已经死亡的名字：</p>
                <p className="theaterCutText">应声　回头　到窗边来　林伟　白秋　张超</p>
                <p>　　你把两列波形叠在一起。右列没有录进一句新命令，只在四处删掉『不要』，把『离开』反接成『到……来』，再将三个后来出生的名字塞进苏婉换气的停顿。林伟临死前反复说『她在叫我』，听见的其实是剪接台拼出的声音。最后一个波峰后还藏着急促的敲击，节奏与他留在农医馆笔记边缘的求救记号完全相同。</p>
                <p>　　操作日志显示，剪接任务由一个早已死亡的杜学民账号创建，门禁授权却来自仍在活动的校友卡。最近三年的每次修改，都紧跟着白秋的一次『病情记录』或校园里一名学生的失踪。早先的询问笔录中，陈九说自己只利用了几次暗示；屏幕上的三十七次导出记录却全部带着他的校友卡编号。最新一次导出就在十七分钟前，目标栏里已经写入你的姓名。</p>
                <p className="theaterShockLine">　　最早一条设备记录来自苏婉死后的第二天：『封存原唱，建立警告反向样本。』她先用唱段挡住了通道，陈九随后夺走这段声音，把救命的话反复剪成通往窗边的路。屏幕忽然自行回放那条记录，红字一遍遍覆盖旧字：警告反向样本，第三次人体响应准备完成。</p>
              </> : <>
                <p>　　你点开最后一轨，里面没有声音，只有一串等待写入的姓名。林伟后面标着『已响应／失败』，白秋后面标着『媒介稳定』，你的名字仍在闪烁，状态是『待自愿确认』。陈九留下的那句『仪式需要你自愿』，藏在每一次看似勇敢的牺牲选项里。光标停在确认键上，系统甚至替你拟好了同意书。</p>
                <p>　　白秋的姓名下连着几十份诊疗摘要：幻听、人格分裂、拒绝合作、依赖对象风险。将日期与门禁日志并排后，每次记录都发生在陈九播放第三轨之后。她看见苏婉挡在门前，陈九便把这段目击写成发病；她拒绝再次接受播放，他又在摘要里添上『缺乏自知力』。这些字层层盖住她最早那句『有人在改声音』。</p>
                <p>　　控制台给出三种处理方式。删除命令轨会立刻切断姓名呼叫，让追逐者失去一部分指令，但也会毁掉陈九最直接的编辑证据；完整保留并上传，能固定死亡账号、门禁和波形记录，却会让设备继续叫出你们的名字；猫头鹰羽毛可以把轨道隔离到离线缓存，不过最终只留下经过校验的摘要。</p>
                <p>　　你还看见一条被折叠的备注，落款只有一个『林』字：『如果我没能带走R-1953，告诉张超，我听见的女人一直叫我别过去。』他已经发现真相，只来得及把这句话塞进缓存。备注建立于坠楼前七分钟，修改时间却显示为今晚；有人刚刚打开它，故意留给你看。</p>
                <p className="theaterShockLine">　　身后的戏服架忽然轻轻晃了一下。布料拖过地面，最里面那件戏服被一只苍白的手慢慢拨开。屏幕倒计时从十跳到九，又跳回十；提交键自行亮起。无论你留下安全、完整证据，还是二者之间那条更窄的路，都必须赶在那只手碰到椅背以前作出决定。</p>
              </>}
            </div>
            <div className="choiceList">
              {cutSongPage === 0 ? <>
                <button className="choiceButton" onClick={() => chooseCutSong({ theaterOriginalLyricCopied: true }, { clues: 5 }, "你复制了苏婉的完整原唱转写。")}>先复制1953年的完整唱词<em>苏婉证据 / 线索 +5</em></button>
                <button className="choiceButton" onClick={() => chooseCutSong({ theaterEditLogCopied: true }, { clues: 7 }, "你复制了陈九使用死亡账号剪接唱段的记录。")}>先复制剪接与登录记录<em>人为犯罪 / 线索 +7</em></button>
                <button className="choiceButton" onClick={() => chooseCutSong({ theaterTargetListCopied: true }, { affection: 3, sanity: -2 }, "你复制了林伟、白秋和张超的姓名轨。")}>先复制被写入的目标名单<em>白秋唤醒 / 好感度 +3 / 理智 -2</em></button>
              </> : <>
                <button className="choiceButton" onClick={() => chooseCutSong({ theaterCommandTrackCut: true }, { sanity: 4 }, "你删除了命令轨，戏服架后的脚步慢了半拍。")}>删除命令轨和姓名缓存<em>追逐更安全 / 理智 +4</em></button>
                <button className="choiceButton" onClick={() => chooseCutSong({ theaterTrackPreserved: true, theaterEvidenceBackedUp: true }, { clues: 5, sanity: -3 }, "你保留并上传完整轨道，设备继续呼叫名字。")}>保留完整轨道并上传<em>公开结局证据 / 线索 +5 / 理智 -3</em></button>
                <button className="choiceButton" onClick={() => chooseCutSong({ theaterTrackIsolated: true }, { clues: 3, sanity: 2 }, "猫头鹰羽毛把姓名轨固定在离线缓存中。")}>用猫头鹰羽毛隔离最后一轨<em>兼顾安全与证据</em></button>
              </>}
            </div>
          </div>
        </section>
      )}

      {modal === "blackout" && <div className="theaterBlackout" aria-hidden="true" />}

      {snapshot?.stage === "projection" && projectionIndex >= 0 && (
        <button className="theaterProjectionAdvance" type="button" onClick={advanceProjection} aria-label="继续播放下一格胶片">
          <p className="theaterProjectionCaption" key={projectionIndex}>{projectionCaptions[projectionIndex]}</p>
          <span>{projectionLoadState === "loading"
            ? "胶片读取中"
            : projectionLoadState === "error"
              ? "读取失败 · 点击重试"
              : `${Math.min(projectionIndex + 1, projectionImages.length)} / ${projectionImages.length}`}</span>
        </button>
      )}

      {modal === "finale" && finaleStage !== "finished" && finaleStage !== "epilogue" && (
        <section className="theaterNarrativeOverlay" onClick={finaleStage === "ending" ? advanceEnding : undefined}>
          <div className={`storyModal theaterStoryModal${ending ? " ending" : ""}`} role="dialog" aria-label="小剧场最终演绎">
            {finaleStage === "common" && <>
              <div className="storyKicker"><span>终章</span><b>舞台中央</b></div>
              <h1>最后一段没有被剪掉的戏</h1>
              <div className="storyText">
                <p>陈九站在放映机旁，终于说出早先供词里缺失的一段。他删掉苏婉唱词里的否定词，又把林伟、白秋和你的名字接进换气声里。林伟偷走R-1953后试过恢复原唱，所以陈九把他引到窗边，再让所有人相信那是一场意外。</p>
                <p>白秋抬头望着投影。过去几年，她一直看见苏婉守在门边，也一直怀疑那道影子会夺走自己的身体。今晚完整唱段响起，她终于看见苏婉每次都背对观众，用肩膀抵着舞台侧门。门后那团黑影撞一下，她的戏服便多裂开一道口子。</p>
                <p>诊疗摘要在银幕上一页页翻过。陈九把白秋说出的每个警告写进『发病记录』，又以治疗为名反复播放第三轨。等亲友都开始替她解释，姓名轨便有了最稳定的入口。控制台下方还压着下一份空白表格，患者姓名已经预填成了你。</p>
                <p className="theaterShockLine">白秋看着你，声音被倒带声割得断断续续：『你到这里以前，有没有替我答应他任何事？』总控台随即亮起确认键。苏婉在红幕前回过头，唱出今晚第一句没有被剪断的话：不要替任何人答应。</p>
              </div>
              <button className="choiceButton primary" onClick={() => setFinaleStage("wake")}>让最后一幕继续</button>
            </>}
            {finaleStage === "wake" && <>
              <div className="storyKicker"><span>最终抉择 · 一</span><b>先说出的那句话</b></div>
              <h1>先让谁从剧本里醒来</h1>
              <div className="storyText">
                <p>红光里，白秋倒在舞台总控旁，手指随着倒放的唱段轻轻抽动。苏婉站在投影烧焦的边缘，每当陈九念出一个名字，她的影子便被向后拖走一步。姓名轨下方的计数已经走到九十九，只差最后一次确认。</p>
                <p>你在控制台记录里看过这道程序：最后一轨必须取得活人的自愿确认。最先传进扬声器的声音，会决定白秋先听见雨夜约定、苏婉的完整警告，还是剧场外同伴发回的安全暗号。她若能借那句话认出自己，确认键便会失去作用。</p>
                <p>老照片上留着苏婉的姓名，上传记录连接着场外的人，白秋的旧消息则保存着你们约好的暗语。三件东西都摆在手边，可扬声器只给你一次开口的空隙。陈九已经把手伸向推杆，倒计时开始从五往下跳。</p>
                <p className="theaterShockLine">四。三。白秋的嘴唇动了一下。你必须让她先听见一句仍属于现实的话。</p>
              </div>
              <div className="choiceList">
                <button className="choiceButton" onClick={() => chooseWake("call")}>喊白秋的名字，复述雨夜的约定<em>关系唤醒</em></button>
                <button className="choiceButton" onClick={() => chooseWake("warning")}>举起老照片，念回完整警告<em>真相唤醒</em></button>
                <button className="choiceButton" onClick={() => chooseWake("signal")}>先把编辑记录和名单发给同伴<em>团队支援</em></button>
              </div>
            </>}
            {finaleStage === "action" && <>
              <div className="storyKicker"><span>最终抉择 · 二</span><b>谁来决定最后一幕</b></div>
              <h1>舞台总控仍在等待</h1>
              <div className="storyText">
                <p>白秋的眼神重新聚焦，陈九却把手压在总控台另一端。姓名轨、门锁与放映机接在同一条回路上。切断线路可以停住呼名，继续放映能够把证据送出去，主入口仍留着一条退路，舞台上的陈九也已经离你不到十步。</p>
                <p>一路带来的东西散落在座椅和地板上：胶片仍在转，照片背面的字被红光照得发亮，护身符留着灼痕，日记残页沾了雨水，猫头鹰羽毛压住最后一轨。你的理智、体力、线索与同伴的信任，会让某些选择真正做得到，也会让某些动作付出更重的代价。</p>
                <p>白秋扶着桌沿站起来。她没有催你救她，只把手停在断开键上，等你问清楚。场外耳机里传来张一诚断续的声音：『信号收到……我们在门外……别逞强。』陈九开始拖动推杆，苏婉的影子再次撞上侧门。</p>
                <p className="theaterShockLine">总控屏幕闪出最后一行红字：『本场演出没有指定主角。』倒计时只剩一秒，你们必须一起决定谁按下哪个按钮。</p>
              </div>
              <div className="choiceList">
                <button className="choiceButton" onClick={() => chooseAction("together")}>问白秋是否还能站起来；等她回答后，一起按下断开键</button>
                <button className="choiceButton" onClick={() => chooseAction("broadcast")}>让舞台继续放映，公开完整编辑包，等待支援</button>
                <button className="choiceButton" onClick={() => chooseAction("leave")}>关掉最近的扬声器，带白秋从主入口离开</button>
                <button className="choiceButton" onClick={() => chooseAction("force")}>不再等待，直接冲上舞台制伏陈九</button>
              </div>
            </>}
            {finaleStage === "ending" && ending && <>
              <div className="storyKicker"><span>结局</span><b>{ending.tone === "bad" ? "雨夜未尽" : "23:48"}</b></div>
              <h1>{ending.title}</h1>
              <div className="storyText">{ending.body.map((paragraph, index) => (
                <p key={paragraph} className={index === ending.body.length - 1 ? "theaterShockLine" : undefined}>
                  {renderTheaterText(paragraph)}
                </p>
              ))}</div>
              <p className="theaterContinue">3秒后点击任意位置或按任意键继续</p>
            </>}
          </div>
        </section>
      )}

      {modal === "finale" && finaleStage === "epilogue" && (
        <section className="theaterEpilogue" aria-label="尾声">
          <header>
            <span>尾声</span>
            <h1>当最后一场雨停下</h1>
          </header>
          <div className="theaterEpilogueViewport">
            <div
              className="theaterEpilogueRoll"
              onAnimationEnd={(event) => {
                if (event.currentTarget === event.target) finishEpilogue();
              }}
            >
              <div className="theaterEpilogueLeadSpace" aria-hidden="true" />
              {EPILOGUE.map((paragraph, index) => (
                <p
                  className={index === 3 || index === EPILOGUE.length - 1 ? "theaterShockLine" : undefined}
                  key={paragraph}
                >
                  {renderTheaterText(paragraph)}
                </p>
              ))}
              <strong>不要让任何人独自走到23:47</strong>
            </div>
          </div>
          <p className="theaterEpilogueSkip">文字将自动播放 · 结束后自动继续</p>
        </section>
      )}

      {finaleStage === "finished" && (
        <section className="theaterFinalTitle" aria-label="游戏结束">
          <h1>浙大夜惊魂</h1>
          <p>23:48　雨停了</p>
        </section>
      )}
    </>
  );
}
