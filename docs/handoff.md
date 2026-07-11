# 浙大夜惊魂地图交接文档

## 当前目标

这是一个基于浙江大学紫金港校区的 2.5D / isometric 恐怖悬疑地图原型，用于《浙大夜惊魂》游戏地图。

当前方向不是普通校园导览图，也不是血浆怪物恐怖，而是“真实校园逐渐变成心理迷宫”：

- 医学院教学楼是全图最危险、最阴森的视觉核心。
- 医学院图书馆是故事开端地点。
- 西区沼泽田是校园秩序之外的异空间。
- 启真湖是张超与白秋记忆污染地点。
- 白沙学园是日常生活崩坏地点，重点是白沙 2 幢 123 室和白沙 3 幢 216 室。

## 运行方式

项目根目录：

```text
D:\新建文件夹\浙大地图
```

开发服务：

```bash
npm run dev -- --port 5173 --strictPort
```

当前本地服务已运行：

```text
http://127.0.0.1:5173/
```

当前监听进程：

```text
node PID 12056
```

构建检查：

```bash
npm run build
```

最近一次构建通过。Vite 仍会提示 Phaser bundle 过大，这是当前预期内的警告，不影响运行。

## 技术栈

- Vite
- React
- TypeScript
- Phaser 3
- lucide-react

## 当前重要文件

```text
src/App.tsx
src/styles.css
src/game/CampusScene.ts
src/game/mapData.ts
src/game/horrorConfig.ts
```

职责：

- `src/App.tsx`
  - React 外壳和左上角 HUD。
  - 监听 `zju-horror-atmosphere`，显示时间、状态、章节名。
- `src/styles.css`
  - 全局画面调色、暗角、噪点、扫描线、UI 异常效果。
- `src/game/mapData.ts`
  - 建筑、道路、广场、水体数据。
  - 这里保存路网点位，不要随意改建筑坐标。
- `src/game/horrorConfig.ts`
  - 恐怖氛围配置中心。
  - 包括章节、建筑主题、恐怖区域、雾层、灯源、环境事件。
- `src/game/CampusScene.ts`
  - Phaser 主场景。
  - 等距投影、地图绘制、道路吸附移动、碰撞、视觉层、现实偏移系统。

## 当前视觉系统

`CampusScene.ts` 已经从简单积木风格升级为多层视觉结构。

主要层级：

- 地面基础层：`drawGround`
- 西区沼泽田：`drawSwampField`
- 水体：`drawWater`
- 启真湖记忆污染：`drawLakeMemoryEffects`
- 广场：`drawPlazas`
- 道路：`drawRoads`
- 地面 decal：`drawGroundDecals`
- 植被：`drawGreenery`
- 建筑：`drawBuildings` / `drawIsoPrism`
- 建筑污损细节：`drawBuildingSurfaceDetails`
- 剧情物件：`drawStoryProps`
- 局部光照：`drawLightLayer` / `drawLampPosts`
- 异常光斑：`drawMapAnomalies`
- 方位标签：`drawOrientationLabels`
- 前景黑影遮挡：`drawForegroundShadows`
- 动态雾：`updateFog`

已有视觉元素：

- 医学院教学楼：青灰、冷白、尸绿色；六楼冷窗、闪烁窗、警戒线、水渍、落叶、废弃自行车、入口黑影、厕所镜面异常、仓库人体模型影子。
- 医学院图书馆：冷、安静、秩序感，门口阴影深。
- 西区沼泽田：黑绿水洼、泥地、杂草、低雾、白色人影轮廓、黑藤向医学院延伸。
- 启真湖：已调成蓝色水体，带低雾、错位倒影、玩家延迟倒影、白色异常倒影、水草/头发状黑线。
- 白沙学园：标出 `2幢123` 和 `3幢216`，216 窗光会随现实偏移变冷。
- 小剧场：暗紫黑，破海报、入口黑影，用作唱戏声误导点。
- 基础图书馆：深红褐、压迫、档案感，但不要比医学院更恐怖。
- 东 1-4 教学楼：重复空间阴影差异。

## 恐怖配置系统

主要配置在 `src/game/horrorConfig.ts`。

核心配置：

- `defaultStoryStage`
  - 当前默认是 `3`，即“夜探医学院”。
- `stageProfiles`
  - 支持 5 个阶段：
    - stage 1：深夜自习
    - stage 2：李伟豪死亡后
    - stage 3：夜探医学院
    - stage 4：真相逼近
    - stage 5：返回浙大
- `buildingThemes`
  - 控制建筑主题色、替换标签、错误标签。
- `horrorZones`
  - 控制医学院、医学图书馆、沼泽、启真湖、白沙、阳明桥、小剧场的影响范围。
- `fogLayers`
  - 控制不同区域雾层。
- `lightSources`
  - 控制局部灯光半径、颜色、闪烁。
- `ambientEvents`
  - 控制 UI 状态异常，如 `监控死角`、`六楼有声音`、`路线重复`。

如果要调气氛，优先改 `horrorConfig.ts`，不要先去 `CampusScene.ts` 里硬编码。

## 现实偏移系统

`CampusScene.ts` 里已有轻量状态：

```ts
private storyStage: StoryStage = defaultStoryStage;
private realityDistortion = stageProfiles[defaultStoryStage].baseDistortion;
```

`updateAtmosphere` 每帧根据玩家接近以下区域的程度更新偏移值：

- 医学院
- 医学院图书馆
- 西区沼泽田
- 启真湖
- 白沙学园
- 阳明桥
- 小剧场

该值影响：

