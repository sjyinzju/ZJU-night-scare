export type StatKey = "sanity" | "stamina" | "clues" | "trust" | "affection";

export type ItemId = "talisman" | "flashlight" | "receipt" | "key_card" | "medicine" | "diary" | "photograph" | "cat_hair" | "energy";

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
  | "library_receipt"
  | "library_talisman"
  | "library_shelf"
  | "library_fall"
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
  | "dorm_baiqiu_bond"
  | "baiqiu_umbrella"
  | "baiqiu_confession"
  | "ending_good"
  | "ending_sacrifice"
  | "ending_mercy"
  | "ending_escape"
  | "ending_together"
  | "ending_nightmare"
  | "death_sanity";

export type HorrorEffect = "whisper" | "shake" | "jumpscare" | "reveal" | "ending";

export interface StoryStats {
  sanity: number;
  stamina: number;
  clues: number;
  trust: number;
  affection: number;
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
  /** Where the scene physically takes place. Drives 3D interior vs 2.5D popup choice. */
  setting: "indoor" | "outdoor";
  /** 0-1 视觉扭曲加成。关键时刻（鬼现形、终章）自动提升后期特效强度。 */
  distortionBoost?: number;
  /** Keep the scene as progression state but wait for an in-world item/zone before opening its modal. */
  deferInInterior?: boolean;
  /** P4 deliberately hides the body behind a stronger glass blur until the choice dissolves. */
  strongBlur?: boolean;
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
  /** How the hotspot triggers: enter 3D, text popup, or outdoor-then-indoor. */
  mode: "indoor-3d" | "outdoor-text" | "outdoor-to-indoor";
}

export const itemCatalog: Record<ItemId, { name: string; icon: string; desc: string }> = {
  talisman: { name: "护身符", icon: "符", desc: "旧黄符纸。第一次承受强烈理智伤害时会自动抵挡。" },
  flashlight: { name: "手电筒", icon: "光", desc: "施工队遗落的小手电。黑暗区域调查时降低恐惧。" },
  receipt: { name: "借阅小票", icon: "票", desc: "23:47 打印的异常借阅记录。借阅人一栏是空白。" },
  key_card: { name: "门禁卡", icon: "卡", desc: "张一诚给你的医学院地下仓库通用卡。" },
  medicine: { name: "镇定药", icon: "药", desc: "杜学民给的白色药瓶。服用后恢复 20 点理智。" },
  diary: { name: "日记残页", icon: "页", desc: "论坛附件里的扫描页，记录了千绳会的旧案。" },
  photograph: { name: "老照片", icon: "照", desc: "苏婉在旧教学楼前的照片。背面写着 1953。" },
  cat_hair: { name: "黑猫毛发", icon: "毛", desc: "能感知阵法里不自然的冷点。" },
  energy: { name: "能量饮料", icon: "饮", desc: "罐装咖啡。恢复 30 点体力。" },
};

export const initialStoryState: StoryState = {
  currentSceneId: "library_intro",
  stats: { sanity: 100, stamina: 100, clues: 0, trust: 50, affection: 0 },
  inventory: [],
  flags: {},
  visitedHotspots: [],
  completedHotspots: [],
  log: ["00:47，紫金港的路灯还亮着。先去农医馆确认闭馆记录。"],
};

export const storyHotspots: StoryHotspot[] = [
  {
    id: "library",
    title: "闭馆记录",
    place: "农医馆",
    objective: "核对最后一条借阅记录",
    sceneId: "library_intro",
    x: 19.4,
    y: 30.2,
    radius: 1.9,
    order: 1,
    mode: "indoor-3d",
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
    mode: "outdoor-to-indoor",
  },
  {
    id: "canteen",
    title: "张一诚",
    place: "临湖餐厅",
    objective: "找张一诚问清医学院传闻",
    sceneId: "find_yicheng",
    x: 13.5,
    y: 14.6,
    radius: 1.7,
    order: 3,
    mode: "outdoor-text",
  },
  {
    id: "du-office",
    title: "杜学民办公室",
    place: "农医馆",
    objective: "向杜学民核验日记和老照片",
    sceneId: "find_du",
    x: 18.5,
    y: 30.0,
    radius: 1.8,
    order: 4,
    mode: "outdoor-text",
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
    mode: "outdoor-to-indoor",
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
    mode: "outdoor-text",
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
    mode: "outdoor-text",
  },
  {
    id: "theater",
    title: "小剧场祭台",
    place: "小剧场",
    objective: "阻止陈九完成仪式",
    sceneId: "final_plan",
    x: 10.2,
    y: 11.2,
    radius: 1.9,
    order: 8,
    mode: "indoor-3d",
  },
];

