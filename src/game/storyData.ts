export type StatKey = "sanity" | "stamina" | "clues" | "trust";

export type ItemId = "talisman" | "flashlight" | "key_card" | "medicine" | "diary" | "photograph" | "cat_hair" | "energy";

export type HotspotId =
  | "library"
  | "dorm"
  | "canteen"
  | "du-office"
  | "medical-college"
  | "east-teaching"
  | "lake"
  | "theater";

export type StorySceneId =
  | "library_intro"
  | "library_sound"
  | "library_police"
  | "dorm_baiqiu"
  | "dorm_forum"
  | "find_yicheng"
  | "yicheng_reveal"
  | "find_du"
  | "ask_about_org"
  | "medical_entry"
  | "teaching_back"
  | "ghost_choice"
  | "stand_ground"
  | "report_findings"
  | "reveal_villain"
  | "final_plan"
  | "final_confrontation"
  | "ending_good"
  | "ending_sacrifice"
  | "ending_mercy"
  | "ending_escape"
  | "ending_nightmare"
  | "death_sanity";

export type HorrorEffect = "whisper" | "shake" | "jumpscare" | "reveal" | "ending";

export interface StoryStats {
  sanity: number;
  stamina: number;
  clues: number;
  trust: number;
}

export interface StoryState {
  currentSceneId: StorySceneId;
  stats: StoryStats;
  inventory: ItemId[];
  flags: Record<string, boolean>;
  visitedHotspots: HotspotId[];
  completedHotspots: HotspotId[];
  log: string[];
}

export interface StoryChoice {
  id: string;
  text: string;
  next: StorySceneId;
  statChanges?: Partial<StoryStats>;
  gainItem?: ItemId;
  gainItems?: ItemId[];
  requireItem?: ItemId;
  requireFlag?: string;
  setFlag?: string;
  effect?: HorrorEffect;
}

export interface StoryScene {
  id: StorySceneId;
  title: string;
  chapter: string;
  locationId: HotspotId;
  body: string[];
  choices: StoryChoice[];
  effect?: HorrorEffect;
  ending?: "good" | "bad" | "true" | "escape" | "death";
}

export interface StoryHotspot {
  id: HotspotId;
  title: string;
  place: string;
  objective: string;
  sceneId: StorySceneId;
  x: number;
  y: number;
  radius: number;
  order: number;
}

export const itemCatalog: Record<ItemId, { name: string; icon: string; desc: string }> = {
  talisman: { name: "护身符", icon: "符", desc: "旧黄符纸。第一次承受强烈理智伤害时会自动抵挡。" },
  flashlight: { name: "手电筒", icon: "光", desc: "施工队遗落的小手电。黑暗区域调查时降低恐惧。" },
  key_card: { name: "门禁卡", icon: "卡", desc: "张一诚给你的医学院地下仓库通用卡。" },
  medicine: { name: "镇定药", icon: "药", desc: "杜学民给的白色药瓶。服用后恢复 20 点理智。" },
  diary: { name: "日记残页", icon: "页", desc: "论坛附件里的扫描页，记录了千绳会的旧案。" },
  photograph: { name: "老照片", icon: "照", desc: "苏婉在旧教学楼前的照片。背面写着 1953。" },
  cat_hair: { name: "黑猫毛发", icon: "毛", desc: "能感知阵法里不自然的冷点。" },
  energy: { name: "能量饮料", icon: "饮", desc: "罐装咖啡。恢复 30 点体力。" },
};

export const initialStoryState: StoryState = {
  currentSceneId: "library_intro",
  stats: { sanity: 100, stamina: 100, clues: 0, trust: 50 },
  inventory: [],
  flags: {},
  visitedHotspots: [],
  completedHotspots: [],
  log: ["00:47，紫金港的路灯还亮着。先去基础图书馆确认闭馆记录。"],
};