- 全屏雾强度
- 手电稳定度
- 标签错乱
- UI 时间/状态异常
- 医学院六楼窗光
- 医学院白衣剪影
- 医学院脚影/镜面/仓库异常
- 启真湖白衣倒影
- 白沙 216 窗光
- 西区沼泽鬼打墙

## 当前移动系统

玩家使用 WASD 或方向键移动。

移动不是自由行走，而是：

- 广场内允许自由移动。
- 道路附近吸附到最近道路中心线。
- 在道路端点附近识别岔路。
- 建筑和水体阻挡移动。

关键常量在 `CampusScene.ts`：

```ts
const PLAYER_SPEED = 4.2;
const ROAD_SNAP_RADIUS = 0.72;
const ROAD_JUNCTION_RADIUS = 1.12;
```

转向逻辑核心：

- `getInputVector`
- `resolveRailMovement`
- `currentRailDirections`
- `nearbyJunctionDirections`
- `toScreenDelta`

如果继续优化北侧跨湖路口的 A/左、上键/上方向体验，优先看这些函数。

## 当前路网状态

道路数据在 `src/game/mapData.ts` 的 `campusRoads`。

最近几轮重点调整：

- 删除了多条重复/重叠道路。
- 西教学区环路已简化为短入口路。
- 临湖餐厅南侧穿楼/穿路问题已处理。
- 小剧场门口路已改成直线，去掉多余折点。
- 新增 `baisha-ocean-link`，连接白沙和海洋大楼旁的西侧道路。
- 北侧跨湖路口调整了 `lake-loop` 西北支线点位，让上键更容易走上方支线，A/左更容易走左侧路。
- 启真湖水体颜色已单独预校正，经过全局滤镜后仍显示为蓝色。

当前主要道路：

- `south-main-axis`
- `lake-loop`
- `dorm-branch`
- `baisha-ocean-link`
- `west-medical-road`
- `library-east-link`
- `lake-admin-bridge`
- `west-teaching-grid`

## UI 状态

`App.tsx` 只保留轻量 HUD：

- 标题：浙大夜惊魂
- 当前章节名
- 时间
- 状态

场景通过以下事件驱动 UI：

```ts
window.dispatchEvent(new CustomEvent<HorrorAtmosphereEvent>("zju-horror-atmosphere", { detail }));
```

状态可能短暂变为：

- 校园静默
- 信号异常
- 监控死角
- 有人在楼道里
- 六楼有声音
- 路线重复

时间可能短暂跳为：

- `02:26`
- `02:27`

## 当前工作区状态

当前仍有未提交变更。

修改文件：

```text
src/App.tsx
src/game/CampusScene.ts
src/game/mapData.ts
src/styles.css
src/game/horrorConfig.ts
HANDOFF.md
```

注意：

- `HANDOFF.md` 和 `src/game/horrorConfig.ts` 当前是未跟踪文件。
- `HANDOFF.md` 已替换成当前新版交接文档。
- 还有一个旧的 `HANDOFF.md` 版本曾经内容过时且中文显示乱码，已被新版覆盖。

## 已验证

最近一次执行：

```bash
npm run build
```

结果通过。

本地服务：

```text
http://127.0.0.1:5173/
```

HTTP 返回正常。

## 重要注意事项

1. 不要把地图重新推翻重写。
   - 当前结构已经有可扩展的视觉层和配置层。
2. 不要轻易改建筑坐标。
   - 用户很关心相对位置和路网可走性。
3. 不要把恐怖做成血浆怪物。
   - 当前方向是校园怪谈、心理惊悚、记忆封锁、现实与幻觉边界。
4. 医学院应始终是最强视觉中心。
5. 启真湖应保持蓝色，但可以继续做记忆污染和倒影异常。
6. 若调色后看不清，优先调：
   - `styles.css` 中 `.gameCanvas canvas` 的 `brightness`
   - `.vignette` 的黑色 alpha
   - `CampusScene.ts` 中 `updateFog` 的全屏遮罩强度
7. 若路口转向不顺，优先改路网点位，其次再改 `currentRailDirections` 逻辑。

## 推荐下一步

优先级从高到低：

1. 用 Playwright 或截图工具做一次实际视觉 QA。
   - 当前环境未安装 Playwright。
   - 如果安装，建议检查桌面和移动视口。
2. 优化北侧跨湖路口的输入判定。
   - 如果用户仍觉得 A/上键不准，可能需要在 `resolveRailMovement` 中加入路口输入优先级。
3. 为 `storyStage` 加调试切换。
   - 例如数字键 1-5 切章节，方便测试五个阶段。
4. 将道路从折线数组升级成显式节点图。
   - 当前靠端点半径识别岔路，复杂路口会有歧义。
5. 给医学院区域添加更具体的章节触发。
   - 第一次经过听见唱戏声。
   - 第二次经过六楼白衣剪影。
   - 靠近入口出现黑鞋白裙脚影。
6. 添加音频系统。
   - 低频环境声、路灯电流、远处戏声、湖面敲水声。
   - 注意要克制，不要做廉价 jumpscare。

## 给下一个 AI 的简短路线

如果用户继续要求视觉增强：

1. 先看 `horrorConfig.ts`。
2. 再看 `CampusScene.ts` 的这些函数：
   - `drawGroundDecals`
   - `drawBuildingSurfaceDetails`
   - `drawLightLayer`
   - `drawForegroundShadows`
   - `updateAtmosphere`
   - `updateFog`
3. 视觉问题优先调层级和 alpha，不要先改地图数据。

如果用户继续要求路网调整：

1. 先看 `mapData.ts` 的 `campusRoads`。
2. 改完必须跑：

```bash
npm run build
```

3. 然后打开 `http://127.0.0.1:5173/` 用 WASD/方向键实际走一遍。
