import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type UIEvent,
} from "react";
import { assetUrl } from "../assetPath";
import {
  playBaishaThunder,
  playBaishaWindowKnocks,
  primeBaishaWindowKnocks,
} from "../audio/proceduralAudio";
import { useGameStore } from "../store";
import type { BaishaGameplayPhase, BaishaGameplayTrigger, Interior3D } from "./Interior3D";

export type BaishaDormStage =
  | "photo_target"
  | "photo_intro"
  | "photo_normal"
  | "photo_flash_white"
  | "photo_flash_red"
  | "photo_corrupt"
  | "photo_ready"
  | "photo_dissolve"
  | "balcony_target"
  | "balcony_flash"
  | "balcony_wait"
  | "balcony_story"
  | "computer_target"
  | "forum"
  | "forum_ready"
  | "forum_alarm"
  | "forum_dissolve"
  | "complete";

interface BaishaDormExperienceProps {
  active: boolean;
  engineRef: MutableRefObject<Interior3D | null>;
  trigger: BaishaGameplayTrigger | null;
  onTriggerHandled: () => void;
  onStageChange?: (stage: BaishaDormStage) => void;
}

interface ForumReply {
  floor: string;
  user: string;
  time: string;
  body: string[];
}

interface BalconyChoice {
  text: string;
  effect: string;
  stats: Partial<Record<"sanity" | "clues", number>>;
  log: string;
}

const NORMAL_PHOTO = assetUrl("images/baisha/dorm-photo-normal-v1.png");
const CORRUPT_PHOTO = assetUrl("images/baisha/dorm-photo-corrupt-v1.png");
const BALCONY_SILHOUETTE = assetUrl("images/baisha/balcony-silhouette-v1.png");