export const storyHotspots: StoryHotspot[] = [
  {
    id: "library",
    title: "闭馆记录",
    place: "基础图书馆",
    objective: "核对最后一条借阅记录",
    sceneId: "library_intro",
    x: 32.0,
    y: 15.9,
    radius: 1.9,
    order: 1,
  },
  {
    id: "dorm",
    title: "白秋的警告",
    place: "白沙宿舍区",
    objective: "回宿舍整理线索，等待白秋出现",
    sceneId: "dorm_baiqiu",
    x: 7.2,
    y: 8.1,
    radius: 1.8,
    order: 2,
  },
  {
    id: "canteen",
    title: "张一诚",
    place: "临湖餐厅",
    objective: "找张一诚问清医学院传闻",
    sceneId: "find_yicheng",
    x: 12.0,
    y: 14.5,
    radius: 1.7,
    order: 3,
  },
  {
    id: "du-office",
    title: "杜学民办公室",
    place: "图书馆医学分馆",
    objective: "向杜学民核验日记和老照片",
    sceneId: "find_du",
    x: 18.5,
    y: 30.0,
    radius: 1.8,
    order: 4,
  },
  {
    id: "medical-college",
    title: "医学院入口",
    place: "医学院",
    objective: "进入医学院调查地下仓库",
    sceneId: "medical_entry",
    x: 12.5,
    y: 30.0,
    radius: 1.8,
    order: 5,
  },
  {
    id: "east-teaching",
    title: "旧教学楼后门",
    place: "东教学区",
    objective: "绕到教学楼后面，寻找施工队留下的东西",
    sceneId: "teaching_back",
    x: 30.2,
    y: 20.8,
    radius: 1.9,
    order: 6,
  },
  {
    id: "lake",
    title: "启真湖回声",
    place: "启真湖",
    objective: "在湖边拼合门禁日志与论坛坐标",
    sceneId: "report_findings",
    x: 19.0,
    y: 22.5,
    radius: 2.0,
    order: 7,
  },
  {
    id: "theater",
    title: "小剧场祭台",
    place: "小剧场",
    objective: "阻止陈九完成仪式",
    sceneId: "final_plan",
    x: 12.0,
    y: 11.8,
    radius: 1.9,
    order: 8,
  },
];

