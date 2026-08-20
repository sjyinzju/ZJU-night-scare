# 3D 内景交付与接入约定

这份约定给建模和程序两边共用。建模同学按这里导出，程序侧不需要重新手填一遍坐标。

## 交付格式

- 使用 **glTF 2.0**。
- 首选单文件 `scene.glb`；它会把网格、材质和贴图打在一起，最不容易漏文件。
- 也支持 `scene.gltf`。这种格式的 `.bin` 和贴图必须一起交付，并保持 glTF 中的相对路径不变。
- 桌面版文件名默认是 `scene.glb`，移动端低模默认是 `scene.lod.glb`。
- Blender 单位用米，`1 Blender Unit = 1 米`；人物眼高按 `1.6 米` 检查。
- 导出前应用缩放和旋转（Apply Transform），不要用负缩放。
- 场景以 Y 轴向上。Blender 的 glTF 导出器会自动完成 Z-up 到 Y-up 的转换，不要再手工转一次。

## Blender 节点命名

节点名区分大小写，前缀必须全大写。前缀后面的部分是游戏业务 ID。

| 前缀 | 用途 | 例子 | 运行时处理 |
| --- | --- | --- | --- |
| `VIS_` | 普通可见模型 | `VIS_wall_north` | 保持显示 |
| `COL_` | 低面数碰撞网格 | `COL_wall_north` | 自动识别并隐藏 |
| `TRG_` | 剧情/出口触发点 | `TRG_ghost_choice` | 自动识别并隐藏 |
| `PICK_` | 道具落点 | `PICK_key_card` | 自动识别并隐藏 |
| `DOOR_` | 门扇或门轴根节点 | `DOOR_archive` | 保持显示，原点放在铰链处 |
| `HIDE_` | 可躲藏位置 | `HIDE_locker_01` | 自动识别并隐藏 |
| `SPAWN_` | 玩家出生点 | `SPAWN_player` | 自动识别并隐藏 |
| `BOUNDS_` | 可行走区域外框 | `BOUNDS_room` | 自动识别并隐藏 |

Blender 自动产生的 `.001` 后缀会被去掉。例如 `COL_wall.001` 的业务 ID 仍是 `wall`。同一种前缀下不要重复业务 ID，否则加载器会给出警告。

`COL_` 和 `BOUNDS_` 必须是有实际尺寸的低面数网格，不能只是 Empty。`TRG_`、`PICK_`、`SPAWN_` 可以使用 Empty。门的根节点原点必须放在铰链处，门板作为它的子节点，这样程序旋转根节点就能自然开门。

## 文件目录

每个内景一个目录：

```text
public/models/interiors/<building-id>/
├── scene.glb
├── scene.lod.glb          # 可选，移动端低模
└── scene.meta.json        # 推荐，资源清单和兼容信息
```

仓库里的 GLB/glTF 和 `.bin` 默认被 Git 忽略，生产环境通过 `VITE_ASSET_CDN_URL` 指向的 R2/CDN 加载。小型的 `scene.meta.json` 可以提交到 Git。

## 接入开关

模型上传完成后，在 `src/game/interior3d/InteriorAssetRegistry.ts` 找到对应建筑，把 `enabled` 改为 `true`。现在已经预留：

- `medical-library` 医学分馆
- `medical-college` 医学院
- `dorm-baisha` 白沙宿舍
- `little-theater` 小剧场

加载失败时，游戏继续显示原来的程序生成房间，不会黑屏。加载过程会发送 `zju-horror-interior-asset-state` 浏览器事件，状态为 `loading`、`loaded` 或 `error`，后面可以直接接进度条和错误提示。

加载后的 `InteriorAssetHandle.nodes` 已经按节点类型分组，碰撞、触发点、拾取点、门、躲藏点等后续逻辑可以直接绑定，不需要再遍历一遍模型。当前版本只建立并校验这层接口；在正式启用某个模型前，还要用该模型逐项核对碰撞和剧情 ID。

## `scene.meta.json`

`scene.meta.json` 是可选清单。最小内容如下：

```json
{
  "assetVersion": 1,
  "contractVersion": 1,
  "buildingId": "medical-college",
  "roomKind": "medical",
  "model": "scene.glb",
  "lodModel": "scene.lod.glb"
}
```

可直接复制 `public/models/interiors/_template/scene.meta.example.json`。如果不提供清单，加载器使用注册表中的默认文件名。

## 交付前自查

- 从入口到出口完整走一遍，不穿墙、不被看不见的碰撞挡住。
- `COL_` 只保留简单墙体和家具轮廓，不复制高模做碰撞。
- `TRG_` 后面的 ID 与剧情里的 `sceneId` 完全一致。
- `PICK_` 后面的 ID 与物品 `itemId` 完全一致。
- 桌面版建议控制在 10–20 MB；移动版建议 3–8 MB。
- 普通贴图以 1K 为主，只有会近距离观察的关键物品使用 2K。
