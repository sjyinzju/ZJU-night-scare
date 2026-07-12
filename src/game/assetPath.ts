/**
 * 统一的资产 URL 工具。
 *
 * 本地开发时 VITE_ASSET_CDN_URL 为空，资产从 Vite public/ 目录加载。
 * 生产构建时 VITE_ASSET_CDN_URL 指向 Cloudflare R2，大文件资产从 CDN 加载，
 * 确保 GitHub Pages 仓库保持轻量。
 *
 * 用法：
 *   import { assetUrl } from "../game/assetPath";
 *   const url = assetUrl("models/interiors/medical-library/scene.glb");
 *   const audio = assetUrl("audio/bgm/score-1.mp3");
 */
export function assetUrl(relativePath: string): string {
  const cdn: string | undefined = import.meta.env.VITE_ASSET_CDN_URL;
  if (cdn) {
    // 去除首尾多余斜杠，拼接 CDN 基础 URL 和相对路径
    return `${cdn.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
  }
  // 本地开发或默认 GitHub Pages 路径
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return `${base}/${relativePath.replace(/^\/+/, "")}`;
}
