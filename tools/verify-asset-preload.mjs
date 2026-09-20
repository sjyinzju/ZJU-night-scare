import { build } from "esbuild";

const result = await build({
  entryPoints: ["tools/asset-preload.test.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
  define: {
    "import.meta.env": JSON.stringify({
      DEV: true,
      BASE_URL: "/",
      VITE_ASSET_CDN_URL: "",
    }),
  },
});

const code = result.outputFiles[0]?.text;
if (!code) throw new Error("Asset preload contract test did not compile.");
await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
