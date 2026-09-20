# Cloudflare R2 运行时资源发布

## 生产资源域名

生产环境已使用 R2 自定义域名 `assets.sjyinzju.top`。不要退回 `pub-...r2.dev`：Cloudflare 将 `r2.dev` 定义为非生产入口，会限流，而且该入口不能使用 Cloudflare Cache。

绑定完成后，把 `.env.production` 改为：

```env
VITE_ASSET_CDN_URL=https://assets.example.com/public
```

这里的域名只是示例；不要在实际配置中照抄。R2 对象键继续保留 `public/` 顶层前缀。

## 无损 Brotli 产物

运行：

```bash
npm run assets:prepare:r2
```

也可以只处理一个场景或音频库：

```bash
node tools/prepare_r2_runtime_assets.mjs --scene=baisha
node tools/prepare_r2_runtime_assets.mjs --scene=medical
node tools/prepare_r2_runtime_assets.mjs --scene=audio
```

小剧场模型、元数据和全部放映/镜面图片可单独准备：

```bash
node tools/prepare_r2_runtime_assets.mjs --scene=theater
```

脚本不会修改 `public/` 原文件，只在被 Git 忽略的 `.r2-upload/` 中生成 `.br` 产物和 `manifest.json`。上传时必须逐项遵守 manifest：

- 上传 `.br` 文件的字节，但 R2 对象键使用 `objectKey`，不能带 `.br` 后缀。
- `Content-Type: model/gltf-binary`
- `Content-Encoding: br`
- `Cache-Control: public, max-age=31536000, immutable`

缺少 `Content-Encoding: br` 会让浏览器把压缩字节当 GLB 解析并失败。元数据、PNG、WebP、MP3 与 WAV 会原样复制进 `.r2-upload/` 并写入 manifest；这些文件必须使用 manifest 中的 `Content-Type` 与 `Cache-Control`，但不能设置 `Content-Encoding`。

运行时模型、剧情图片、跳脸图片和文件音频都带版本查询参数，因此可以安全使用 manifest 中的一年 immutable 浏览器缓存。每次替换同名资源时，必须同时更新对应的缓存版本常量，否则已缓存的旧资源不会立即失效。

## Cloudflare 缓存规则

在自定义资源域名所在 zone 中创建 Cache Rule：

1. 条件：Hostname 等于资源域名，并且 URI Path 以 `/public/` 开头。
2. Cache eligibility：Eligible for cache（Cache Everything）。
3. Edge TTL：Ignore cache-control header and use this TTL，建议 1 个月；版本化 GLB 可用 1 年。
4. Browser TTL：Respect existing headers。
5. Cache key：保留查询参数；运行时代码用 `?v=scene-version` 隔离新旧资源。
6. 启用 Smart Tiered Cache，使上层缓存靠近 R2 bucket。

R2 CORS 至少允许：

```json
[
  {
    "AllowedOrigins": ["https://sjyinzju.github.io"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Encoding", "ETag", "CF-Cache-Status"],
    "MaxAgeSeconds": 86400
  }
]
```

## 发布验证

先以无缓存请求验证内容和响应头，再连续请求两次验证边缘缓存：

```bash
curl -I "https://assets.example.com/public/models/interiors/baisha/baisha.glb?v=baisha-scene01-v2"
```

应看到：

- HTTP 200
- `content-type: model/gltf-binary`
- `content-encoding: br`
- 第二次请求的 `cf-cache-status: HIT`
- `age` 随后增长

如果模型仍显示原始文件大小、没有 `content-encoding: br`、没有 `cache-control`，且连续请求仍为 `cf-cache-status: DYNAMIC`，说明上传时没有采用 `.r2-upload/manifest.json` 的压缩字节/对象元数据，或自定义域名的 Cache Rule 尚未生效；这不是前端 CORS 问题。

最后重新执行 `npm run build`、合并到 `main` 并等待 GitHub Pages 部署。仅上传 R2 不会更新已经构建进 JavaScript 的 CDN 域名或场景版本号。
