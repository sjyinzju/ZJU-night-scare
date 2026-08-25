# AGENTS.md

本文件是仓库级开发说明，适用于整个项目。修改代码、3D 场景、剧情或部署配置前，先阅读本文件。

## 项目概览

“浙大夜惊魂”是一个以浙江大学紫金港校区为背景的恐怖探索游戏，包含两种主要游玩空间：

- 校园外景：Phaser 3 驱动的 2.5D 等距地图、道路移动、热点、鬼魂追逐和任务导航。
- 建筑内景：Three.js 驱动的第一人称 3D 场景，包含碰撞、手电筒、实体道具、剧情触发点、跳脸、出口与场景状态变化。

React 负责游戏壳层、开场、HUD、剧情文本、道具栏、剧情链、小地图和场景切换；Zustand 负责 React、Phaser 与 Three.js 之间的共享状态。

## 技术栈与入口

- React 19 + TypeScript：UI、剧情弹层和整体编排。
- Phaser 3：校园 2.5D 地图。
- Three.js：建筑 3D 内景。
- Zustand：全局游戏状态。
- Howler.js + Web Audio API：文件音频与程序化音效。
- Vite 6：本地开发和生产构建。

主要入口：

- `game/index.html`：Vite 游戏页面入口。
- `src/main.tsx`：React 入口。
- `src/App.tsx`：游戏主编排层，连接开场、外景、内景、剧情弹层、跳脸和状态机命令。
- `site/`：GitHub Pages 根路径上的静态项目首页。
- `pitch/`：独立展示页面。

## 代码架构

### React 与剧情层

- `src/App.tsx`
  - Phaser 与 3D 内景的挂载和切换。
  - 毛玻璃剧情/文档弹层、选项反馈、跳脸图片与剧情流程衔接。
  - 不应在此处硬编码公共资源根地址；资源必须经过 `assetUrl()`。
- `src/LaunchSequence.tsx`
  - 开场、玩法说明和前言。
- `src/game/storyData.ts`
  - 剧情文本、选项、属性影响、道具和场景 ID 的声明式数据。
- `src/game/storyEngine.ts`
  - 剧情推进、选择结果、道具获取、标记位、室内出口和后续场景路由。
- `src/game/store.ts`
  - 玩家属性、背包、当前位置、鬼魂快照、HUD 和共享游戏状态。
- `src/game/jumpscareTexts.ts`
  - 跳脸时的随机恐怖文字池。
- `src/game/JumpscarePipeline.ts`
  - 跳脸时序和统一效果管线。

### 校园 2.5D 外景

- `src/game/CampusScene.ts`：Phaser 主场景、移动、道路、热点、鬼魂 FSM、小地图数据和外景交互。
- `src/game/mapData.ts`：建筑、道路、水域和广场数据。
- `src/game/mapGraph.ts`：路网与寻路。
- `src/game/horrorConfig.ts`、`src/game/horrorDirector.ts`：恐怖氛围和事件调度。
- `src/game/visualFxPipeline.ts`：外景视觉特效。

### 建筑 3D 内景

- `src/game/interior3d/Interior3D.ts`
  - Three.js 场景生命周期、玩家移动、碰撞、互动、故事触发、坠楼揭示、灯光和小地图快照。
  - 静态 GLB 加载失败时会退回程序化内景；这个回退只能防止彻底崩溃，不能视为新版场景正常加载。
- `src/game/interior3d/InteriorAssetLoader.ts`
  - 建筑/房间到 GLB、附加 GLB 和元数据的映射。
  - 医学院图书馆当前运行时资产位于 `models/interiors/library/`。
- `src/game/interior3d/InteriorCollisionMap.ts`：从静态场景生成/维护碰撞数据。
- `src/game/interior3d/InteriorOverlay.tsx`：内景 HUD、道具栏、剧情链和小地图。
- `src/game/interior3d/FlashlightSystem.ts`：手电筒照明。
- `src/game/interior3d/buildRoom.ts`：程序化房间与回退交互结构。
- `src/game/interior3d/stateMachine/`：玩家移动状态机；剧情流程仍由 `storyData.ts`、`storyEngine.ts` 和 `App.tsx` 统一推进。

### 音频

- `src/game/audio/audioManager.ts`：BGM、环境音和文件型 SFX；所有文件 URL 必须通过 `assetUrl()` 的根路径生成。
- `src/game/audio/proceduralAudio.ts`：雷声、冲击声、心跳、脚步和其他程序化音效。
- `src/game/audio/useGameAudio.ts`：React 与音频系统的桥接。