export const storyScenes: Record<StorySceneId, StoryScene> = {
  library_intro: {
    id: "library_intro",
    title: "图书馆闭馆前",
    chapter: "第一章",
    locationId: "library",
    body: [
      "基础图书馆的借阅机还亮着。屏幕右下角停在 23:47，最后一条记录的备注只有一句：湖边不要回头。",
      "走廊深处传来很轻的歌声。林伟的表情突然变得僵硬，像是听见有人贴着耳朵喊他的名字。",
      "你们原本只是来查一个旧帖子里提到的闭馆时间。帖子说，每年总有一晚，图书馆会在系统里多出一条不存在的借阅记录，借阅人姓名为空，归还地点却写着医学院地下仓库。",
      "林伟笑着说这像学长学姐编出来吓新生的故事。可是当借阅机吐出那张热乎乎的小票时，他没有再笑。小票背面有一行被热敏纸烫出来的浅字：不要让白秋靠近小剧场。",
      "窗外的紫金港安静得过分。远处湖面没有风，却有一圈圈波纹，像有人正在水下慢慢敲玻璃。",
    ],
    choices: [
      {
        id: "listen",
        text: "仔细听听歌声从哪里来",
        next: "library_sound",
        statChanges: { sanity: -2, stamina: -1, clues: 4 },
        effect: "whisper",
      },
      {
        id: "leave",
        text: "提议现在就离开图书馆",
        next: "library_police",
        statChanges: { sanity: -4, stamina: -3, clues: 2 },
        effect: "shake",
      },
    ],
  },
  library_sound: {
    id: "library_sound",
    title: "没有影子的脚步",
    chapter: "第一章",
    locationId: "library",
    body: [
      "你们顺着歌声往楼梯间走。声控灯一盏盏亮起，又一盏盏熄灭，像有人在前面替你们开路。",
      "林伟突然冲向栏杆。你只来得及看见一双不属于他的脚，悬在二楼转角的黑暗里。",
      "歌声不是从某个房间里传出来的，而是在楼梯间上上下下移动。它贴着墙壁，绕过消防栓，又从你背后的书架缝隙里钻出来。每个音都很轻，却准确踩在你的心跳之间。",
      "林伟说他看见了一个穿戏服的女人。她站在楼梯上，袖口湿漉漉的，像刚从湖里爬出来。你什么都没看见，只看见林伟一步一步往前走，眼睛空得像一面没有反光的镜子。",
      "声控灯最后一次亮起时，你终于看清了栏杆外侧的东西：不是女人，也不是影子，而是一双脚。脚尖朝下，悬在半空，鞋底沾着启真湖边的黑泥。",
    ],
    effect: "jumpscare",
    choices: [
      {
        id: "chase",
        text: "冲下楼查看林伟的情况",
        next: "library_police",
        statChanges: { sanity: -8, stamina: -5, clues: 6 },
        setFlag: "investigatedLin",
        effect: "jumpscare",
      },
      {
        id: "retreat",
        text: "先回宿舍，别让自己也失控",
        next: "dorm_baiqiu",
        statChanges: { sanity: -3, stamina: -2 },
      },
    ],
  },
  library_police: {
    id: "library_police",
    title: "警车的远光灯",
    chapter: "第一章",
    locationId: "library",
    body: [
      "警察问了很多遍：你最后看见林伟时，他有没有说什么？",
      "你想起闭馆记录、歌声、还有那双脚。未知的东西正在把校园地图一点点擦黑。",
      "救护车的灯把图书馆门口照得一片蓝白。有人说林伟只是低血糖摔下楼，也有人说他自己翻过了栏杆。你知道都不是。因为他倒下前，手机屏幕还停留在那篇旧帖子上。",
      "帖子下面有一条十年前的匿名回复：如果有人开始听见歌声，就别让他独自回宿舍。回复时间同样是 23:47。",
      "你把这条回复截图保存时，手机震了一下。一个陌生号码发来短信：回白沙宿舍。白秋知道下一段。",
    ],
    choices: [
      {
        id: "ask",
        text: "问警察那双脚是怎么回事",
        next: "dorm_baiqiu",
        statChanges: { sanity: -2, clues: 5 },
      },
      {
        id: "silent",
        text: "保持沉默，回宿舍等白秋",
        next: "dorm_baiqiu",
        statChanges: { trust: 4 },
      },
    ],
  },
  dorm_baiqiu: {
    id: "dorm_baiqiu",
    title: "白秋的警告",
    chapter: "第二章",
    locationId: "dorm",
    body: [
      "白秋站在宿舍楼下，雨水顺着她的伞骨往下滴。她第一句话是：不要再查图书馆，也不要去医学院。",
      "她递给你一枚发旧的黄符，说这是她家里老人留下的东西。",
      "白沙宿舍区平时总是有人骑车、取外卖、打电话，可今晚所有窗户都像被同一只手按灭了灯。白秋的影子落在地上，被路灯拉得很长，长到几乎碰到你脚边。",
      "她说林伟不是第一个。上一届、再上一届，都有人在紫金港夜里听见歌声。有人醒来发现自己站在启真湖边，有人第二天忘记了整整一晚，还有人从此再也不肯经过医学院。",
      "你问她为什么知道这些。她沉默很久，只说自己小时候听过同一首歌。那时她还不在浙大，但家里人已经知道，紫金港有些路不是给活人走的。",
      "黄符边缘已经发黑，像被火燎过。你握住它时，掌心有一瞬间发烫，耳边的雨声也突然变得很远。",
    ],
    choices: [
      {
        id: "promise",
        text: "认真答应她，但保留所有疑问",
        next: "dorm_forum",
        statChanges: { sanity: 3, trust: 15, clues: 3 },
        gainItem: "talisman",
      },
      {
        id: "press",
        text: "追问她为什么这么害怕医学院",
        next: "dorm_forum",
        statChanges: { sanity: -4, trust: 5, clues: 8 },
        gainItem: "talisman",
        effect: "whisper",
      },
    ],
  },
  dorm_forum: {
    id: "dorm_forum",
    title: "论坛旧帖",
    chapter: "第二章",
    locationId: "dorm",
    body: [
      "宿舍电脑上的旧论坛还留着缓存。标题是：浙大夜惊魂，学长学姐们代代相传。",
      "附件里有一张扫描日记残页，字迹潦草：千绳会、苏婉、1953、医学院地下仓库。",
      "帖子最早发布于很多年前，楼主说自己只是整理校园传说：图书馆歌声、医学院封条、启真湖倒影、小剧场半夜亮灯。可越往下翻，传说越不像传说，更像一份被拆散的事故报告。",
      "有人提到一个名字：苏婉。她曾经是民国时期的戏曲名角，后来在浙江医学院附近离奇死亡。还有人说，她不是害人的鬼，而是在阻止另一个东西从地下出来。",
      "日记残页的最后一行被水泡开了，只剩半句话：他们不是在祭她，他们是在借她的名义继续……",
      "你把图片放大，发现纸边有一个坐标标记。坐标落在临湖餐厅附近，旁边写着张一诚的名字。",
    ],
    choices: [
      {
        id: "download",
        text: "保存日记残页，去找张一诚",
        next: "find_yicheng",
        statChanges: { sanity: -4, clues: 8, stamina: -2 },
        gainItem: "diary",
        setFlag: "readForum",
      },
      {
        id: "rest",
        text: "先休息十分钟，再去临湖餐厅",
        next: "find_yicheng",
        statChanges: { sanity: 8, stamina: 12 },
        gainItem: "energy",
      },
    ],
  },
  find_yicheng: {
    id: "find_yicheng",
    title: "张一诚知道得太多",
    chapter: "第三章",
    locationId: "canteen",
    body: [
      "临湖餐厅早已打烊，张一诚坐在门口台阶上，手里攥着一张没刷开的门禁卡。",
      "他承认林伟不是第一个出事的人。医学院地下以前封过一间仓库，封条每年都会自己裂开。",
      "你找到他时，他像是已经等了很久。餐厅玻璃门上映出你们两个人的影子，可中间还多出一道很细的黑影，站在你们身后，不动，也不说话。",
      "张一诚说，他大一时也看过那篇帖子。起初只是好奇，后来他发现论坛里提到的几个人，毕业去向全都查不到。不是失踪，而像是从学校记录里被完整擦掉。",
      "他说白秋身上有某种他们想要的东西。千绳会每隔几年就会找一个“听得见歌声的人”，用恐惧把人引到小剧场，再借医学院旧仓库里的东西完成仪式。",
      "你问他为什么现在才说。他低头看着门禁卡，说：因为林伟出事那晚，我本来应该和他一起去图书馆。",
    ],
    choices: [
      {
        id: "silent",
        text: "沉默，让他继续说",
        next: "yicheng_reveal",
        statChanges: { sanity: -2, trust: 10, clues: 6 },
        setFlag: "yichengTrustsYou",
      },
      {
        id: "question",
        text: "质问他为什么现在才说",
        next: "yicheng_reveal",
        statChanges: { sanity: -5, trust: -8, clues: 5 },
      },
    ],
  },
  yicheng_reveal: {
    id: "yicheng_reveal",
    title: "侧门钥匙",
    chapter: "第三章",
    locationId: "canteen",
    body: [
      "张一诚把门禁卡塞到你手里：如果你非要查，就别从正门进去。",
      "卡面有一道深深的划痕，像被指甲反复抠过。你决定去找杜学民核对旧案。",
      "这张卡不是学生卡，背面没有姓名，只有一串被磨花的编号。张一诚说它能打开医学院地下仓库的侧门，但最好只用一次，因为门禁系统会记录最后一个刷卡人。",
      "他说完这句话后，餐厅里面突然传来托盘落地的声音。你们同时回头，玻璃门后空无一人，只有自动售货机的灯亮了一下，又灭了。",
      "张一诚压低声音说：去医学分馆找杜学民。他以前查过这件事，后来突然停手。不是因为他不信，是因为他差点查到自己身上。",
    ],
    choices: [
      {
        id: "take-card",
        text: "收下门禁卡，去医学分馆",
        next: "find_du",
        statChanges: { clues: 5, stamina: -3 },
        gainItem: "key_card",
      },
    ],
  },
  find_du: {
    id: "find_du",
    title: "杜学民的旧档案",
    chapter: "第四章",
    locationId: "du-office",
    body: [
      "杜学民看见日记残页后脸色变了。他说这是他师兄的笔迹，师兄当年也在追查千绳会。",
      "他从抽屉里拿出一瓶镇定药，又把医学分馆的旧档案摊在桌上。",
      "医学分馆的灯比图书馆更冷。书架之间有股消毒水和旧纸混在一起的味道，让人想起医院走廊。杜学民办公室门口贴着一张褪色的课程表，上面还有“人体解剖学”的残字。",
      "他没有问你从哪里拿到日记，只是把窗帘拉上。窗外的湖面被挡住后，办公室里反而更暗了。",
      "档案里夹着几张老照片：旧医学院、小剧场临时停尸间、一个穿戏服的女人，还有一群没有正脸的学生。每张照片背后都写着同一个年份：1953。",
      "杜学民说，他师兄最后一次出现，也是在 23:47。监控拍到他走进医学院地下二层，之后画面里只剩一根慢慢晃动的绳子。",
    ],
    choices: [
      {
        id: "org",
        text: "追问千绳会到底是什么",
        next: "ask_about_org",
        statChanges: { sanity: -3, clues: 10 },
        gainItem: "medicine",
      },
      {
        id: "go",
        text: "带上药，立刻去医学院",
        next: "medical_entry",
        statChanges: { stamina: -4, trust: 8 },
        gainItem: "medicine",
      },
    ],
  },
  ask_about_org: {
    id: "ask_about_org",
    title: "千绳会",
    chapter: "第四章",
    locationId: "du-office",
    body: [
      "杜学民说，千绳会不是社团，而是一套献祭关系。每个人都以为自己只是旁观者，直到绳子收紧。",
      "真正危险的地方不是医学院正门，而是旧教学楼后门，那里能通向地下仓库的另一侧。",
      "所谓千绳会，最早只是旧医学院里几个学生的秘密组织。他们相信恐惧可以被传递、被储存，甚至被用来换取某种“不死”的延续。",
      "苏婉死后，关于她的传说被他们反复改写：有人说她索命，有人说她唱歌引人跳楼，有人说她藏在启真湖底。越多人害怕她，她越像真的恶鬼，而真正的人反而躲在传说后面。",
      "杜学民把地图推到你面前，用红笔连出几个点：图书馆、白沙宿舍、临湖餐厅、医学分馆、旧教学楼、小剧场。线连成一个不规则的结，像绳结，也像一个被拉紧的圈套。",
      "如果白秋已经被选中，最后地点一定是小剧场。但在那之前，你必须去医学院确认地下仓库的封条是否还在。",
    ],
    choices: [
      {
        id: "investigate",
        text: "去医学院入口确认封条",
        next: "medical_entry",
        statChanges: { sanity: -2, stamina: -4, clues: 5 },
      },
    ],
  },
  medical_entry: {
    id: "medical_entry",
    title: "医学院封条",
    chapter: "第五章",
    locationId: "medical-college",
    body: [
      "医学院门口没有保安，只有一张被雨水泡皱的施工告示。玻璃门里，电梯数字停在 B2。",
      "你看见封条边缘有新鲜裂口。像有人刚从里面出来。",
      "医学院的外墙在夜色里像一块潮湿的骨头。你走近时，门口感应灯没有亮，反而是楼里的电梯按钮亮了一下。",
      "施工告示写着“地下空间维护，禁止进入”，落款日期却是三年前。封条上盖着学校保卫处的章，但印泥颜色很新，像刚刚补贴上去。",
      "你把耳朵贴近玻璃门，听见里面有轮子滚动的声音。那声音很慢，像有人推着旧病床，从走廊尽头一寸一寸经过。",
      "手机地图在这里开始失灵。所有道路都被重新规划到小剧场，但导航路线中间强行绕过了旧教学楼后门。",
    ],
    choices: [
      {
        id: "front",
        text: "从正门进入教学楼",
        next: "ghost_choice",
        statChanges: { sanity: -6, stamina: -5, clues: 5 },
        effect: "shake",
      },
      {
        id: "side",
        text: "用门禁卡从侧门绕到后门",
        next: "teaching_back",
        requireItem: "key_card",
        statChanges: { sanity: 2, stamina: -3, clues: 6 },
      },
      {
        id: "back",
        text: "绕到旧教学楼后面查看",
        next: "teaching_back",
        statChanges: { sanity: -3, stamina: -5, clues: 8 },
      },
    ],
  },
  teaching_back: {
    id: "teaching_back",
    title: "后门与黑猫",
    chapter: "第五章",
    locationId: "east-teaching",
    body: [
      "后门堆着施工木板。你在地上捡到一支小手电，旁边有一撮黑猫毛发，像是被什么东西硬生生扯下来的。",
      "楼里传来一声很轻的叹息。你意识到自己已经不只是调查者了。",
      "旧教学楼后门没有锁，门缝里塞着一张折过很多次的纸。纸上画着一个舞台，舞台中央是一把椅子，椅背后面绕着密密麻麻的绳子。",
      "手电筒还有电。光束扫过墙面时，你看见一排很浅的抓痕，从地面一直延伸到门框上方。那不是人手能抓出来的高度。",
      "黑猫毛发沾着一点干掉的血。你想起论坛里有人说，黑猫能看见不干净的东西，所以旧医学院附近从来养不活猫。",
      "楼道尽头传来拖拽声，像有人把沉重的木椅拖过水泥地。你举起手电，光圈里却什么都没有，只有一行新写上去的粉笔字：她不是凶手。",
    ],
    choices: [
      {
        id: "take",
        text: "拿起手电和黑猫毛发，继续深入",
        next: "ghost_choice",
        statChanges: { sanity: -4, clues: 10, stamina: -3 },
        gainItems: ["flashlight", "cat_hair"],
        setFlag: "foundCatKiller",
        effect: "reveal",
      },
    ],
  },
  ghost_choice: {
    id: "ghost_choice",
    title: "走廊尽头的女人",
    chapter: "第五章",
    locationId: "east-teaching",
    body: [
      "手电照到走廊尽头，一个穿旧戏服的女人站在那里。她没有影子，脚边却有水迹，一直延伸到启真湖的方向。",
      "她没有攻击你，只是抬手指向小剧场。",
      "你以为自己会尖叫，但喉咙像被冰水灌满。女人的脸很模糊，不是看不清，而是你的眼睛拒绝把她拼成一个完整的人。",
      "她的袖口还在滴水。每一滴落在地上，都会短暂映出一张不同的脸：林伟、白秋、张一诚、杜学民，还有一些你从未见过的学生。",
      "她开口时没有声音，只有手机屏幕自动亮起。备忘录里多出一句话：不是我在唱，是他们让我唱。",
      "你终于明白，所谓歌声不是索命，而是警告。只是听见它的人，往往已经站在陷阱边缘。",
    ],
    effect: "jumpscare",
    choices: [
      {
        id: "ask",
        text: "出声问她是谁",
        next: "stand_ground",
        statChanges: { sanity: -6, clues: 8 },
        effect: "whisper",
      },
      {
        id: "cat",
        text: "用黑猫毛发感知她指向的位置",
        next: "stand_ground",
        requireItem: "cat_hair",
        statChanges: { sanity: -2, clues: 12 },
      },
      {
        id: "run",
        text: "转身就跑，去湖边整理线索",
        next: "report_findings",
        statChanges: { sanity: -4, stamina: -8, clues: 4 },
        effect: "shake",
      },
    ],
  },
  stand_ground: {
    id: "stand_ground",
    title: "苏婉的照片",
    chapter: "第五章",
    locationId: "east-teaching",
    body: [
      "女人消失后，地上多了一张泛黄的老照片。照片背面写着：苏婉，1953 年摄于浙江医学院。",
      "这张照片让杜学民的档案、论坛日记、门禁记录终于连成一条线。",
      "照片里的苏婉站在旧教学楼前，身后是临时搭起的舞台。她没有笑，眼睛看向镜头外，好像那里站着一个她真正害怕的人。",
      "你翻到背面，除了姓名和年份，还有一行很淡的铅笔字：若我不能出去，就让他们也不能出去。",
      "楼道里的拖拽声停止了。远处传来舞台幕布被拉开的声音，很轻，却足够让你确定方向。",
      "小剧场不是下一处线索，而是所有线索被绑在一起的地方。在去那里之前，你需要到启真湖边把坐标重新拼起来。",
    ],
    choices: [
      {
        id: "photo",
        text: "收起照片，去湖边拼合所有坐标",
        next: "report_findings",
        statChanges: { sanity: -3, clues: 12 },
        gainItem: "photograph",
      },
    ],
  },
  report_findings: {
    id: "report_findings",
    title: "启真湖回声",
    chapter: "第六章",
    locationId: "lake",
    body: [
      "启真湖的水面映不出你的脸，只映出小剧场的舞台灯。",
      "你把门禁日志、日记残页、老照片和论坛坐标叠在一起，发现所有线都指向一个名字：陈九。",
      "湖边没有风，树叶却一阵阵翻动。每当你低头看手机，屏幕里都会出现一个不是你输入的坐标，然后又立刻消失。",
      "你把所有材料按时间顺序排开：1953 年苏婉死亡，旧医学院地下仓库封存；多年后校园传说开始流传；近几年，每当有人试图查证，都会在图书馆或湖边出事。",
      "真正可怕的不是鬼，而是有人持续利用鬼的名字。他把所有恐惧都推给苏婉，把所有受害者都变成传说的一部分。",
      "水面突然亮了一下。你看见倒影里的小剧场大门敞开，白秋坐在舞台中央，椅背后有一圈圈绳子正在收紧。",
    ],
    choices: [
      {
        id: "reveal",
        text: "听杜学民说出陈九的身份",
        next: "reveal_villain",
        statChanges: { sanity: -4, trust: -5, clues: 10 },
        effect: "reveal",
      },
    ],
  },
  reveal_villain: {
    id: "reveal_villain",
    title: "幕后人",
    chapter: "第六章",
    locationId: "lake",
    body: [
      "陈九不是鬼。他是最熟悉这套校园传说的人，也是最擅长把恐惧伪装成传说的人。",
      "白秋被带去了小剧场。那里曾经临时安置过旧医学院的尸检课桌。",
      "杜学民的声音从电话里传来，压得很低。他说陈九的祖辈和旧医学院有关系，后来一直以校友、赞助人、档案整理者的身份出入学校。",
      "他知道哪些灯会坏，哪些摄像头拍不到，哪些学生会把恐怖故事当成玩笑。他不用真的制造鬼，只要让每个人在最害怕的时候相信鬼存在。",
      "但苏婉的照片是他没算到的东西。照片能证明她不是加害者，而是第一个试图阻止仪式的人。",
      "电话最后传来一阵杂音。杜学民只来得及说一句：别单独和他谈判，除非你已经准备好让所有证据同时出现。",
    ],
    choices: [
      {
        id: "plan",
        text: "制定计划，去小剧场反击",
        next: "final_plan",
        statChanges: { sanity: -2, stamina: -3, clues: 5 },
      },
    ],
  },
  final_plan: {
    id: "final_plan",
    title: "小剧场灯灭",
    chapter: "终章",
    locationId: "theater",
    body: [
      "小剧场的舞台灯一盏盏熄灭，只剩中心一束白光。白秋被绑在旧木椅上，陈九站在她身后。",
      "如果你掌握的线索足够多，这里不是恐怖故事的结尾，而是骗局崩塌的现场。",
      "观众席空无一人，但每个座位上都放着一根红绳。绳头垂到地面，像一条条细长的血线，最终汇向舞台中央。",
      "陈九看见你并不意外。他甚至笑了笑，说每一代都会有一个自以为能解开谜题的人。有人带着勇气来，有人带着证据来，最后都只会留下一个更好听的校园传说。",
      "白秋抬头看你，眼睛里有恐惧，也有一点微弱的信任。你突然意识到，旧版帖子里所有选择都不是为了找到鬼，而是为了判断你在恐惧中还会不会相信活人。",
      "舞台边缘的幕布自己晃了一下。你握紧照片、门禁卡和所有线索，知道最后一步不能再靠运气。",
    ],
    choices: [
      {
        id: "talk",
        text: "先和陈九对话，拖延时间",
        next: "final_confrontation",
        statChanges: { clues: 5, trust: 5 },
      },
      {
        id: "rush",
        text: "直接冲上舞台救白秋",
        next: "final_confrontation",
        statChanges: { sanity: -4, stamina: -8, trust: 10 },
        effect: "shake",
      },
    ],
  },
  final_confrontation: {
    id: "final_confrontation",
    title: "最后选择",
    chapter: "终章",
    locationId: "theater",
    body: [
      "陈九的刀尖抵着绳结。台下的黑暗里像坐满了观众。",
      "你能用道具、线索和白秋对你的信任，决定这场夜惊魂停在哪里。",
      "你把证据一件件说出来：闭馆记录不是鬼写的，是有人提前改过系统；图书馆歌声来自藏在楼梯间的旧扩音器；医学院封条每年裂开，是因为地下通道一直有人进出。",
      "陈九的表情第一次变了。不是因为害怕，而是因为他发现你没有被传说牵着走。恐惧一旦被拆成证据，就不再听他的命令。",
      "可绳子仍在收紧。你必须立刻决定，是让苏婉的照片公开真相，是切断后台电源强行制伏他，还是用最后的线索逼他自己承认。",
      "小剧场里很安静。安静到你能听见自己理智一点点绷紧，也能听见白秋轻声喊你的名字。",
    ],
    effect: "jumpscare",
    choices: [
      {
        id: "photo",
        text: "高举苏婉的照片，让守护灵的力量介入",
        next: "ending_good",
        requireItem: "photograph",
        statChanges: { sanity: -2, clues: 8, trust: 10 },
        effect: "ending",
      },
      {
        id: "card",
        text: "用门禁卡切断后台电源，和张一诚一起制伏他",
        next: "ending_sacrifice",
        requireItem: "key_card",
        statChanges: { stamina: -10, trust: 15 },
        effect: "shake",
      },
      {
        id: "mercy",
        text: "用线索逼他承认一切，但放下报复",
        next: "ending_mercy",
        statChanges: { sanity: 5, clues: 10, trust: 8 },
        effect: "ending",
      },
      {
        id: "flee",
        text: "带白秋从侧门离开，永远不再回头",
        next: "ending_escape",
        statChanges: { sanity: 3, trust: 10, stamina: -4 },
      },
    ],
  },
  ending_good: {
    id: "ending_good",
    title: "结局一：拨云见日",
    chapter: "结局",
    locationId: "theater",
    body: [
      "苏婉的照片落在舞台中央。灯光恢复，陈九的谎言被所有证据钉死。你保护了白秋，也揭开了医学院的秘密。",
      "后来学校封存了小剧场地下的旧通道，医学分馆也公开了一部分旧档案。官方说这只是一次利用校园传说进行的恶性犯罪，和鬼神无关。",
      "可每年 23:47，基础图书馆的借阅机仍会短暂亮起。屏幕上不再出现警告，只显示一行很淡的字：谢谢你让她被记住。",
    ],
    choices: [],
    ending: "good",
  },
  ending_sacrifice: {
    id: "ending_sacrifice",
    title: "结局二：血色兄弟",
    chapter: "结局",
    locationId: "theater",
    body: [
      "张一诚替你挡下了最后一刀。真相公开了，但每次经过临湖餐厅，你都会想起他把门禁卡塞给你的那一晚。",
      "他曾经因为沉默失去林伟，又因为开口救下你和白秋。警方报告里，他只是“协助破案的学生”，可你知道真正让绳结断开的，是他最后一次选择不逃。",
      "很多年后，临湖餐厅翻新，旧台阶被拆掉。你在施工围挡外站了很久，手机忽然收到一条没有号码的短信：这次我没有来晚。",
    ],
    choices: [],
    ending: "bad",
  },
  ending_mercy: {
    id: "ending_mercy",
    title: "结局三：一念慈悲",
    chapter: "结局",
    locationId: "theater",
    body: [
      "你没有让复仇继续吞掉活人。陈九被带走时，启真湖的水面第一次映出了完整的月亮。",
      "白秋问你，为什么最后没有推他一把。你说，因为如果所有人都把恐惧传给下一个人，千绳会就永远不会结束。",
      "苏婉的照片被放进校史馆角落，没有华丽说明，只写着：曾试图阻止一场罪行的人。你觉得这已经足够。",
    ],
    choices: [],
    ending: "true",
  },
  ending_escape: {
    id: "ending_escape",
    title: "结局四：远走高飞",
    chapter: "结局",
    locationId: "theater",
    body: [
      "你和白秋离开了学校。许多年后，紫金港的夜间地图仍会偶尔重排，只是你再也没有点开它。",
      "逃离不是胜利，但至少你们活了下来。白秋很少提起那晚，只有下雨时，她会把窗帘拉得很严。",
      "你们搬家后，有一天收到一个没有寄件人的信封。里面只有一张剧票，小剧场旧址，开场时间 23:47。",
    ],
    choices: [],
    ending: "escape",
  },
  ending_nightmare: {
    id: "ending_nightmare",
    title: "结局五：无尽噩梦",
    chapter: "结局",
    locationId: "theater",
    body: [
      "理智太低时，真相反而成了新的牢笼。你被困在精神病院里，反复听见 23:47 的闭馆铃。",
      "医生说你只是创伤后应激，白秋说一切都已经结束。可每当夜里熄灯，你都会看见病房门口多出一台借阅机。",
      "它吐出一张又一张小票，每张背面都写着同一句话：湖边不要回头。你不敢回头，因为你知道，自己早已站在湖里。",
    ],
    choices: [],
    ending: "bad",
  },
  death_sanity: {
    id: "death_sanity",
    title: "理智崩溃",
    chapter: "失败",
    locationId: "theater",
    body: ["现实与幻觉在你眼前彻底模糊。地图上所有地点都变成同一个黑色出口。"],
    choices: [],
    ending: "death",
  },
};

export const clampStat = (value: number) => Math.max(0, Math.min(100, value));

export const getSceneHotspot = (sceneId: StorySceneId) => storyScenes[sceneId].locationId;

export const getHotspotById = (id: HotspotId) => storyHotspots.find((hotspot) => hotspot.id === id);