export const storyScenes: Record<StorySceneId, StoryScene> = {
  library_intro: {
    id: "library_intro",
    title: "十点以后，有人在唱",
    chapter: "第一章",
    locationId: "library",
    setting: "indoor",
    body: [
      "　　2008 年 3 月初，夜里十点。医学院图书馆缩在校园最偏僻的西南角，离宿舍区很远，平时就少有人来。今晚馆内只坐着稀稀拉拉二十几个学生，暖气开得很足，窗户全部关着，玻璃外连树枝摇动的声音都传不进来。你陪室友林伟来这里自习，本来只听得见翻书、落笔和偶尔压低的咳嗽声，头顶的灯却不知从什么时候起染上了一层暗红，像隔着一层洗不净的旧血。",
      "　　林伟忽然停下笔，侧着头问你：『你有没有听到什么声音？』你屏住呼吸听了半天，只听见自己的袖口擦过桌沿。他向四周看了一圈，额头上渗出细密的汗，又把声音压得更低：『有个女人在唱歌，从教学楼那边传来的。』图书馆和教学楼之间隔着停车场与绿化带，就算真有人唱歌，也绝不可能穿过三百米的夜色和紧闭的窗。可林伟说那戏腔已经跟了他三天，而且每到十点，就会从不同的书架后面喊他的名字。说完，他像忽然看见了什么，匆匆离开座位，只丢下一句：不要碰桌上的东西。",
      "　　你循着猩红的微光找到他留下的笔记本。封皮被潮气泡得发软，边角却沾着一层尚未干透的黑泥；金属搭扣没有扣紧，轻轻一碰便自己弹开。第一页只写着『林伟』两个字，名字后原本还有一行内容，却被同一支笔反复划穿。纸纤维已经破裂，露出的并不是下一页，而是一小片暗红色桌面。你把手电移开，那片颜色仍在纸缝里缓慢闪动，像有什么东西正隔着纸页呼吸。夹页中还粘着几根很长的黑发，发梢湿冷，绝不可能属于林伟。",
      "　　3 月 7 日，22:16。林伟写道，十点以后书架后面一直有人唱戏，管理员却确认馆内没有广播；他每次循声走近，歌声都会换到更远的一排。下一页画着一条潦草路线：阅览桌、借阅终端、右侧小隔间、最里面第三排书架。每个地点旁边，都画着同一双鞋——鞋头尖窄，鞋面绣着褪色的红花。最后一幅画里，那双绣花鞋悬在书架上方，没有腿，鞋底却不断往下滴水。路线末端还写着一句被划掉的话：她不是从门里进来的。",
      "　　3 月 8 日，23:47。最后一段字迹越来越重，几乎划破纸背：借阅终端会吐出一张借阅人姓名空白的小票，机器明明断着电，票纸却带着刚打印出来的温度；小票上的归还地点不属于这座图书馆，背面还会浮出原本没有的字。林伟在页脚连续写了三遍『不要回答』，第三遍只剩颤抖的墨点。再往下是一行仓促补上的警告：如果你找到那张票，先看日期，再看纸背；不要看窗外，也不要回答歌声。就在你读完时，右侧小隔间传来打印机滚轴空转的声音。",
    ],
    choices: [
      {
        id: "check-names",
        text: "逐行检查日期和被划掉的名字",
        next: "library_receipt",
        statChanges: { sanity: -2, clues: 5 },
        setFlag: "notebook_checked",
        effect: "whisper",
      },
      {
        id: "photograph-page",
        text: "用手机记下最后一页，再寻找对应票据",
        next: "library_receipt",
        statChanges: { stamina: -1, clues: 4 },
        setFlag: "notebook_photographed",
      },
      {
        id: "close-notebook",
        text: "合上笔记本，先离开这张桌子",
        next: "library_receipt",
        statChanges: { sanity: 2, clues: 1 },
      },
    ],
  },
  library_receipt: {
    id: "library_receipt",
    title: "不存在的最后一条记录",
    chapter: "第一章",
    locationId: "library",
    setting: "indoor",
    deferInInterior: true,
    body: [
      "　　贴到眼前的白影骤然退去，小隔间里重新只剩暗红的灯光。你背靠隔板站了几秒，耳膜里仍残留着女人拖长的唱腔，鼻腔却闻到一股老式打印机过热时才有的焦味。桌上的终端屏幕漆黑，打印机滚轴仍在缓慢空转，齿轮每咬合一次，桌下便传来一下指甲刮过地面的轻响。那声音起初在椅子后面，随后绕过你的鞋尖，最后停在两脚之间。你低头照去，地面空空荡荡，只有一缕湿黑的头发正往柜子底下缩。",
      "　　小票搁在高桌靠外的位置，边缘微微卷曲，纸面带着不该存在的余温。可打印机电源灯没有亮，电源线垂在墙边，插头离插座至少还有半米；纸仓也是空的，透明盖板内只留着几道潮湿的手指印。你把票拿起来，机器立刻停止转动，隔间里静得能听见纸纤维在指腹下摩擦。下一秒，终端屏幕自行闪了一下，没有出现系统界面，只映出你身后的空椅，以及椅背上方一张惨白而模糊的脸。等你回头，那里仍然什么都没有。",
      "　　票面最上方印着『医学院图书馆一层』，借阅人一栏完全空白，连供填写姓名的横线也像被人仔细擦掉了。索书号 R-1953 指向一份早已封存的戏曲病理档案，归还地点却写着『医学院地下仓库』；你从未在馆内指示牌上见过这个地点。打印时间是 23:47，日期正好与林伟笔记本的最后一页相同。更奇怪的是，票据下方列着三次续借记录，日期分别相隔七年，借阅人始终为空，而每次经办人的签名都是林伟的笔迹。最后一次续借时间，就是今晚。",
      "　　你把小票与笔记本贴在一起，两个时间一分不差，连数字 7 上那道习惯性的横线都完全相同。林伟不是提前预言了这张票——更像是昨夜的他也站在同一个隔间，拿到过同样的东西，又被迫亲手补上了这条记录。你将票纸斜着迎向手电光，背面逐渐浮出层层叠叠的压痕：最上面一行写着『湖边不要回头』，下面是『听见有人唱你的名字，不要回答』。最深的一行几乎压穿纸面，只有四个字：符在外面。笔画末端沾着细碎的黄色纸屑和香灰。",
      "　　隔板外忽然响起纸页被逐张翻动的声音。每翻一页，声音便向入口挪近一点；可从隔板下方看出去，地上没有鞋，也没有影子。最后一声翻页停在你背后，空椅自行转了半圈，扶手上缓慢浮出一道湿漉漉的五指印。紧接着，左侧书架旁的桌面传来一声极轻的纸响，像有人刚把什么东西放在那里。小票背面的黄色碎屑开始发热，黑暗中亮起下一处猩红微光。你终于明白那句『符在外面』指向什么，但那道红光旁边，还有一双刚刚踩出的湿鞋印。",
    ],
    choices: [
      {
        id: "compare-time",
        text: "把小票与笔记本时间逐项比对",
        next: "library_talisman",
        statChanges: { sanity: -2, clues: 7 },
        setFlag: "timeline_linked",
      },
      {
        id: "inspect-imprint",
        text: "用手电查看纸背和压痕",
        next: "library_talisman",
        requireItem: "flashlight",
        statChanges: { sanity: -3, clues: 9 },
        setFlag: "receipt_imprint_found",
      },
      {
        id: "pocket-receipt",
        text: "先收进口袋，不在隔间久留",
        next: "library_talisman",
        statChanges: { sanity: 2, clues: 4 },
      },
    ],
  },
  library_talisman: {
    id: "library_talisman",
    title: "桌上的旧符",
    chapter: "第一章",
    locationId: "library",
    setting: "indoor",
    deferInInterior: true,
    body: [],
    choices: [],
  },
  library_shelf: {
    id: "library_shelf",
    title: "没有影子的脚步",
    chapter: "第一章",
    locationId: "library",
    setting: "indoor",
    distortionBoost: 0.18,
    body: [
      "　　你在左侧桌上收起旧符，符纸边缘仍残留着没有燃尽的焦痕，贴近皮肤时却像冰一样冷。书架通道深处随即亮起一点猩红，每次游戏都可能落在三本不同的旧书上。你沿着狭窄通道走到这一次被选中的位置，才发现那本书没有馆藏标签，书脊在发热，封面却凝着细密水珠。水珠没有向下滑，而是逆着重力爬向书顶，在最高处汇成一枚小小的湿手印。旁边所有书都落满灰尘，唯独它像刚被谁从水里捞出来。",
      "　　你刚靠近，整排书架后的脚步声便在同一瞬间消失，仿佛那个人一直隔着一层木板与你并肩行走。头顶红灯从通道最深处开始逐盏熄灭，黑暗一截一截地爬近，只剩面前这本书仍泛着猩红的光。你向左移动一步，书架另一侧也响起一步；你停下，那里便停下。可当你突然回头，身后的通道空无一人，地面却多了一串湿脚印，从你来时的方向一直延伸到脚后，最后一枚鞋印恰好踩住了你的影子。",
      "　　戏腔从书架缝隙里贴出来，起初只是含混的拖腔，随后每个音节逐渐变得清楚——她唱的不是戏词，而是你的名字。手电光扫过缝隙，另一侧露出一小片白色衣角，正违背重力缓慢向上升；更高的位置浮出半只眼睛，眼白浑浊，瞳孔却始终追着光圈移动。你把光移开，那只眼睛仍留在视野边缘。等你再次照回去，缝隙里只剩几根湿发，可耳边已经多出另一个呼吸，节奏与你完全一致。",
      "　　护身符在口袋里骤然发烫，符面发出纸张被火舌舔过的脆响。书架深处传来三下敲击，停顿片刻，又从你背后的木板内侧回响三下，像有人在提醒你抽出这本书，或者立即后退。你伸手时，书脊自己向外滑出一寸，后面没有墙，只有一小片深得不见底的黑暗。黑暗中先伸出一根苍白手指，随后是第二根；旧符突然烧掉一角，那只手才猛地缩回去。无论你作何选择，她都已经知道你站在这里。",
      "　　旧书的纸页在无人触碰的情况下迅速翻动，最后停在一张手写借阅表上。表格从七年前开始，每一行都记着相同的时间：23:47；姓名有的被水泡烂，有的被红笔整行涂黑，最下面一格却清楚写着林伟。你还没来得及细看，他名字下方的空格便自行渗出墨迹，一笔、一画，缓慢勾出你的姓。手电光开始颤动，那页纸深处传来极轻的抓挠声，仿佛名字不是写在纸上，而是有人被压在书页里面，正用指甲向外刻。",
      "　　就在这时，林伟的声音从书架房间外传来。他像站在很远的空地上，语气却近得贴着你的耳朵：『歌声跑到外面去了。跟我来，我们去找她。』你明明刚看过他空着的座位，这声音却与十分钟前毫无区别。最后一排红灯同时熄灭，出口外只剩暴雨前惨白的微光；断续的歌声正从远处路灯方向传来。你绕出书架，没有看见林伟，只看见门口地面出现一双朝外的湿鞋印。它们一步一步向黑暗延伸，像在等你跟上。",
    ],
    choices: [
      {
        id: "pull-book",
        text: "抽出这本书，检查书后传来的声音",
        next: "library_fall",
        statChanges: { sanity: -4, stamina: -2, clues: 6 },
        setFlag: "pulled_story_book",
      },
      {
        id: "light-gap",
        text: "用手电照进书架缝隙",
        next: "library_fall",
        requireItem: "flashlight",
        statChanges: { sanity: -3, clues: 8 },
        setFlag: "saw_ghost_direction",
      },
      {
        id: "listen-back",
        text: "后退一步，只听声音从哪边移动",
        next: "library_fall",
        statChanges: { sanity: -2, stamina: -1, clues: 4 },
      },
    ],
  },
  library_fall: {
    id: "library_fall",
    title: "灯下的人",
    chapter: "第一章",
    locationId: "library",
    setting: "indoor",
    distortionBoost: 0.34,
    strongBlur: true,
    body: [
      "　　你跟着那双湿鞋印走出书架房间，外面的空地被暴雨前的黑暗吞得只剩轮廓。风声贴着墙角打转，远处路灯只有一根模糊的影子。就在你距离它还有一段路时，歌声突然停在最高的那个音上。砰——巨响与贴脸的白影同时撞进视野，像有什么沉重的东西从高处砸穿雨幕。你的耳朵里只剩尖锐蜂鸣，胸口也被震得发麻；下一道惨白闪电掠过天花板，整片空地在一瞬间亮得没有阴影。",
      "　　白光退去，原本熄灭的路灯毫无征兆地亮了。灯罩里没有普通灯泡的暖色，只有一束浓得近乎发黑的猩红光线，直直钉向地面。那束光里凭空多出一个人，刚才你明明看过那里，除了被雨打湿的砖面什么都没有。林伟趴在一楼外的雨檐边，身体保持着落地后被折断的姿势，一只手臂压在胸口下面，另一只手朝你的方向摊开，五根手指仍微微蜷曲，像坠落以后还试图抓住什么。",
      "　　鲜血从他的额角和身体下方缓慢漫开，顺着地砖缝分成几道细线。雨越下越大，那颜色却没有被冲淡，反而逆着水流向路灯底座爬去，仿佛整片空地正在把血吸回某个看不见的伤口。离林伟半步远的地方，眼镜摔成两截，一只镜腿挂在雨檐边缘，其中一片镜片还算完整。每当闪电亮起，镜片里映出的都不是你面前的天空，而是教学楼三层那扇敞开的窗，以及一个站在窗框外侧的白色人影。",
      "　　你认出林伟穿着今晚那件外套，衣袋里甚至还露着自习用的笔，鞋底也粘着阅览室地面的灰。他的颈侧却留下五道朝上的乌青指痕，像坠下去以前曾有一只手隔着窗沿抓住他，又在最后一刻故意松开。摊开的手旁压着一页从笔记本撕下来的纸，纸被雨泡得半透明，字迹沿纤维晕成细小黑线。你用手电勉强辨出两句话：『我没有跳。』『她在窗外叫我。』第二句话下面还有半个没写完的名字，最后一笔一直拖到纸外。",
      "　　林伟的嘴唇忽然轻轻动了一下。你明知这样的身体不可能再说话，却从他的口型里认出了十分钟前反复问你的那句话：你有没有听到有人在唱歌？紧接着，血光照不到的边缘浮出一截湿透的白色裙摆。一个穿旧式白衣的女人站在路灯之外，长发遮住整张脸，垂下的袖口不断滴水；裙摆下那双绣花鞋悬在地面上方，没有影子，也没有沾上一滴雨。她没有看林伟，而是缓慢抬起手，隔着空地指向你。",
      "　　戏腔戛然而止，风声、雨声和灯管的电流声也在同一瞬间消失。整片空地只剩你的呼吸，以及林伟身下液体越过砖缝时细得几乎听不见的流动声。路灯忽明忽暗，每暗一次，白衣女人便离你更近一点；第三次亮起时，她已经消失，地面上却多出一双正对着你的湿鞋印。你下意识看向摔碎的镜片，白色裙摆仍停在你的身后，而镜中的林伟不知何时睁开了眼，正越过你的肩膀看着她。",
    ],
    choices: [
      {
        id: "approach-fallen",
        text: "立刻靠近确认那个人是否还有反应",
        next: "dorm_baiqiu",
        statChanges: { sanity: -7, stamina: -6, clues: 5 },
        setFlag: "approached_fallen_person",
      },
      {
        id: "call-help",
        text: "先拨 120 和保卫处，报清当前位置",
        next: "dorm_baiqiu",
        statChanges: { sanity: -4, stamina: -2, clues: 6 },
        setFlag: "called_help_early",
      },
      {
        id: "observe-edge",
        text: "留在光线边缘，用手电观察周围",
        next: "dorm_baiqiu",
        requireItem: "flashlight",
        statChanges: { sanity: -5, stamina: -1, clues: 8 },
        setFlag: "observed_fall_scene",
      },
    ],
  },
  library_sound: {
    id: "library_sound",
    title: "没有影子的脚步",
    chapter: "第一章",
    locationId: "library",
    setting: "indoor",
    distortionBoost: 0.15,
    body: [
      "你们顺着歌声往楼梯间走。声控灯一盏盏亮起，又一盏盏熄灭，像有人在前面替你们开路。",
      "林伟突然冲向栏杆。你只来得及看见一双不该出现在那里的脚——悬在二楼转角的黑暗里，脚底朝着走廊这边。",
      "没有哪个房间在放歌。那声音在楼梯间里上上下下，贴着墙壁，绕过消防栓，又从你背后的书架缝隙里钻出来。每个音都很轻，却准确踩在你的心跳之间。",
      "林伟说他看见了一个穿戏服的女人。她站在楼梯上，袖口湿漉漉的，像刚从湖里爬出来。你什么都没看见，只看见林伟一步一步往前走，眼睛空得像一面没有反光的镜子。",
      "声控灯最后一次亮起时，你终于看清了栏杆外侧的东西：一双脚。脚尖朝下，悬在半空。脚上套着一双绣花鞋，鞋底沾着启真湖边的黑泥。裙摆遮住了脚踝，那个身影在灯光熄灭前的最后一秒转过身，消失了。",
    ],
    effect: "jumpscare",
    choices: [
      {
        id: "chase",
        text: "冲下楼查看林伟的情况",
        next: "library_police",
        statChanges: { sanity: -8, stamina: -5, clues: 6 },
        setFlag: "investigatedLin",
        effect: "shake",
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
    setting: "indoor",
    body: [
      "你走到农医馆出口门前。门外的红蓝灯隔着玻璃一阵阵扫进来，把书架、楼梯和地上的水痕切成短促的明暗。二十分钟后，救护车和警车呼啸而至，医学院教学楼下拉起了警戒线。",
      "一位姓张的警官带你去做笔录。问了一个多小时。做完后他放了一段监控录像：画面里，林伟走到三楼窗户前，站了半分钟，翻身跳了下去。但画面的角落里，模模糊糊出现了一双脚——穿着绣花鞋，裙摆遮住了脚踝。那个身影站了几秒，转身消失了。",
      "「警官，监控最后那个……那双脚是怎么回事？」张警官的目光微微闪烁了一下。「光线反射的问题，我们有经验。」「可那明明是一双绣花鞋啊！」「同学，案件结论是林伟因学业压力过大自杀身亡。这件事就到此为止。」",
      "他话里有话。你盯着他的眼睛，忽然明白了：他知道那不是光线反射。他只是不能说。一个警察用官方结论堵住你的嘴，说明这件事的盖子远比你想象的重。",
      "做笔录时手机震了一下。一个陌生号码发来短信：回白沙宿舍。白秋知道下一段。你把手机揣进口袋，感到那张小票在口袋里发烫，像在催你往前走。",
    ],
    choices: [
      {
        id: "return-dorm",
        text: "带着监控线索回白沙宿舍，去找白秋",
        next: "dorm_baiqiu",
        statChanges: { sanity: -2, clues: 5, trust: 2, stamina: -3 },
      },
    ],
  },
  dorm_baiqiu: {
    id: "dorm_baiqiu",
    title: "白秋的警告",
    chapter: "第二章",
    locationId: "dorm",
    setting: "outdoor",
    body: [
      "回到宿舍楼下，正要刷卡进门，一个熟悉的声音叫住了你。「张超！」回头一看，是女朋友白秋。她穿着一件白色羽绒服，站在寒风中，脸色白得有些过分。白秋是金融系的，性格偏冷淡，平时不太喜欢热闹，也很少主动找你。这么晚还等在这里，你已经觉得不对劲。",
      "雨水顺着她的伞骨往下滴。她第一句话是：不要再查图书馆，也不要去医学院。她递给你一枚发旧的黄符，说这是她家里老人留下的东西。",
      "白沙宿舍区平时总是有人骑车、取外卖、打电话，可今晚所有窗户都像被同一只手按灭了灯。白秋的影子落在地上，被路灯拉得很长，长到几乎碰到你脚边。",
      "她说林伟不是第一个。上一届、再上一届，都有人在紫金港夜里听见歌声。有人醒来发现自己站在启真湖边，有人第二天忘记了整整一晚，还有人从此再也不肯经过医学院。",
      "你问她为什么知道这些。她沉默很久，只说自己小时候听过同一首歌。那时她还不在浙大，但家里人已经知道，紫金港有些路活人不能走。",
      "黄符边缘已经发黑，像被火燎过。你握住它时，掌心忽然发烫，耳边的雨声也突然变得很远。",
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
      {
        id: "stay",
        text: "先别急着答复，陪她在雨里的路灯下多站一会儿",
        next: "dorm_baiqiu_bond",
        statChanges: { sanity: 4, trust: 10, affection: 8 },
        gainItem: "talisman",
      },
    ],
  },
  dorm_baiqiu_bond: {
    id: "dorm_baiqiu_bond",
    title: "路灯下的白秋",
    chapter: "第二章",
    locationId: "dorm",
    setting: "outdoor",
    body: [
      "你没有立刻接过话，也没有急着离开。你只是把伞往她那边倾了倾，让雨从自己这一侧的肩头滑下去。白秋愣了一下，像很久没有人愿意为她多站这半步。",
      "她低声说，从小到大，家里人教她的第一件事就是躲。躲那首歌，躲所有听得见她的人。那首歌像一条看不见的线，缠在她身上很多年，谁靠近她，线就会缠向谁。所以她学会了先一步把人推开。",
      "路灯忽明忽暗，把她的影子和你的影子叠在一起，又慢慢分开。你发现她说这些时，指尖一直在轻轻发抖，却始终没有往后退。",
      "你说：把我算进那根线里也没关系。她抬起头，眼睛里有雨，也有一点你从没在她脸上见过的、近乎慌乱的光。她说，别轻易说这种话，紫金港的夜里，承诺是要还的。",
      "可她还是没有把伞推开。你们就这样在楼下站了很久，直到雨声把远处那首歌完全盖了过去。那一刻你忽然明白，你想守护的已经不只是一个证人，而是这个总把自己藏在符纸后面的女孩。",
    ],
    choices: [
      {
        id: "umbrella",
        text: "把外套披到她肩上，送她走完这段夜路",
        next: "baiqiu_umbrella",
        statChanges: { sanity: 3, trust: 8, affection: 10, stamina: -2 },
      },
      {
        id: "restraint",
        text: "把话咽回去，先回宿舍整理线索",
        next: "dorm_forum",
        statChanges: { sanity: 2, trust: 6, affection: 4, clues: 2 },
      },
    ],
  },
  baiqiu_umbrella: {
    id: "baiqiu_umbrella",
    title: "共一把伞",
    chapter: "第二章",
    locationId: "dorm",
    setting: "outdoor",
    body: [
      "你脱下外套披到她肩上。外套还带着体温，她的身体轻微地僵了一下，随即安静下来，像一株终于等到屋檐的植物。",
      "两个人挤在一把伞下，脚步不得不放慢。雨水在伞面上敲出细密的节奏，奇怪的是，那首一直缠着你们的歌声，在这节奏里第一次显得很远。白秋说，从来没有人陪她走过这条路，往年这个时候，她都是一个人抱着符纸，从楼下一直走到湖边，再一个人走回来。",
      "走到宿舍拐角，她忽然停下，把黄符又往你手里塞了塞，说：如果哪天我不见了，别去湖边找我，也别去小剧场。你握住她冰凉的手，说你不会让那一天来。她没有反驳，只是把脸别过去，肩膀轻轻抖了一下。",
      "分别前，她第一次主动说了句和调查无关的话：谢谢你，今天没有把我当成传说的一部分。她说这句话时，路灯正好熄灭，黑暗里你听见她很轻地笑了一下，那声音干净得不像属于这个夜晚。",
      "你站在原地看着她的窗户亮起，又很快熄灭。掌心里的黄符不再发烫，反而透出一点微弱的暖，像有人隔着很远，仍愿意为你留一盏灯。",
    ],
    choices: [
      {
        id: "vow",
        text: "在心里认下这个约定，回宿舍继续追查真相",
        next: "dorm_forum",
        statChanges: { sanity: 4, trust: 10, affection: 12 },
        setFlag: "baiqiuBond",
      },
    ],
  },
  dorm_forum: {
    id: "dorm_forum",
    title: "论坛旧帖",
    chapter: "第二章",
    locationId: "dorm",
    setting: "indoor",
    body: [
      "宿舍电脑上的旧论坛还留着缓存。标题是：浙大夜惊魂，学长学姐们代代相传。你点进去的时候，屏幕边缘闪了一下，像有人在你背后快速走过。",
      "帖子最早发布于很多年前，楼主说自己只是整理校园传说：图书馆歌声、医学院封条、启真湖倒影、小剧场半夜亮灯。可越往下翻，传说越不像传说，更像一份被拆散的事故报告。",
      "有一条几年前的帖子标题让你浑身发冷：《谁在医学院看到了那个古装女人？》。楼主说骑车经过医学院后面那条小路，看到大约三十米外站着一个穿白色古装的女人，披头散发。那女人看到楼主，竟然飘了过来。下面有人回复：「那个女人，是不是穿着绣花鞋？我远远见过一次，吓得魂都没了……」",
      "继续翻。关于古装女人的讨论零零散散跨越了好几年。最让人在意的是一条被很快删除的回复：「医学院那块地，建校之前是坟场。学校请了风水先生做了布局，才压住了。」",
      "附件里有一张扫描日记残页，字迹潦草：千绳会、苏婉、1953、医学院地下仓库。有人提到苏婉——民国时期的戏曲名角，后来在浙江医学院附近离奇死亡。底下有人说她根本不是来害人的。她守在那里，是为了拦住地下的另一个东西。",
      "日记残页的最后一行被水泡开了，只剩半句话：他们不是在祭她，他们是在借她的名义继续……你把图片放大，发现纸边有一个坐标标记。坐标落在临湖餐厅附近，旁边写着张一诚的名字。",
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
      {
        id: "message-baiqiu",
        text: "给白秋发条消息，只说一句「我在查，你别怕」",
        next: "find_yicheng",
        requireFlag: "baiqiuBond",
        statChanges: { sanity: 5, trust: 6, affection: 8 },
      },
    ],
  },
  find_yicheng: {
    id: "find_yicheng",
    title: "张一诚知道得太多",
    chapter: "第三章",
    locationId: "canteen",
    setting: "outdoor",
    body: [
      "张一诚是班里最好的哥们。成绩好，性格开朗，是个仗义的人。你找到他时，他已经知道了林伟的事。临湖餐厅早已打烊，他坐在门口台阶上，手里攥着一张没刷开的门禁卡。",
      "你在他旁边坐下，把所有事情都告诉了他——监控里的绣花鞋、白秋的警告、论坛上的帖子。张一诚听完，脸色变得很难看。他沉默了很久，然后说：「有件事……我一直没敢跟你说。」",
      "餐厅玻璃门上映出你们两个人的影子，可中间还多出一道很细的黑影，站在你们身后，不动，也不说话。",
      "他说白秋身上有千绳会想要的东西。千绳会每隔几年就会找一个「听得见歌声的人」，用恐惧把人引到小剧场，再借医学院旧仓库里的东西完成仪式。",
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
    setting: "outdoor",
    body: [
      "张一诚叹了口气：「你知道白秋她……有精神病吗？」你愣住了。他接着说：「白秋有很严重的人格分裂症。她有时候会完全变成另一个人——说话方式、思维角度、甚至记忆都不一样。她大一刚开学不久突然晕倒住院，就是那时确诊的。她家里请了一个很有名的精神科专家，叫杜学民，在帮她治疗。」",
      "「但你知道吗？她另一个人格一直在警告你不要去医学院。」你脑子里一片混乱。白秋有人格分裂？她说的话是幻觉还是真相？",
      "张一诚犹豫了一下，从口袋里掏出一张门禁卡，塞到你手里：「这是医学院地下仓库的通用卡……我之前从保卫处弄到的。也许你用得上。」卡面有一道深深的划痕，像被指甲反复抠过。背面没有姓名，只有一串被磨花的编号。他说它能打开医学院地下仓库的侧门，但最好只用一次——门禁系统会记录最后一个刷卡人。",
      "他说完这句话后，餐厅里面突然传来托盘落地的声音。你们同时回头，玻璃门后空无一人，只有自动售货机的灯亮了一下，又灭了。",
      "张一诚压低声音说：去农医馆找杜学民。他以前查过这件事，后来突然停手。不是他不信，是他差点查到自己身上。",
    ],
    choices: [
      {
        id: "take-card",
        text: "收下门禁卡，去农医馆",
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
    setting: "outdoor",
    body: [
      "通过张一诚找到了杜学民。一个五十多岁的中年男人，戴着金丝眼镜。他看见你并不意外。「你就是张超？白秋经常提到你。」",
      "你把日记残页递给他。他翻阅后脸色变了：「这……这是我师兄的笔迹！原来他一直在暗中调查千绳会，直到被灭口。」他从抽屉里拿出一瓶镇定药，又把农医馆的旧档案摊在桌上。",
      "农医馆的灯比普通图书馆更冷。书架之间弥漫着消毒水和旧纸混在一起的气味，让人想起医院走廊。杜学民办公室门口贴着一张褪色的课程表，上面还有「人体解剖学」的残字。他没有问你从哪里拿到日记，只是把窗帘拉上。窗外的湖面被挡住后，办公室里反而更暗了。",
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
      {
        id: "ask-baiqiu",
        text: "向杜学民打听：有没有办法让白秋彻底脱离那根线",
        next: "medical_entry",
        requireFlag: "baiqiuBond",
        statChanges: { sanity: -2, clues: 6, affection: 10, trust: 4 },
        gainItem: "medicine",
      },
    ],
  },
  ask_about_org: {
    id: "ask_about_org",
    title: "千绳会",
    chapter: "第四章",
    locationId: "du-office",
    setting: "outdoor",
    body: [
      "杜学民说，千绳会从来不是学生社团。它是一套献祭关系——每个人都以为自己只是旁观者，直到绳子收紧。",
      "医学院那块地，建校之前是坟场。学校的建筑群全都是按风水格局布置的，为的是压住下面的东西。但最近几年，有人——或者说一个组织——在试图破坏这个格局。他们想要「唤醒」下面的东西。",
      "所谓千绳会，最早只是旧医学院里几个学生的秘密组织。他们相信恐惧可以被传递、被储存，甚至被用来换取某种延续——他们称之为「不死」。苏婉死后，关于她的传说被他们反复改写：有人说她索命，有人说她唱歌引人跳楼，有人说她藏在启真湖底。越多人害怕她，她越像真的恶鬼，而真正的人反而躲在传说后面。",
      "杜学民把地图推到你面前，用红笔连出几个点：农医馆、白沙宿舍、临湖餐厅、医学院、旧教学楼、小剧场。线连成一个不规则的结，像绳结，也像一个被拉紧的圈套。",
      "如果白秋已经被选中，最后地点一定是小剧场。但真正的危险在旧教学楼后门——从那里能通到地下仓库的另一侧。正门的封条只是幌子。",
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
    setting: "outdoor",
    body: [
      "你站在医学院楼下。这栋楼在所有紫金港的地图里都显得很安静——没有社团海报，没有讲座横幅，连路灯都比别处暗两档。楼道里黑着，只有应急灯发出幽幽的绿光。空气里有股潮湿的消毒水味，像很久没通风的病房。",
      "门口没有保安，只有一张被雨水泡皱的施工告示。落款日期却是三年前。玻璃门里，电梯数字停在 B2。封条上盖着学校保卫处的章，但印泥颜色很新，像刚刚补贴上去。封条边缘有新鲜裂口——像有人刚从里面出来。",
      "你把耳朵贴近玻璃门。里面有轮子滚动的声音。很慢，像有人推着旧病床，从走廊尽头一寸一寸经过。轮轴没上油，每转一圈就发出一声干涩的吱呀，隔几秒，再响一声。",
      "医学院的外墙在夜色里泛着潮气，像刚从地里挖出来的。你走近时，门口感应灯没有亮，倒是楼里的电梯按钮亮了一下。",
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
    setting: "outdoor",
    body: [
      "绕到教学楼后面。这里更偏僻，连路灯都没有。地上有烧过纸钱的痕迹，和一些用粉笔画的奇怪符号。角落里有一个被压扁的纸箱，掀开一看，里面是一只黑猫的尸体。猫的脖子被扭断了，眼睛还睁着。周围散落着一些黄纸符咒。",
      "旁边堆着施工木板。你在地上捡到一支小手电——大概是之前施工队留下的。手电筒还有电。光束扫过墙面时，你看见一排很浅的抓痕，从地面一直延伸到门框上方。那不是人手能抓出来的高度。",
      "黑猫毛发沾着干掉的血。你想起论坛里有人说，黑猫能看见不干净的东西，所以旧医学院附近从来养不活猫。你小心翼翼地从黑猫身上取了一小撮毛发，装进口袋。",
      "楼道尽头传来拖拽声，像有人把沉重的木椅拖过水泥地。你举起手电，光圈里却什么都没有，只有一行新写上去的粉笔字：她不是凶手。",
      "旧教学楼后门没有锁，门缝里塞着一张折过很多次的纸。纸上画着一个舞台，舞台中央是一把椅子，椅背后面绕着密密麻麻的绳子。",
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
    locationId: "medical-college",
    setting: "indoor",
    distortionBoost: 0.25,
    body: [
      "推开铁门，走进教学楼。走廊很暗，只有应急灯发出幽幽的绿光。手电的光束扫过一排排紧闭的教室门。走到二楼时，你听到了一个声音——有人在哼唱。是个女声，调子很老，像是什么戏曲选段。",
      "循着声音走过去。走廊尽头的窗户边，站着一个穿白色古装的女人。她背对着你，长发披散。你以为自己会尖叫，但喉咙像被冰水灌满。她缓缓转过身来——惨白的皮肤，漆黑的眼瞳。你的眼睛在抗拒，拒绝把她看成一个完整的人。",
      "手电照过去，她没有影子，脚边却有一滩水迹，一直延伸到启真湖的方向。你想起论坛上的话，一咬牙，冲上去伸手去抓她的肩膀。但手穿过了她的身体——像穿过了冰冷的雾气。",
      "她的袖口还在滴水。每一滴落在地上，都会短暂映出一张不同的脸：林伟、白秋、张一诚、杜学民，还有一些你从未见过的学生。她开口时没有声音，只有手机屏幕自动亮起。备忘录里多出一句话：我没有在唱。是他们逼我唱。",
      "你终于明白了——那歌声从来不是索命。是警告。只是听见它的人，往往已经站在陷阱边缘。",
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
    locationId: "medical-college",
    setting: "indoor",
    body: [
      "你没有跑。那个女人看了你很久，脸上的表情从戒备慢慢变成了某种接近释然的东西。她抬手指向小剧场的方向，身体像雾气一样一点点散去。她消失后，地上多了一张泛黄的老照片。",
      "照片里的女人站在旧教学楼前，身后是临时搭起的舞台。她没有笑，眼睛看向镜头外，好像那里站着一个她真正害怕的人。照片背面写着：苏婉，1953 年摄于浙江医学院。",
      "翻到背面，除了姓名和年份，还有一行很淡的铅笔字：若我不能出去，就让他们也不能出去。你捏着照片的手指有点发抖——这张照片让杜学民的档案、论坛日记、门禁记录终于连成一条线。",
      "楼道里的拖拽声停止了。远处传来舞台幕布被拉开的声音，很轻，却足够让你确定方向。",
      "小剧场就是所有线索打结的地方。在去那里之前，你得去启真湖边把坐标重新拼起来。",
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
    setting: "outdoor",
    body: [
      "启真湖的水面映不出你的脸，只映出小剧场的舞台灯。",
      "你把门禁日志、日记残页、老照片和论坛坐标叠在一起，发现所有线都指向一个名字：陈九。",
      "湖边没有风，树叶却不停翻动。每当你低头看手机，屏幕里都会出现一个不是你输入的坐标，然后又立刻消失。",
      "你把所有材料按时间顺序排开：1953 年苏婉死亡，旧医学院地下仓库封存；多年后校园传说开始流传；近几年，每当有人试图查证，都会在图书馆或湖边出事。",
      "鬼不可怕。可怕的是有人一直躲在鬼的名字后面。他把所有恐惧都推给苏婉，把所有受害者都变成传说的一部分。",
      "水面突然亮了一下。你看见倒影里的小剧场大门敞开，白秋坐在舞台中央，椅背后绳子正在一圈圈收紧。",
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
    setting: "outdoor",
    body: [
      "陈九是个活人。正因为他太熟悉这套校园传说，所以最擅长把恐惧伪装成传言本身。白秋被带去了小剧场。那里曾经临时安置过旧医学院的尸检课桌。",
      "杜学民的声音从电话里传来，压得很低。他说陈九的祖辈和旧医学院有关系，后来一直以校友、赞助人、档案整理者的身份出入学校。他知道哪些灯会坏，哪些摄像头拍不到，哪些学生会把恐怖故事当成玩笑。他不用真的制造鬼，只要让每个人在最害怕的时候相信鬼存在。",
      "但苏婉的照片在他计划之外。那张照片能证明她从未害过人——她是第一个试图阻止仪式的人。",
      "电话最后传来一片杂音。杜学民只来得及说一句：别单独和他谈判，除非你已经准备好让所有证据同时出现。",
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
    setting: "indoor",
    distortionBoost: 0.28,
    body: [
      "小剧场的舞台灯一盏盏熄灭，只剩中心一束白光。白秋被绑在旧木椅上，陈九站在她身后。",
      "如果你掌握的线索足够多，这里不会变成恐怖故事的最后一页。它会变成一个骗局崩塌的现场。观众席空无一人，但每个座位上都放着一根红绳。绳头垂到地面，像细长的血线，最终汇向舞台中央。",
      "陈九看见你并不意外。他甚至笑了笑，说每一代都会有一个自以为能解开谜题的人。有人带着勇气来，有人带着证据来，最后都只会留下一个更好听的校园传说。",
      "白秋抬头看你，眼睛里有恐惧，也有一点微弱的信任。你突然意识到，旧版帖子里那些选择从来不是为了捉鬼。它们是在试你——试你在恐惧里还愿不愿意相信一个活人。",
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
      {
        id: "call-her-name",
        text: "越过陈九，先喊出白秋的名字",
        next: "baiqiu_confession",
        requireFlag: "baiqiuBond",
        statChanges: { sanity: 3, trust: 8, affection: 12 },
      },
    ],
  },
  baiqiu_confession: {
    id: "baiqiu_confession",
    title: "绳结前的坦白",
    chapter: "终章",
    locationId: "theater",
    setting: "indoor",
    body: [
      "你喊出她的名字，声音在空荡的剧场里撞出回声。陈九握着刀的手停了一下——他没料到，被绑在椅子上的人还能被一个名字唤回来。",
      "白秋抬起头。灯光下她的脸很白，眼角有干掉的泪痕，可她看见你的瞬间，眼神却奇异地稳了下来。她说：我叫你别来湖边，也别来这里。你怎么就是不听。",
      "你说，因为那天雨里的约定还没还。她怔住了，随即像用尽全身力气，把这些年一直藏着的话一口气说了出来：她说她早就知道自己会被带来这里，从小家里人就在等这一天。她一直不敢和任何人走得太近，因为凡是被那根线缠上的人，最后都会替她受难。",
      "她说：可我遇见你之后，第一次开始怕死。怕的不是那首歌。怕的是以后再也没有人在雨里替我倾一倾伞。她说这话时没有哭，反而笑了，那笑比哭更让你心口发紧。",
      "陈九冷冷开口，说这份感情正好，恐惧和不舍都是最好的祭品。可你握紧口袋里那枚早已回暖的黄符，忽然明白：他要的是让白秋孤立无援地害怕，而此刻她身后站着的，不再只是传说，还有一个愿意和她一起把线扯断的人。",
      "白秋看着你，极轻地说了一句只有你们两人听得见的话：如果能出去，这次换我陪你走那条夜路。",
    ],
    choices: [
      {
        id: "to-confront",
        text: "把她的手和你的攥在一起，转身面对陈九",
        next: "final_confrontation",
        statChanges: { sanity: 5, trust: 12, affection: 15 },
        effect: "reveal",
      },
    ],
  },
  final_confrontation: {
    id: "final_confrontation",
    title: "最后选择",
    chapter: "终章",
    locationId: "theater",
    setting: "indoor",
    distortionBoost: 0.32,
    body: [
      "陈九的刀尖抵着绳结。台下的黑暗里像坐满了观众。",
      "你能用道具、线索和白秋对你的信任，决定这场夜惊魂停在哪里。",
      "你把证据一件件说出来：闭馆记录不是鬼写的，是有人提前改过系统；图书馆歌声来自藏在楼梯间的旧扩音器；医学院封条每年裂开，是因为地下通道一直有人进出。",
      "陈九的表情第一次变了。他发现自己低估了你——你没有顺着传说往下滑。恐惧一旦被拆成证据，就不再听他的命令。",
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
      {
        id: "together",
        text: "和白秋十指相扣，一起扯断缠在她身上的绳",
        next: "ending_together",
        requireFlag: "baiqiuBond",
        statChanges: { sanity: 6, trust: 15, affection: 20 },
        effect: "ending",
      },
    ],
  },
  ending_together: {
    id: "ending_together",
    title: "结局六：共赴晨光",
    chapter: "结局",
    locationId: "theater",
    setting: "indoor",
    body: [
      "你没有先去够那张照片，也没有先去切电源。你走到白秋身后，握住她被绳子勒红的手，然后当着陈九的面，把那圈红绳一寸一寸地扯松。绳子在你们两个人的手里失去了力量——它本靠一个人的孤立与恐惧收紧，却收不住两颗一起跳动的心。",
      "陈九疯了一样想再唱起那首歌，可白秋第一次没有躲。她站起身，反手把你护在身侧，用她自己的声音，轻轻覆盖过那段旋律。歌声散了，剧场的幕布无风自落，露出后台那些早被拆穿的扩音器与铁绳。守护了这座校园半个世纪的苏婉，仿佛终于等到有人替她把结解开，湖底的波纹第一次彻底平息。",
      "天快亮时，你们一起走出小剧场。紫金港的路灯陆续熄灭，取而代之的是启真湖上第一层薄薄的晨光。白秋仍然握着你的手，没有松开，她说这是她记事以来，第一个不必回头的清晨。",
      "后来那枚黄符被你们一起埋在了湖边的树下。白秋说，它护了她很多年，现在该轮到它安心。你问她还怕不怕那首歌，她想了想，说：怕，但只要旁边有人一起怕，就不算什么了。",
      "很多年以后，也会有新生在旧论坛里翻到那篇《浙大夜惊魂》。帖子最末多了一条没有署名的回复，时间写着清晨六点——那个循环了无数遍的 23:47 终于被跨过去了。回复只有一句话：如果你也听见了歌声，别一个人扛着——找一个愿意在雨里为你倾一倾伞的人，然后，一起走到天亮。",
    ],
    choices: [],
    ending: "escape",
  },
  ending_good: {
    id: "ending_good",
    title: "结局一：拨云见日",
    chapter: "结局",
    locationId: "theater",
    setting: "indoor",
    body: [
      "苏婉的照片落在舞台中央。灯光恢复，陈九的谎言被所有证据钉死。张一诚从暗处冲出来，帮你按住陈九。杜学民带着警察赶到，陈九被警方带走。千绳会在Z大的势力被连根拔起。你保护了白秋，也揭开了医学院的秘密。",
      "后来学校封存了小剧场地下的旧通道，农医馆也公开了一部分旧档案。白秋在真正的专家治疗下，人格分裂的症状逐渐好转。官方说这只是一次利用校园传说进行的恶性犯罪，和鬼神无关。",
      "可每年 23:47，农医馆的借阅机仍会短暂亮起。屏幕上不再出现警告，只显示一行很淡的字：谢谢你让她被记住。",
    ],
    choices: [],
    ending: "good",
  },
  ending_sacrifice: {
    id: "ending_sacrifice",
    title: "结局二：血色兄弟",
    chapter: "结局",
    locationId: "theater",
    setting: "indoor",
    body: [
      "张一诚替你挡下了最后一刀。陈九被制服了，但送到医院的时候，已经来不及了。他最后的遗言是：「替我照顾好白秋。她是个好女孩。」葬礼那天，天上下着小雨。你站在张一诚的墓前，久久不愿离去。",
      "他曾经因为沉默失去林伟，又因为开口救下你和白秋。警方报告里，他只是「协助破案的学生」，可你知道真正让绳结断开的，是他最后一次选择不逃。",
      "从那以后，每年清明你都会去看他。带着两瓶酒，坐在墓前，说一说话。很多年后，临湖餐厅翻新，旧台阶被拆掉。你在施工围挡外站了很久，手机忽然收到一条没有号码的短信：这次我没有来晚。",
    ],
    choices: [],
    ending: "bad",
  },
  ending_mercy: {
    id: "ending_mercy",
    title: "结局三：一念慈悲",
    chapter: "结局",
    locationId: "theater",
    setting: "indoor",
    body: [
      "你没有让复仇继续吞掉活人。你用证据逼陈九认了罪，但没有在最后推他一把。他低着头被带走时，嘴里还在念那些咒文，可声音越来越小，最后只剩下嘴唇在动。启真湖的水面第一次映出了完整的月亮。",
      "白秋问你，为什么最后没有推他一把。你说，如果所有人都把恐惧传给下一个人，千绳会就永远不会结束。有些战斗，不是在刀光剑影中赢的，是在一念之间。",
      "白秋的病情慢慢好转。毕业后你们离开了Z大，去了另一座城市生活。苏婉的照片被放进校史馆角落，没有华丽说明，只写着：曾试图阻止一场罪行的人。你觉得这已经足够。",
    ],
    choices: [],
    ending: "true",
  },
  ending_escape: {
    id: "ending_escape",
    title: "结局四：远走高飞",
    chapter: "结局",
    locationId: "theater",
    setting: "indoor",
    body: [
      "你趁陈九不备，一把扯开白秋的绳子，拉着她从侧门跑了出去。身后传来陈九的吼叫，但你没有回头。连夜坐上了去南方的火车，白秋靠在你的肩膀上睡着了。窗外夜色深邃而漫长。",
      "逃离不是胜利，但至少你们活了下来。白秋很少提起那晚，只有下雨时，她会把窗帘拉得很严。她的病情虽然没有痊愈，但在平静的生活中，状态越来越稳定。",
      "你们搬家后，有一天收到一个没有寄件人的信封。里面只有一张剧票——小剧场旧址，开场时间 23:47。你把它烧了，灰烬撒进了河里。但你知道，有些东西是烧不掉的。",
    ],
    choices: [],
    ending: "escape",
  },
  ending_nightmare: {
    id: "ending_nightmare",
    title: "结局五：无尽噩梦",
    chapter: "结局",
    locationId: "theater",
    setting: "indoor",
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
    setting: "indoor",
    body: ["现实与幻觉在你眼前彻底模糊。地图上所有地点都变成同一个黑色出口。"],
    choices: [],
    ending: "death",
  },
};

export const clampStat = (value: number) => Math.max(0, Math.min(100, value));

export const getSceneHotspot = (sceneId: StorySceneId) => storyScenes[sceneId].locationId;

export const getHotspotById = (id: HotspotId) => storyHotspots.find((hotspot) => hotspot.id === id);