### 3D 资产生产

- `3D_Assets/`：Blender、FBX、OBJ、贴图等源资产，仅用于本地制作，不进入 Git。
- `tools/build_library_scene01.py`：构建医学院图书馆场景一的运行时资产。
- `tools/probe_library_surfaces.py`、`tools/render_library_topdown.py`、`tools/inspect_library_glb.py`：定位、俯视检查和 GLB 检查工具。
- `public/models/interiors/library/scene01.meta.json`：场景一的生成结果元数据和玩法锚点，包括出生点、拾取点、剧情点、候选书架点、坠楼揭示、出口和碰撞清理区域。

调整实体位置时，应优先修正构建脚本或元数据，再重新生成运行时 GLB；不要只在 React 层叠加一个与模型脱节的临时坐标。

## 双线资源加载机制

项目必须同时支持本地开发和 GitHub Pages 在线游玩。两种环境共用 `src/game/assetPath.ts` 中的 `assetUrl(relativePath)`，但资源根路径不同。

### 本地开发线

`.env` 中：

```env
VITE_ASSET_CDN_URL=
```

当 CDN 地址为空时，`assetUrl()` 使用 Vite 的 `BASE_URL`，资源从本地 `public/` 目录加载。例如：

```ts
assetUrl("models/interiors/library/library.glb")
```

本地运行时对应仓库文件：

```text
public/models/interiors/library/library.glb
```

### 生产部署线

`.env.production` 中：

```env
VITE_ASSET_CDN_URL=https://pub-7e9d655df8eb4014b5e6f75e1dd00989.r2.dev/public
```

`npm run build` 使用生产环境变量，所有通过 `assetUrl()` 加载的模型、音频、图片和元数据都改为从 Cloudflare R2 获取。例如：

```text
https://pub-7e9d655df8eb4014b5e6f75e1dd00989.r2.dev/public/models/interiors/library/library.glb
```

因此 R2 bucket 中必须保留顶层 `public/` 前缀：

```text
public/
├── models/
├── images/
└── audio/
```

不要上传成 `public/public/...`，也不要把 R2 基地址改到没有与对象键同步的目录。

### 资源编码规则

1. 任何运行时公共资源都必须使用 `assetUrl()`；不要写死 `/public/...`、`/models/...`、localhost 地址或 R2 完整 URL。
2. `assetUrl()` 的参数是相对于本地 `public/` 的路径，且区分大小写。Windows 本地可容忍的大小写错误，在 R2 上会变成 404。
3. 模型元数据 JSON 同样走 R2。生产环境不会因为 JSON 已提交到 Git 就自动读取仓库中的版本。
4. 修改同名 GLB 或图片后要考虑浏览器/CDN 缓存；发布后必须用精确资源 URL 验证，并进行强制刷新。必要时采用版本化文件名或查询参数。
5. 不要删除本地资源回退机制；本地开发必须在没有 R2 和网络的情况下可运行。

## 场景一运行时资源

医学院图书馆由 `InteriorAssetLoader.ts` 中的 `medical-library:library` 映射加载。核心文件为：

```text
public/models/interiors/library/scene01.meta.json
public/models/interiors/library/library.glb
public/models/interiors/library/library-scene01-props.glb
public/images/jumpscares/library-shelf-ghost.png
public/images/jumpscares/library-fall-ghost.png
```

其中：

- `library.glb`：主体建筑、书架区、室外区域、林伟坠楼人物和已有路灯等主场景内容。
- `library-scene01-props.glb`：手电筒、笔记本、小票、符咒和出口门等附加资产。
- `scene01.meta.json`：所有交互和剧情锚点。更新 GLB 时通常也需要同步更新它。
- 两张 PNG：状态机统一调用的剧情跳脸图。

只同步模型、不上传元数据，会导致拾取点、剧情四、人物揭示、地图标记或出口继续使用旧配置或失效。

## GitHub Pages 与 R2 的职责边界

`.github/workflows/deploy.yml` 只在 `main` 分支推送或手动触发时部署 GitHub Pages。工作流会发布：

- `site/*` 到站点根路径。
- `dist/game/*` 和 `dist/assets` 到 `/game/`。
- `pitch/` 的展示文件。

该工作流不会把本地 `public/` 自动上传到 R2，也不会把大型 GLB、音频和跳脸图片打包进 GitHub Pages。R2 同步是独立发布步骤。

发布判断：

