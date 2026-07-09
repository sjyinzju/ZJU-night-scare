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
| E | 触发剧情（抵达任务地点时自动弹出） |
| I | 切换道具栏 |

> 三岔路口方向匹配：先分上下再分左右。按下键优先选下方分支，按左键优先选同侧。

## 技术栈

| 层 | 技术 |
|----|------|
| 游戏引擎 | [Phaser 3](https://phaser.io/) — 2.5D 等距地图渲染、道路移动系统、物理碰撞 |
| UI 框架 | [React 19](https://react.dev/) + TypeScript |
| 状态管理 | [Zustand](https://zustand.docs.pmnd.rs/) — React ↔ Phaser 共享 Store |
| 音频 | [Howler.js](https://howlerjs.com/) — BGM 播放列表 + SFX；Web Audio API — 程序化心跳/脚步声/鬼呼吸/合成 jump scare |
| 构建 | [Vite 6](https://vitejs.dev/) |
| 图标 | [Lucide React](https://lucide.dev/) |
| 样式 | CSS 自定义恐怖主题变量 (暗角、扫描线、色差、眩光、镜头脏痕) |

## 项目结构

```
src/
├── App.tsx                      # React 主界面（HUD状态栏、任务链、道具栏、小地图Canvas、剧情弹窗）
├── main.tsx                     # React 入口
├── styles.css                   # 全局样式 + 恐怖主题 + 后处理滤镜
├── game/
│   ├── CampusScene.ts           # Phaser 场景（~2700行）
│   │                            #   地图渲染（9层 depth-sorted）
│   │                            #   道路移动系统（方向吸附/交汇转向/广场自由移动）
│   │                            #   鬼魂 FSM（5状态：hidden/stalking/ambush/chasing/retreating）
│   │                            #   引导虚线（Dijkstra寻路）
│   │                            #   氛围系统（雾气、闪光、震屏、标签故障、环境事件）
│   ├── mapData.ts               # 地图声明式数据
│   │                            #   20栋建筑 + 8个广场 + 10条道路 + 3片水域
│   ├── horrorConfig.ts          # 恐怖氛围配置
│   │                            #   光效/雾层/剧情阶段/建筑主题/环境事件/鬼域
│   ├── storyData.ts             # 剧情数据库（~600行）
│   │                            #   23个场景（4属性+8道具+标记位门控分支）
│   │                            #   8个地图热点（坐标/半径/顺序/npc对话）
│   │                            #   5种结局（good/bad/true/escape/death）
│   ├── storyEngine.ts           # 剧情引擎
│   │                            #   状态机推进/统计变更/道具获取/标记位/结局路由
│   ├── jumpscareTexts.ts        # 多样化惊吓文字池（8场景上下文 × 80+条变体）
│   ├── store.ts                 # Zustand 全局 Store
│   │                            #   玩家位置 / 鬼快照(FSM+位置+距离) / 氛围 / 小地图 / HUD
│   └── audio/
│       ├── audioManager.ts      # 音频总管
│       │                        #   BGM播放列表(score-1→score-2链式循环)
│       │                        #   SFX one-shots (shake/jumpscare/hover/ghostHit等10种)
│       │                        #   剧情翻页音(story-open.mp3, 6-sprite)
│       └── useGameAudio.ts      # React Hook 桥接
│       └── proceduralAudio.ts   # 纯Web Audio程序化音效引擎（零外部文件）
│                                #   心跳(理智驱动50→110bpm) / 脚步声(4材质)
│                                #   文字弹窗轻响 / 合成jump scare嘶吼 / 鬼呼吸
public/audio/
├── bgm/
│   ├── score-1.mp3              # BGM曲目1
│   └── score-2.mp3              # BGM曲目2（循环链：1→2→1→...）
├── ambient/                     # 环境音（风声常驻）
├── sfx/                         # 10个音效文件
│   ├── shake.wav / jumpscare.wav / reveal.wav / ending.wav / death.wav
│   ├── choice-select.wav / hover.wav / ghost-hit.wav / item.wav
│   └── story-open.mp3           # 6-sprite 翻页音
```

## 游戏系统

### 剧情分支

23 个剧情场景，通过选择推进。每个选择可改变四项属性（理智、体力、线索、信任）、获得/消耗道具、设置标记位。标记位和道具持有状态会解锁或锁定后续选项。

五条结局路线：
- **拨云见日** (good) — 用苏婉照片揭穿陈九
- **血色兄弟** (bad) — 张一诚牺牲
- **一念慈悲** (true) — 说服陈九放下
- **远走高飞** (escape) — 带白秋逃离
- **无尽噩梦** (bad) — 理智崩溃被困精神病院
- **理智崩溃** (death) — 直接死亡

### 地图 & 移动

紫金港校区 2.5D 等距投影地图（42×34 网格）。玩家沿道路网移动，在三岔路口自动吸附到正确分支。广场区域允许自由移动。红色虚线引导玩家前往当前任务热点。

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
| stalking | 1.6 | 追踪玩家，保持4.5距离 |
| ambush | 1.1 | 在下一个热点附近等待 |
| chasing | 3.2 | 全速追击，理智持续流失 |
| retreating | 3.2 | 被道具驱退，4秒后恢复 |

鬼魂使用 Dijkstra 算法在路网上寻路，每 1.35 秒刷新路线。

### 属性系统

| 属性 | 图标 | 范围 | 说明 |
|------|------|------|------|
| 理智 Sanity | 🧠 | 0-100 | ≤30 时画面失焦/心跳加速/眩光激活；≤0 即死 |
| 体力 Stamina | 💪 | 0-100 | 过低时部分选项锁定 |
| 线索 Clues | 🔍 | 0-100 | 影响结局路由（高线索+低理智→噩梦结局） |
| 信任 Trust | ❤️ | 0-100 | 影响白秋/张一诚在终局是否帮助你 |

### 道具系统

8 种道具，通过剧情选择获取（50%概率随机掉落）。部分选项以道具为前置条件。护身符在理智伤害 >5 时自动消耗抵消。

| 道具 | 效果 |
|------|------|
| 护身符 | 自动抵挡一次重大理智伤害 |
| 手电筒 | 黑暗区域调查降低恐惧（理智减免） |
| 日记残页 | 提供千绳会旧案线索 |
| 镇定药 | 恢复20点理智（可主动使用） |
| 能量饮料 | 恢复30点体力（可主动使用） |
| 黑猫毛发 | 感知阵法和超自然冷点 |
| 门禁卡 | 打开医学院地下仓库侧门 |
| 老照片 | 苏婉1953年摄于浙江医学院 |

### 音频架构

```
BGM 播放列表: score-1.mp3 → score-2.mp3 → score-1... (链式循环)
环境底噪: wind.wav (常驻, 0.06音量)
SFX one-shots: 10个WAV/MP3文件
程序化合成 (纯Web Audio API, 零文件):
  ├── 心跳: 2个失谐sine振荡器 + sub-bass层 (34→16Hz, 理智驱动50→110bpm)
  ├── 脚步声: 白噪声→bandpass滤波→指数衰减 (4种地面材质, 620ms步频)
  ├── 文字弹窗轻响: 52Hz sine脉冲 + delay混响 (替代whisper WAV)
  ├── Jump scare嘶吼: 3层叠加 (锯齿波扫频+方波+噪声爆裂) → Waveshaper失真
  └── 鬼呼吸: sawtooth→lowpass, 频率/音量随距离变化
```

### 视觉特效

| 层 | 效果 |
|------|------|
| vignette | 径向暗角 (multiply混合) |
| scanline | CRT扫描线 (4px间隔) |
| chromaticVeil | 红蓝色差 + 微条纹 (screen混合) |
| bloomVeil | 径向眩光 (低理智时激活) |
| lensDirt | 镜头脏痕模拟 |
| jumpscareOverlay | 4段闪红动画 (0→92%→35%→0) |
| fx-low-sanity | saturate(0.65) + contrast(1.22) + hue-rotate(-12°) + blur(0.6px) |
| particleCanvas | 90个飘浮粒子 (screen混合) |

## 地图

紫金港校区 2.5D 等距投影，42×34 菱形网格。

- **建筑 (20栋)**：南大门、蓝田/丹阳/翠柏/白沙宿舍、临湖餐厅、小剧场、西教学区、海洋大楼、农生环组团、医学院、基础图书馆、东1-4教学楼、体育馆、医学分馆、生命科学学院、环境与资源学院
- **道路 (11条)**：红线主路、启真湖环路、宿舍区支路、白沙海洋连路、西南医学院路、图书馆东连廊、湖东行政连路、西教学区入口短路、临湖餐厅前通路、小剧场通路
- **水域**：启真湖、东西河道
- **广场 (8个)**：南大门广场、临湖餐厅前场、启真湖西岸、图书馆入口广场、东教学区中庭、白沙小广场、小剧场前场、医学院入口空地

## 剧情线

游戏基于同名校园恐怖小说改编：

1. **序章** — 图书馆自习，林伟听到歌声
2. **坠楼** — 林伟从教学楼坠落，监控拍到绣花鞋
3. **白秋** — 女友白秋警告不要再去医学院
4. **论坛** — 发现校园传说帖子，千绳会浮出水面
5. **张一诚** — 好兄弟透露白秋人格分裂，给出地下仓库门禁卡
6. **杜学民** — 心理医生揭露千绳会灵魂转移仪式
7. **深入医学院** — 遭遇古装女人（苏婉的守护灵）
8. **逼近真相** — 假杜学民（陈九）身份曝光
9. **终局** — 5月9日地下车库，最终对决

## License

MIT
