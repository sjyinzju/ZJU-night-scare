# 浙大夜惊魂 ZJU Night Scare

2.5D 等距视角恐怖探索游戏，以浙江大学紫金港校区为背景。玩家扮演计算机系大二学生张超，在深夜校园中调查室友林伟坠楼事件背后的真相。多分支剧情、多结局、道具系统、理智管理、鬼魂追逐。

## 本地启动

```bash
git clone https://github.com/sjyinzju/ZJU-night-scare.git
cd ZJU-night-scare
npm install
npm run dev         # → http://127.0.0.1:5173
npm run build       # 生产构建 → dist/
```

## 操作

| 按键 | 功能 |
|------|------|
| W / ↑ | 向前移动 |
| S / ↓ | 向后移动 |
| A / ← | 向左移动 |
| D / → | 向右移动 |

> 抵达任务热点时自动弹出剧情。三岔路口方向匹配：先分上下再分左右。按下键优先选下方分支，按左键优先选同侧。

## 技术栈

| 层 | 技术 |
|----|------|
| 游戏引擎 | [Phaser 3](https://phaser.io/) — 2.5D 等距地图渲染、道路移动、物理碰撞 |
| UI 框架 | [React 19](https://react.dev/) + TypeScript |
| 状态管理 | [Zustand](https://zustand.docs.pmnd.rs/) — React ↔ Phaser 共享 Store |
| 音频 | [Howler.js](https://howlerjs.com/) — BGM 播放列表 + SFX；Web Audio API — 程序化心跳/脚步声/鬼呼吸/合成 jump scare |
| 构建 | [Vite 6](https://vitejs.dev/) |
| 图标 | [Lucide React](https://lucide.dev/) |
| 样式 | CSS 自定义恐怖主题变量 (暗角、扫描线、色差、眩光、镜头脏痕) |

## 项目结构

```
src/
├── App.tsx                      # React 主界面（标题页、HUD状态栏、任务链、道具栏、小地图Canvas、剧情弹窗、结局页）
├── main.tsx                     # React 入口
├── styles.css                   # 全局样式 + 恐怖主题 + 后处理滤镜 + 标题页
├── game/
│   ├── CampusScene.ts           # Phaser 场景
│   │                            #   地图渲染（多层 depth-sorted）
│   │                            #   道路移动系统（方向吸附、交汇转向、三岔路智能匹配、广场自由移动）
│   │                            #   鬼魂 FSM（5 状态：hidden/stalking/ambush/chasing/retreating）
│   │                            #   引导虚线（Dijkstra 寻路，红色虚线动画）
│   │                            #   氛围系统（雾气、闪光、震屏、标签故障、环境事件）
│   ├── mapData.ts               # 地图声明式数据
│   │                            #   20 栋建筑 + 8 个广场 + 11 条道路 + 3 片水域
│   ├── horrorConfig.ts          # 恐怖氛围配置
│   │                            #   光效/雾层/剧情阶段/建筑主题/环境事件/鬼域
│   ├── storyData.ts             # 剧情数据库
│   │                            #   23 个场景（4 属性 + 8 道具 + 标记位门控分支）
│   │                            #   8 个地图热点（坐标/半径/顺序）
│   │                            #   6 种结局（good/bad/true/escape/bad/death）
│   ├── storyEngine.ts           # 剧情引擎
│   │                            #   状态推进/属性变更/道具获取/标记位/结局路由/图校验
│   ├── jumpscareTexts.ts        # 多样化惊吓文字池（8 场景上下文 × 80+ 条变体）
│   ├── store.ts                 # Zustand 全局 Store
│   │                            #   玩家位置 / 鬼快照(FSM+位置+距离) / 氛围 / 小地图 / HUD / 惊吓文字
│   └── audio/
│       ├── audioManager.ts      # 音频总管
│       │                        #   BGM 播放列表 (score-1 → score-2 链式循环)
│       │                        #   SFX one-shots (shake/jumpscare/hover/ghostHit 等 10 种)
│       │                        #   剧情翻页音 (story-open.mp3, 6-sprite)
│       ├── useGameAudio.ts      # React Hook 桥接
│       └── proceduralAudio.ts   # 纯 Web Audio 程序化音效引擎（零外部文件）
│                                #   心跳(理智驱动 50→110bpm) / 脚步声(4 种地面材质)
│                                #   文字弹窗轻响 / 合成 jump scare 嘶吼 / 鬼呼吸
public/audio/
├── bgm/
│   ├── score-1.mp3              # BGM 曲目 1
│   └── score-2.mp3              # BGM 曲目 2（循环链：1→2→1→...）
├── ambient/                     # 环境音（风声常驻）
└── sfx/                         # 音效文件
    ├── shake.wav / jumpscare.wav / reveal.wav / ending.wav / death.wav
    ├── choice-select.wav / hover.wav / ghost-hit.wav / item.wav
    └── story-open.mp3           # 6-sprite 翻页音
```

## 游戏系统

### 剧情分支

23 个剧情场景，通过选择推进。每个选择可改变四项属性（理智、体力、线索、信任）、获得/消耗道具、设置标记位。道具持有和标记位会解锁或锁定后续选项。

六种结局：
- **拨云见日** (good) — 用苏婉照片揭穿陈九骗局
- **血色兄弟** (bad) — 张一诚牺牲
- **一念慈悲** (true) — 说服陈九放下
- **远走高飞** (escape) — 带白秋逃离
- **无尽噩梦** (bad) — 理智过低，真相反成牢笼
- **理智崩溃** (death) — 被鬼追上或理智归零

结局路由不是单一选择：道具持有、线索数、信任值和理智值共同决定最终离场方式。

### 地图 & 移动

紫金港校区 2.5D 等距投影地图（42×34 网格）。玩家沿道路网移动，抵达热点自动触发剧情。红色虚线引导当前目标。

三岔路口采用先分上下再分左右的智能匹配：下方只有一条、上方有两条时，按下键往下走，按左键往左上，按右键/上键往右上。

### 鬼魂 AI

五状态有限状态机：

```
hidden ──(计时)──→ stalking ⇄ chasing ──(道具)──→ retreating
                       ↓
                    ambush (在热点附近潜伏)
```

| 状态 | 速度 | 行为 |
|------|------|------|
| hidden | 0 | 不可见，等待生成计时 |
| stalking | 1.6 | 追踪玩家，保持距离 |
| ambush | 1.1 | 在下一个热点附近等待 |
| chasing | 3.2 | 全速追击，理智持续流失 |
| retreating | 3.2 | 被道具驱退，4 秒后恢复 |

鬼魂在路网上用 Dijkstra 算法寻路，每 1.35 秒刷新路线。不同 FSM 状态有不同的视觉反馈（光环亮度）。

### 属性系统

| 属性 | 范围 | 说明 |
|------|------|------|
| 理智 Sanity | 0-100 | ≤30 时画面失焦、心跳加速、眩光激活；≤0 即死 |
| 体力 Stamina | 0-100 | 过低时部分选项锁定 |
| 线索 Clues | 0-100 | 影响结局路由（高线索+低理智→噩梦结局） |
| 信任 Trust | 0-100 | 影响白秋/张一诚在终局的行为 |

### 道具系统

8 种道具通过剧情选择获取。部分选项以道具持有为前置条件。护身符在理智伤害 >5 时自动消耗抵消。镇定药和能量饮料可在侧边栏主动使用。

| 道具 | 效果 |
|------|------|
| 护身符 | 自动抵挡一次重大理智伤害 |
| 手电筒 | 黑暗区域调查降低恐惧 |
| 日记残页 | 提供千绳会旧案线索 |
| 镇定药 | 恢复 20 点理智（可主动使用） |
| 能量饮料 | 恢复 30 点体力（可主动使用） |
| 黑猫毛发 | 感知阵法和超自然冷点 |
| 门禁卡 | 打开医学院地下仓库侧门 |
| 老照片 | 苏婉 1953 年摄于浙江医学院 |

### 音频架构

```
BGM 播放列表: score-1.mp3 → score-2.mp3 → score-1... (链式循环)
环境底噪: wind.wav (常驻)
SFX one-shots: hover / choiceSelect / ghostHit / item / shake / jumpscare / reveal / ending / death
剧情推进: story-open.mp3 (6-sprite 翻页音，随机循环)
程序化合成 (纯 Web Audio API, 零文件):
  ├── 心跳: 2 个失谐 sine 振荡器 + sub-bass 层, 理智驱动 50→110bpm
  ├── 脚步声: 白噪声 → bandpass 滤波 → 指数衰减, 4 种地面材质, 620ms 步频
  ├── 文字弹窗轻响: 52Hz sine 脉冲 + delay 混响
  ├── Jump scare 嘶吼: 3 层叠加 (锯齿波扫频 + 方波 + 噪声爆裂) → Waveshaper 失真
  └── 鬼呼吸: sawtooth → lowpass, 频率/音量随距离变化
```

### 视觉特效

| 层 | 效果 |
|------|------|
| vignette | 径向暗角 (multiply 混合) |
| scanline | CRT 扫描线 |
| chromaticVeil | 红蓝色差 + 微条纹 (screen 混合) |
| bloomVeil | 径向眩光 (低理智时激活) |
| lensDirt | 镜头脏痕模拟 |
| jumpscareOverlay | 4 段闪红动画 |
| fx-low-sanity | 饱和度 0.65 + 对比度 1.22 + 色相偏移 + 模糊 0.6px |
| particleCanvas | 90 个飘浮粒子 (screen 混合) |

## 地图

紫金港校区 2.5D 等距投影，42×34 菱形网格。

- **建筑 (20 栋)**：南大门、蓝田/丹阳/翠柏/白沙宿舍、临湖餐厅、小剧场、西教学区、海洋大楼、农生环组团、医学院、基础图书馆、东 1-4 教学楼、体育馆、医学分馆、生命科学学院、环境与资源学院
- **道路 (11 条)**：红线主路、启真湖环路、宿舍区支路、白沙海洋连路、西南医学院路、图书馆东连廊、湖东行政连路、西教学区入口短路、临湖餐厅前通路、小剧场通路
- **水域**：启真湖、东西河道
- **广场 (8 个)**：南大门广场、临湖餐厅前场、启真湖西岸、图书馆入口广场、东教学区中庭、白沙小广场、小剧场前场、医学院入口空地

## 剧情线

游戏基于同名校园恐怖小说改编，8 个热点串成一条夜间调查路线：

1. **图书馆** — 23:47，借阅机吐出异常记录，林伟听到歌声
2. **白沙宿舍** — 白秋警告不要再去医学院，交出护身符
3. **临湖餐厅** — 张一诚给出医学院地下仓库门禁卡
4. **医学分馆** — 杜学民揭出千绾会旧档案
5. **医学院** — 地下仓库封条裂开，进入教学楼
6. **东教学区** — 遭遇苏婉的守护灵，拿到关键照片
7. **启真湖** — 拼合坐标，所有线索指向陈九
8. **小剧场** — 救白秋、揭露真相、最终对决

## License

MIT