- 仅改 TypeScript、React、CSS、剧情数据或状态机：提交并合并到 `main`，等待 Pages Action 成功。
- 仅改 GLB、图片、音频或生产元数据：同步 R2；如果元数据也纳入 Git 管理，则同时提交该 JSON。
- 同时改代码和资源：Pages 与 R2 两边都必须更新，缺一不可。
- 推送到功能分支不会更新线上 Pages，除非之后合并到 `main` 或手动采用明确的部署流程。

## Git 与大文件约定

`.gitignore` 有意忽略：

- `public/models/**/*.glb`
- `public/audio/**/*.wav`
- `public/audio/**/*.mp3`
- 常规 PNG/JPG/WebP 资产
- 整个 `3D_Assets/`

不要为了“让 GitHub Pages 找到资源”而强制提交这些大文件。生产网页本来就应从 R2 加载它们。可审查的小型元数据、构建脚本和代码应进入 Git；大型二进制运行时资产进入 R2；原始制作资产保留本地。

仓库可能包含用户未提交的 Blender 文件、模型和生成结果。不要清理、移动、覆盖或重建不在当前任务范围内的资产。

## 3D 内景视觉无损性能约定

- 优先减少 CPU、JS、React 和 Zustand 浪费；未明确进入画质调优阶段时，不得降低 DPR、抗锯齿、阴影、灯光、材质、纹理、雾、FOV 或模型质量。
- stamina 由 `Interior3D` 内部 float 作为运行时权威值，只在整数变化且不超过 10 Hz 时同步 Store，并必须接收剧情系统的外部真实修改；相同值不得触发 Store 写入。
- 帧循环中复用输入快照，缓存稳定的 inventory、剧情阶段、道具/触发点引用和小地图静态数据；React state 与剧情可见性仅在值真正变化时更新。
- 静态 collider 可在玩家未发生 XZ 移动时跳过无意义 penetration 扫描；移动时必须保留原碰撞算法和结果。更复杂的碰撞索引需先有 profiler 证据。
- 使用 `?perfInterior=1` 开启开发专用的每秒性能日志；正常模式不显示且应保持近零额外开销。性能报告不得虚构无法可靠测量的 FPS。

## 开发与验证

安装与运行：

```bash
npm install
npm run dev
```

生产构建验证：

```bash
npm run build
```

每次修改至少执行与改动风险相称的验证：

1. `npm run build` 必须通过，确认 TypeScript 与 Vite 构建无误。
2. 本地打开游戏，确认资源来自本地 `public/`，不要依赖本机已缓存的 R2 文件。
3. 场景一改动应完整验证：手电筒 → 笔记本剧情一 → 小隔间小票及跳脸 → 符咒 → 随机书架剧情三 → 室外距离触发剧情四 → 人物/路灯揭示 → 出口 → 返回校园 2.5D 地图。
4. R2 发布后逐一检查新增或修改资源 URL 返回 200，并确认 CORS 允许 GitHub Pages 来源。
5. 在线检查浏览器控制台和 Network：不应出现模型、JSON、音频或跳脸图片 404。
6. 更新同名资源后强制刷新，排除旧缓存后再判断是否修复。

本地场景一可使用 `?debugScene01=1` 暴露开发期 QA 辅助，但正常玩家流程不能依赖调试入口。

## 修改原则

- 剧情、道具、跳脸和出口顺序由统一状态推进控制，不要为单个视觉效果创建绕开剧情引擎的第二套流程。
- 新增剧情点、道具说明或图片出现前的叙事文字时，必须先对照 `App.tsx` 已实现的前言/剧情点表现和医学院图书馆场景一；默认复用无边框的 `storyGlassBackdrop`、`storyModal`、`storyText`、`choiceList`、`choiceButton` 体系。除非策划明确要求文档、终端、论坛等实体界面，不得自行设计带卡片边框、底色或阴影的文本框，也不得凭空猜测一种新的弹框样式。无标题/无选项的过场只是省略相应元素，文字排版、逐段出现、毛玻璃背景和消散方式仍应沿用现有剧情表现。
- 距离触发点与实体拾取点要区分：实体目标可以显示红光和小地图红点；纯距离惊吓按策划要求保持不可预告。
- 对剧情文字、模型锚点、地图目标和实际碰撞的修改必须一起核对，避免 UI 指引与 3D 实体错位。
- 保留失败回退，但不能把程序化回退当作生产验收通过。
- 避免无关重构，保留用户已有改动，并在修改生成资产前确认其来源脚本。
