# 紫金港东区外景样板（Blender）

这是外景地图的几何源文件样板。当前游戏运行时仍由 `src/game/mapData.ts`
提供路线、入口和建筑业务坐标；`CampusScene.ts` 只替换可见的几何绘制层，
所以室内、剧情、碰撞和红鬼寻路不需要改接口。

## 这次样板包含

- 启真湖、湖心岛；
- 白沙 1/2/3/4 舍及大厅；
- 月牙楼；
- 小剧场 A/B 座；
- 农医馆、医学院、基础图书馆和东教学区的定位体块；
- 固定正交相机、卡通材质、黑色轮廓、窗灯和少量悬疑红光。

## 单栋建筑工作流

`buildings/<id>/<id>.blend` 是单栋可编辑源文件；当前已生成农医馆、医学院、
白沙宿舍区、小剧场、临湖餐厅，以及东1到东4教学楼。对应的透明 PNG 放在
`public/assets/exterior/<id>/<id>.png`，由 `CampusScene` 贴回原来的建筑坐标。

其中 `create_remaining_story_buildings.py` 负责临湖餐厅和东教学区四栋楼。
东教学区使用同一套白色面砖、深绿色构件和波浪连廊语言，单栋仍按原有
`east-teaching-1` 到 `east-teaching-4` 的 ID 独立替换，避免改变剧情热点映射。

道路不进入 Blender，也不从 Blender 导出。这样不会再出现“路像水管”的问题：
道路继续沿用游戏里的 `campusRoads`，建筑只替换外观，入口、碰撞、剧情和室内
仍然使用原来的 ID 和坐标。

## 打开方式

1. 用 Blender 打开 `zijingang-east-blockout.blend`。
2. 相机视图按小键盘 `0`（没有小键盘时从右上角 View 菜单进入 Camera View）。
3. 按 `F12` 查看样板渲染。
4. 只修改 `LANDMARKS` 集合里的地标，不要移动 `GROUND`、`ROADS` 或相机。

## 与游戏合并时交付什么

不要把整张 `.blend` 直接塞进 Phaser。后续美术制作按“单栋建筑、单个透明
等距素材”交付：

- `art/exterior-buildings/<id>/<id>.blend`：单栋建筑的可编辑源文件；
- `public/assets/exterior/<id>.webp`：正交相机渲染出的透明外观图；
- `<id>.meta.json`：像素锚点、占地范围和版本信息。

道路不另做一套坐标，直接沿用 `campusRoads`；这样红鬼和玩家仍然在同一张
路网上移动。

外景接入必须保留现有剧情 ID：`medical-library`（显示名是农医馆）、
`dorm-baisha`、`medical-college`、`little-theater`。不要重命名这些 ID。

数据来源：OpenStreetMap 建筑轮廓（ODbL），参考坐标中心为启真湖。游戏发布时须保留 `© OpenStreetMap contributors` 及许可证链接。

## 生成脚本

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python create_campus_blockout.py
```

脚本默认读取同目录 `source/zijingang-key-geom.json`，输出 `.blend` 和预览 PNG。