const FORUM_REPLIES: ForumReply[] = [
  {
    floor: "楼主",
    user: "西区夜猫",
    time: "2006-10-17 23:58",
    body: [
      "先说明一下，我不是来编校园怪谈的。刚才白沙216的窗户被人敲了三下。第一下很轻，像指甲碰到玻璃；第二下隔了半秒；第三下就在窗户正中，整块玻璃都震了一下。我们这层外面没有树，窗也没开，隔壁的晾衣杆更伸不到这里。",
      "敲窗之前，寝室里的电脑自己从待机状态亮了。右下角时间停在23:47，拔掉插线板以后屏幕还是亮着。桌上那张启真湖合照也不太对：拍照时明明是六个人，我却怎么都数不清。只要视线挪开，就觉得中间还站着第七个。",
      "更奇怪的是玻璃外侧。三下敲完以后，多出三道从上往下的水痕，差不多和人的手指一样宽。我们住的不是一楼，外面也没有平台。室友让我别拉开窗帘，可帘子后面一直有人在很轻地叫我的名字，声音像从走廊传来，又像贴着玻璃。",
      "如果有人以前住过216，或者知道23:47是什么意思，请回一下。宿管电话始终占线。我们现在四个人都在寝室里，但刚刚门外也响起了室友刷卡回来的声音。",
    ],
  },
  {
    floor: "1楼",
    user: "cc98潜水员",
    time: "2006-10-18 00:03",
    body: [
      "先别自己吓自己。白沙这边夜里风大，窗框热胀冷缩会响。把门反锁，明早报修。",
      "不过电脑断电还亮就有点离谱。你确认不是显示器电容没放完？拍张照片发上来看看。",
    ],
  },
  {
    floor: "2楼",
    user: "求是小熊",
    time: "2006-10-18 00:07",
    body: [
      "216是靠走廊尽头那间吧？我去年住隔壁，半夜也听过敲玻璃，当时宿管说是水管。第二天外墙上没找到松动的东西。",
      "不要开门确认走廊里的声音。先给真实的室友打电话，别隔着门问是谁。",
    ],
  },
  {
    floor: "3楼",
    user: "老白沙",
    time: "2006-10-18 00:19",
    body: [
      "我01年住过那间。敲窗如果正好是三下，不要马上拉帘，也别回答叫名字的声音。先看电脑右下角，是不是23:47。",
      "那不是当前时间。那是以前住216的一个学生最后一次在校园网上登录的时间。后来学校换过门、刷过墙，电脑桌的位置却一直没动。",
    ],
  },
  {
    floor: "4楼",
    user: "西区夜猫",
    time: "2006-10-18 00:24",
    body: [
      "是23:47。你怎么会知道？而且我们刚才重新数了合照。照片里看起来还是六个人，可抱笔记本的那个人旁边有一道黑影，水里的倒影却有七个头。",
      "门外现在不叫名字了，改成有人用指甲划门。每划一下，电脑屏幕上的时间就往回跳一分钟。",
    ],
  },
  {
    floor: "5楼",
    user: "图情系匿名",
    time: "2006-10-18 00:31",
    body: [
      "查了一下旧缓存。医学分馆闭馆后也有人听见唱戏，时间同样停在23:47。管理员说馆里没有戏曲录音，但借阅终端在那个时间留下过一条不存在的归还记录。",
      "记录上的路线依次经过启真湖、医学分馆、医学院封条和小剧场。像是有人沿着旧路往回走。白沙可能只是这条路线上的一站。",
    ],
  },
  {
    floor: "6楼",
    user: "湖边别回头",
    time: "2006-10-18 00:36",
    body: [
      "启真湖、医学分馆、医学院封条、小剧场亮灯，本来就是同一条被新校区盖住的旧路。新楼改了方向，声音还沿原来的方向走。",
      "敲窗的东西不是想进来。它是在提醒里面的人，门外那个声音不是你的室友。真正想进来的东西只会敲门，不会敲窗。",
    ],
  },
  {
    floor: "7楼",
    user: "老白沙",
    time: "2006-10-18 00:42",
    body: [
      "当年216有个人听见室友在走廊喊名字，答应以后就失踪了。监控只拍到他自己开门，门外没人。第二天玻璃外侧有一串湿脚印，从窗沿一直走到墙上。",
      "他留下的纸条说：第一次打开的门通向走廊，第二次打开的门才通向白沙。没人知道这句话是什么意思。",
    ],
  },
  {
    floor: "8楼",
    user: "管理员",
    time: "2006-10-18 00:47",
    body: [
      "本帖包含未经证实内容，请勿继续传播。涉及宿舍安全问题请联系宿管，不要擅自前往封闭区域。",
      "楼主请确认寝室人数，关闭电脑，并立即离开窗边。不要上传照片。",
    ],
  },
  {
    floor: "9楼",
    user: "账号已注销",
    time: "2006-10-18 01:12",
    body: [
      "如果照片里有人被抹掉，去看那个人用过的电脑。缓存不会跟着人一起消失。不要点帖子里的附件，也别回答从身后传来的声音。",
      "读到这里以后先不要回头。看门缝下面——如果走廊有红光，说明它已经知道你在看这篇帖子。",
    ],
  },
  {
    floor: "10楼",
    user: "lw_216",
    time: "今天 23:47",
    body: [
      "门外那段走廊不是出口。她让我别回答名字。",
      "张超，如果你看到这一层，别相信第一次打开的门。",
    ],
  },
];

const BALCONY_CHOICES: BalconyChoice[] = [
  {
    text: "攥紧符纸，贴着墙避开玻璃退回寝室",
    effect: "理智 +2",
    stats: { sanity: 2 },
    log: "你攥紧发烫的符纸，避开阳台玻璃退回寝室。",
  },
  {
    text: "举起手电，记下水痕组成的“23:47”",
    effect: "理智 -2 / 线索 +3",
    stats: { sanity: -2, clues: 3 },
    log: "你强迫自己看清水痕，记下了反复出现的时间：23:47。",
  },
  {
    text: "隔着玻璃低声问：林伟，是你吗？",
    effect: "理智 -5 / 线索 +4",
    stats: { sanity: -5, clues: 4 },
    log: "你对玻璃外喊出林伟的名字；电脑随即自行亮起。",
  },
];

function gameplayPhase(stage: BaishaDormStage): BaishaGameplayPhase {
  if (stage === "photo_target") return "photo";
  if (stage === "balcony_target") return "balcony";
  if (stage === "computer_target") return "computer";
  return stage === "complete" ? "complete" : "paused";
}

