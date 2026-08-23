/**
 * 多样化惊吓文字池 — 根据场景/理智/鬼距离上下文选择
 */

export type JumpscareContext =
  | "ghost_close"      // 鬼靠近
  | "ghost_caught"     // 鬼抓到玩家
  | "story_tense"      // 剧情紧张时刻
  | "story_reveal"     // 真相揭露
  | "story_death"      // 角色死亡
  | "low_sanity"       // 理智极低
  | "library"          // 图书馆场景
  | "library_receipt"  // 场景一：隔间借阅小票
  | "library_shelf"    // 场景一：书架突脸
  | "library_fall"     // 场景一：灯下坠落
  | "dorm"             // 宿舍场景
  | "medical"          // 医学院场景
  | "lake"             // 湖边场景
  | "theater"          // 小剧场场景
  | "random";          // 随机通用

const pool: Record<JumpscareContext, string[]> = {
  ghost_close: [
    "它就在身后",
    "别回头",
    "不要看",
    "它来了",
    "好近",
    "呼吸声……",
    "有人在看着你",
    "快跑",
  ],
  ghost_caught: [
    "抓到你了",
    "你逃不掉的",
    "结束了",
    "太晚了",
    "已经来不及了",
    "它碰到你了",
  ],
  story_tense: [
    "谁在那里？",
    "那是什么？",
    "不是幻觉",
    "它在看着你",
    "门开了",
    "有人吗",
    "不对……",
  ],
  story_reveal: [
    "原来是你",
    "一直在身边",
    "不是鬼",
    "骗局",
  ],
  story_death: [
    "林伟……",
    "不要跳",
    "砰——",
  ],
  low_sanity: [
    "他们都在说谎",
    "你不是真的",
    "墙壁在动",
    "我疯了",
    "这不是真的",
    "放我出去",
    "别再唱了",
    "镜子里……",
  ],
  library: [
    "书在动",
    "那本书打开了",
    "书架后面",
    "23:47",
    "借阅记录……",
  ],
  library_receipt: [
    "隔间里还有一个人",
    "打印机后面",
    "她一直坐在椅子上",
    "小票不是机器吐出来的",
    "不要看隔板上方",
    "纸声停在你背后",
    "23:47",
    "别碰那张票",
  ],
  library_shelf: [
    "书后有人",
    "她在缝里看你",
    "别把书抽出来",
    "戏唱的是你的名字",
    "红灯灭到你头顶了",
    "那不是书页",
    "她没有影子",
    "你惊动她了",
  ],
  library_fall: [
    "砰——",
    "灯下是谁",
    "林伟刚才还在这里",
    "她把他指给你看",
    "不要走进那束光",
    "地上多了一个人",
    "已经来不及了",
    "别看他的脸",
  ],
  dorm: [
    "门禁响了",
    "床下有人",
    "窗户外面",
    "灯灭了",
  ],
  medical: [
    "封条裂开了",
    "手术灯亮了",
    "解剖室",
    "地下二层",
    "他们还在里面",
  ],
  lake: [
    "水面有人在看",
    "湖边不要回头",
    "水里有人",
    "倒影不一样",
  ],
  theater: [
    "幕布在动",
    "空座位不是空的",
    "舞台灯亮了",
    "有人在鼓掌",
  ],
  random: [
    "别回头",
    "你听到了吗",
    "不是梦",
    "它在等你",
    "门没锁",
    "灯怎么灭了",
    "那是什么声音",
    "你确定是一个人吗",
    "窗外有人",
    "脚步声",
    "嘘……",
    "它在笑",
  ],
};

/** 根据上下文和理智选择惊吓文字 */
export function pickJumpscareText(
  context: JumpscareContext,
  sanity: number,
): string {
  // 低理智时混入 low_sanity 池
  const sources: string[][] = [pool[context] ?? pool.random];
  if (sanity <= 30) sources.push(pool.low_sanity);
  if (sanity <= 15) sources.push(pool.low_sanity); // 双重混入

  const merged = sources.flat();
  return merged[Math.floor(Math.random() * merged.length)];
}

/** 根据热点 ID 选择场景上下文 */
export function contextForHotspot(hotspotId: string): JumpscareContext {
  const map: Record<string, JumpscareContext> = {
    library: "library",
    dorm: "dorm",
    "medical-college": "medical",
    "du-office": "medical",
    lake: "lake",
    "east-teaching": "medical",
    theater: "theater",
    canteen: "random",
  };
  return map[hotspotId] ?? "random";
}

/** 获取文字对应的 CSS 变体 class */
export function textVariantClass(text: string): string {
  if (pool.low_sanity.includes(text)) return "variant-whisper";
  if (pool.ghost_caught.includes(text)) return "";
  if (pool.ghost_close.includes(text)) return "";
  return "";
}
