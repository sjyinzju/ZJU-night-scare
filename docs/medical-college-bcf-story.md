# 医学院 B / C / F 剧情接入

> 分支：`feature/medical-bcf-story`，从 `main` 重开，不沿用本地旧医学院内景改动。  
> 范围：只接已有建模的 **B 地下一层车库**、**C 六层走廊**、**F 地下仓库**。  
> 职责：本文与 `storyData.ts` 只负责剧情；玩法由对方在空旷的停车场 / 六层布置。

## 空间口径

| 分区 | 模型 | 剧情密度 | 对应场景 ID |
|---|---|---|---|
| B 地下一层车库 | 已有 | 高，吓人 | `medical_garage` |
| C 六层走廊 | 已有 | 低，留玩法 | `medical_window` |
| F 地下仓库 | 已有 | 高，吓人 + 证据 | `medical_vault` → `ghost_choice` → `stand_ground` |

不做 3D 的：正门广场、后门黑猫、B2 配电谜题、小剧场终局。后门仍是进楼前的室外文本 `teaching_back`。

## 游玩顺序

```text
室外 medical_entry（可先走 teaching_back）
  → B medical_garage
  → C medical_window
  → F medical_vault
  → F ghost_choice（苏婉显形）
  → F stand_ground（1953 照片）
  → 离开，去启真湖
```

三条入口只改变进 B 之前是否拿到手电 / 黑猫毛发，不改变 B → C → F。

## 各区剧情

### B 地下一层车库 · `medical_garage`

小说：图书馆后 300 米，教学楼地下一层自行车库；林伟从这里上楼。车库连通东侧其他楼。

要发生：

- 确认这是林伟最后路线的起点。
- 病床轮子声，光照不到人。
- 深处车道没有尽头，东西可以从下面走掉。
- 抬头看见六层坠楼窗的缝，不在这里展开苏婉。

玩法不要在这里收光。吓人靠声音、纵深和连通感。

### C 六层走廊 · `medical_window`

小说：六层空走廊、三间锁门教室、中间坠楼窗、3–5 秒戏腔、白影转弯下楼。

要发生：

- 检查窗框抓痕、湿鞋印、被剪监控线。
- 短戏腔，尽头人影可选，不挡主线。

正文刻意写短。走廊和停车场上层留给玩法。

### F 地下仓库 · `medical_vault` / `ghost_choice` / `stand_ground`

HTML + 现行案：小票归还地点、1953、红绳、旧鞋、苏婉反转、老照片。

要发生：

- 刷开门禁卡，对上 R-1953 名册和小剧场通道图。
- 墙角旧绣花鞋（鞋尖朝墙）。
- 苏婉先吓人，手机出现「我没有在唱。是他们逼我唱。」
- 留下才拿到 1953 老照片；跑则线索少，仍去启真湖。

终局仪式不要放回仓库。这里只证明锚石被挪走、通道通向小剧场。

## 触发点

程序化房间里的占位坐标，GLB 到位后改 `public/models/interiors/medical-college/scene.meta.json` 的 `storySpots` 即可，不必改剧情文本。

| 场景 | position | 程序化占位 |
|---|---|---|
| `medical_garage` | `garage` | 出生点内侧 |
| `medical_window` | `window` | 主厅中段 |
| `medical_vault` | `vault` | 地下仓库隔间内 |
| `ghost_choice` | `ghost` | 仓库深处 |
| `stand_ground` | `stand` | 苏婉消散处 |

## 不做

- 不在 C 写长剧情、不在 B/F 做解谜说明。
- 不把第一章坠楼再演一遍；C 只还原现场。
- 不把 HTML 的 5 月 9 日车库仪式接回来。
- 不把农医馆、白沙、临湖餐厅、启真湖、小剧场剧情搬进这三块。