function isModalStage(stage: BaishaDormStage): boolean {
  return !["photo_target", "balcony_target", "computer_target", "complete"].includes(stage);
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function BaishaDormExperience({
  active,
  engineRef,
  trigger,
  onTriggerHandled,
  onStageChange,
}: BaishaDormExperienceProps): React.ReactElement | null {
  const chaseOnly = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("baishaChaseOnly") === "1";
  const [stage, setStage] = useState<BaishaDormStage>(chaseOnly ? "complete" : "photo_target");
  const [photosReady, setPhotosReady] = useState(false);
  const forumBottomTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    Promise.all([NORMAL_PHOTO, CORRUPT_PHOTO, BALCONY_SILHOUETTE].map((src) => new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = src;
    }))).then(() => {
      if (!cancelled) setPhotosReady(true);
    });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const engine = engineRef.current;
    engine?.setBaishaGameplayPhase(gameplayPhase(stage));
    engine?.setGameplayPaused(isModalStage(stage));
    onStageChange?.(stage);
  }, [active, engineRef, onStageChange, stage]);

  useEffect(() => {
    if (!active || !trigger) return;
    if (trigger === "photo" && stage === "photo_target") setStage("photo_intro");
    if (trigger === "balcony" && stage === "balcony_target") setStage("balcony_flash");
    if (trigger === "computer" && stage === "computer_target") setStage("forum");
    onTriggerHandled();
  }, [active, onTriggerHandled, stage, trigger]);

  useEffect(() => {
    if (stage === "photo_normal") {
      const timer = window.setTimeout(() => {
        playBaishaThunder();
        setStage("photo_flash_white");
      }, 4000);
      return () => window.clearTimeout(timer);
    }
    if (stage === "photo_flash_white") {
      const timer = window.setTimeout(() => setStage("photo_flash_red"), 115);
      return () => window.clearTimeout(timer);
    }
    if (stage === "photo_flash_red") {
      const timer = window.setTimeout(() => setStage("photo_corrupt"), 105);
      return () => window.clearTimeout(timer);
    }
    if (stage === "photo_corrupt") {
      const timer = window.setTimeout(() => setStage("photo_ready"), 3000);
      return () => window.clearTimeout(timer);
    }
    if (stage === "photo_dissolve") {
      const timer = window.setTimeout(() => {
        playBaishaWindowKnocks();
        setStage("balcony_target");
      }, 1000);
      return () => window.clearTimeout(timer);
    }
    if (stage === "balcony_flash") {
      playBaishaThunder();
      const timer = window.setTimeout(() => setStage("balcony_wait"), 180);
      return () => window.clearTimeout(timer);
    }
    if (stage === "balcony_wait") {
      const timer = window.setTimeout(() => setStage("balcony_story"), 2000);
      return () => window.clearTimeout(timer);
    }
    if (stage === "forum_alarm") {
      const timer = window.setTimeout(() => setStage("forum_dissolve"), 1550);
      return () => window.clearTimeout(timer);
    }
    if (stage === "forum_dissolve") {
      const timer = window.setTimeout(() => {
        engineRef.current?.completeBaishaDorm();
        setStage("complete");
      }, 920);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [engineRef, stage]);

  const showNormalPhoto = useCallback(() => {
    if (stage === "photo_intro" && photosReady) setStage("photo_normal");
  }, [photosReady, stage]);

  const continuePhoto = useCallback(() => {
    if (stage === "photo_ready") {
      primeBaishaWindowKnocks();
      setStage("photo_dissolve");
    }
  }, [stage]);

  const chooseBalcony = useCallback((choice: BalconyChoice) => {
    const store = useGameStore.getState();
    store.setStoryState((previous) => ({
      ...previous,
      stats: {
        ...previous.stats,
        sanity: clampStat(previous.stats.sanity + (choice.stats.sanity ?? 0)),
        clues: clampStat(previous.stats.clues + (choice.stats.clues ?? 0)),
      },
      log: [choice.log, ...previous.log].slice(0, 6),
    }));
    setStage("computer_target");
  }, []);

  const continueForum = useCallback(() => {
    if (stage === "forum_ready") setStage("forum_alarm");
  }, [stage]);

  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (stage === "photo_intro") showNormalPhoto();
      else if (stage === "photo_ready") continuePhoto();
      else if (stage === "forum_ready") continueForum();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, continueForum, continuePhoto, showNormalPhoto, stage]);

  useEffect(() => () => {
    if (forumBottomTimer.current !== null) window.clearTimeout(forumBottomTimer.current);
  }, []);

  const handleForumScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (stage !== "forum") return;
    const panel = event.currentTarget;
    const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 18;
    if (!atBottom) {
      if (forumBottomTimer.current !== null) window.clearTimeout(forumBottomTimer.current);
      forumBottomTimer.current = null;
      return;
    }
    if (forumBottomTimer.current !== null) return;
    forumBottomTimer.current = window.setTimeout(() => {
      forumBottomTimer.current = null;
      setStage("forum_ready");
    }, 1000);
  }, [stage]);

  if (!active) return null;

  const photoVisible = [
    "photo_normal",
    "photo_flash_white",
    "photo_flash_red",
    "photo_corrupt",
    "photo_ready",
    "photo_dissolve",
  ].includes(stage);
  const corruptVisible = ["photo_flash_red", "photo_corrupt", "photo_ready", "photo_dissolve"].includes(stage);
  const forumVisible = ["forum", "forum_ready", "forum_alarm", "forum_dissolve"].includes(stage);

  return (
    <>
      {stage === "computer_target" && <div className="baishaComputerWash" aria-hidden="true" />}

      {stage === "photo_intro" && (
        <section className="baishaNarrativeOverlay" onClick={showNormalPhoto}>
          <div className="storyModal baishaNarrativeModal baishaNarrativeModal--untitled" role="dialog" aria-label="相框中的合照">
            <div className="storyText">
              {[
                "相框里是一张普通的校园合照。六名学生站在启真湖边，身后的教学楼被阴天压成一片灰蓝。照片已经有些年头，边角受潮卷起，每个人却都直直望着镜头，保持着几乎一模一样的笑容。",
                "你认出了站在中间、抱着笔记本的林伟。除此之外，似乎没有什么值得注意。可视线从照片上移开时，你总觉得背景里还有什么东西没有被数进去。",
              ].map((paragraph, index) => (
                <p key={paragraph} style={{ "--story-line-delay": `${180 + index * 260}ms` } as CSSProperties}>{paragraph}</p>
              ))}
            </div>
            <p className="baishaContinue">{photosReady ? "点击任意位置查看" : "照片正在显影……"}</p>
          </div>
        </section>
      )}

      {photoVisible && (
        <section
          className={`baishaExperience baishaExperience--photo${stage === "photo_dissolve" ? " is-dissolving" : ""}`}
          onClick={continuePhoto}
          aria-label={corruptVisible ? "发生异变的校园合照" : "校园合照"}
        >
          <img
            className="baishaPhoto"
            src={corruptVisible ? CORRUPT_PHOTO : NORMAL_PHOTO}
            alt={corruptVisible ? "林伟的位置变成鬼影，其余同学都失去了五官" : "六名学生在启真湖边的合照"}
          />
          {stage === "photo_ready" && <p className="baishaContinue baishaContinue--bottom">按任意键或点击任意位置继续</p>}
        </section>
      )}

      {stage === "photo_flash_white" && <div className="baishaFullFlash is-white" aria-hidden="true" />}
      {stage === "photo_flash_red" && <div className="baishaFullFlash is-red" aria-hidden="true" />}

      {stage === "balcony_flash" && (
        <div className="baishaBalconyFlash" aria-label="闪电中出现的人影">
          <div
            className="baishaBalconyShadow"
            style={{ "--baisha-balcony-shadow": `url("${BALCONY_SILHOUETTE}")` } as CSSProperties}
            aria-hidden="true"
          />
        </div>
      )}

      {stage === "balcony_story" && (
        <section className="baishaNarrativeOverlay">
          <div className="storyModal baishaNarrativeModal" role="dialog" aria-label="玻璃外的第三声">
            <div className="storyKicker"><span>第二章</span><b>白沙宿舍 / 阳台</b></div>
            <h1>玻璃外的第三声</h1>
            <div className="storyText">
              {[
                "第三下敲击停在玻璃正中，与你肩膀几乎同高。这里没有树枝，也没有任何人能站在窗外。闪电落下的一瞬，你看见栏杆外吊着一道人影：身体朝向寝室，脚尖却垂在半空，其中一只脚下像套着褪色的绣花鞋。",
                "惨白的电光把栏杆和窗框压成一张平面，一团狭长的暗影随之钉在玻璃中央。肩颈与湿透长发的轮廓被雨水揉得发虚，冷光从它肋下与手臂之间漏过。那道人影一动不动，可窗外狭窄的平台根本站不下一个人。",
                "白光熄灭后，栏杆上什么也没有。玻璃外侧只剩三道缓慢向下滑落的水痕，而最靠近你的那一道竟停在半途，像一根手指隔着玻璃抵住了它。你下意识回头，室内四把椅子都在原位，地面的倒影里却多出第五道细长的人影。再眨眼时，它已经不见了。",
                "贴身收好的符纸骤然发热，焦黑的边缘渗出一点潮气。走廊深处同时传来半句模糊的戏腔，与医学院书架后听见的调子一模一样，却在唱到林伟名字之前突然断掉。紧接着，寝室里响起老式显示器通电时的轻鸣。",
                "靠门左侧的电脑自行亮起，猩红的屏幕光从床架缝隙间照到地面。屏幕没有显示桌面，只有一道光标在黑底上反复闪动。玻璃上的三道水痕继续下落，最后连成模糊的“23:47”——正是借阅小票上那条异常记录的时间。",
                "如果林伟在出事前也看见过这道人影，他很可能曾在这台电脑上留下求助。可白秋说过，白沙给出的第一条路未必通向出口。眼前自行亮起的屏幕究竟是线索，还是某个东西在等你回应，现在还无法确定。",
              ].map((paragraph, index) => (
                <p key={paragraph} style={{ "--story-line-delay": `${180 + index * 260}ms` } as CSSProperties}>{paragraph}</p>
              ))}
            </div>
            <div className="choiceList" style={{ "--choice-list-delay": "1080ms" } as CSSProperties}>
              {BALCONY_CHOICES.map((choice, index) => (
                <button
                  className="choiceButton"
                  key={choice.text}
                  style={{ "--choice-delay": `${index * 100}ms` } as CSSProperties}
                  type="button"
                  onClick={() => chooseBalcony(choice)}
                >
                  <span>{choice.text}</span>
                  <em>{choice.effect}</em>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {forumVisible && (
        <section
          className={`baishaForumShell${stage === "forum_alarm" ? " is-alarm" : ""}${stage === "forum_dissolve" ? " is-dissolving" : ""}`}
          aria-label="校园论坛缓存页面"
          onClick={stage === "forum_ready" ? continueForum : undefined}
        >
          <div className="baishaForumBrowser">
            <div className="baishaForumChrome">
              <span className="baishaForumBrand">ZJU 校园网</span>
              <span className="baishaForumAddress">http://bbs.zju.edu.cn/archive/baisha/216/8741</span>
              <span className="baishaForumOffline">离线缓存</span>
            </div>
            <div className="baishaForumPage" onScroll={handleForumScroll}>
              <header className="baishaForumHeader">
                <p>紫金港生活区 &gt; 白沙宿舍 &gt; 夜话</p>
                <h1>白沙 216 半夜有人敲窗，真不是恶作剧</h1>
                <small>本页最后缓存于 2008-03-10 23:47　只读模式</small>
              </header>
              {FORUM_REPLIES.map((reply) => {
                const alarmReply = stage === "forum_alarm" && reply.floor === "10楼";
                return (
                  <article className={`baishaForumReply${alarmReply ? " is-alarm" : ""}`} key={`${reply.floor}-${reply.time}`}>
                    <aside>
                      <strong>{reply.floor}</strong>
                      <span>{reply.user}</span>
                    </aside>
                    <div>
                      <time>{reply.time}</time>
                      {alarmReply
                        ? <p className="baishaForumEscape">快逃！</p>
                        : reply.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                    </div>
                  </article>
                );
              })}
              <div className="baishaForumEnd"><span>— 缓存到此中断 —</span></div>
            </div>
          </div>
          {stage === "forum_ready" && (
            <button type="button" className="baishaForumContinue" onClick={continueForum}>
              按任意键或点击任意位置退出
            </button>
          )}
        </section>
      )}
    </>
  );
}
