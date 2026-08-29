# 紫金港东区外景样板（Blender）

这不是游戏运行时资源，也不改 `src/game`。这是外景地图的美术源文件样板。

## 这次样板包含

- 启真湖、湖心岛；
- 白沙 1/2/3/4 舍及大厅；
- 月牙楼；
- 小剧场 A/B 座；
- 农医馆、医学院、基础图书馆和东教学区的定位体块；
- 固定正交相机、卡通材质、黑色轮廓、窗灯和少量悬疑红光。

## 打开方式

1. 用 Blender 打开 `zijingang-east-blockout.blend`。
2. 相机视图按小键盘 `0`（没有小键盘时从右上角 View 菜单进入 Camera View）。
3. 按 `F12` 查看样板渲染。
4. 只修改 `LANDMARKS` 集合里的地标，不要移动 `GROUND`、`ROADS` 或相机。

## 与游戏合并时交付什么

最终不是把 `.blend` 直接塞进 Phaser。交付分三部分：

- `.blend`：团队共同编辑的源文件；
- `export/`：地面、建筑、窗灯和阴影的分层 WebP；
- `map-contract.json`：建筑 ID、入口、出口、碰撞轮廓和道路锚点。

外景接入必须保留现有剧情 ID：`medical-library`、`dorm-baisha`、`medical-college`、`little-theater`。

数据来源：OpenStreetMap 建筑轮廓（ODbL），参考坐标中心为启真湖。游戏发布时须保留 `© OpenStreetMap contributors` 及许可证链接。

## 生成脚本

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python create_campus_blockout.py
```

脚本默认读取同目录 `source/zijingang-key-geom.json`，输出 `.blend` 和预览 PNG。
