# ZJU Night Scare 浙大夜惊魂

2.5D 等距视角恐怖探索游戏，以浙江大学紫金港校区为背景。

## 本地启动

```bash
# 1. 克隆仓库
git clone https://github.com/sjyinzju/ZJU-night-scare.git
cd ZJU-night-scare

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev

# 4. 浏览器打开 http://127.0.0.1:5173
```

## 操作

| 按键 | 功能 |
|------|------|
| WASD / 方向键 | 移动角色 |
| E | 交互（抵达任务地点时） |

## 技术栈

| 层 | 技术 |
|----|------|
| 游戏引擎 | [Phaser 3](https://phaser.io/) — 2.5D 等距地图渲染、物理碰撞 |
| UI 框架 | [React 19](https://react.dev/) + TypeScript |
| 构建工具 | [Vite 6](https://vitejs.dev/) |
| 样式 | CSS（自定义恐怖主题变量） |

## 项目结构

```
src/
├── App.tsx                    # React 主界面（故事面板、HUD、小地图）
├── styles.css                 # 全局样式 + 恐怖主题 + 画布颜色滤镜
├── game/
│   ├── CampusScene.ts         # Phaser 场景（地图渲染、移动系统、鬼魂 AI）
│   ├── mapData.ts             # 地图数据（建筑、道路、水域、广场）
│   ├── horrorConfig.ts        # 恐怖氛围配置（光效、雾层、剧情阶段）
│   └── storyData.ts           # 故事剧情数据（场景、对话、结局）
├── main.tsx                   # React 入口
└── index.html                 # HTML 入口
```

## 地图

- **红线主路**：贯穿校园南北的主干道
- **启真湖环路**：绕湖一周的步道
- **建筑**：紫金港南大门、基础图书馆、医学院、小剧场、临湖餐厅、各宿舍区等
- 地图采用 2.5D 等距投影，CSS `hue-rotate(165deg)` 滤镜将暖色基调转为冷色夜景
