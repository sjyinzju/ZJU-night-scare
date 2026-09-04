import { build } from "esbuild";

const result = await build({
  entryPoints: ["tools/theater-runtime.test.ts"],
  bundle: true, format: "esm", platform: "node", target: "node20", write: false,
  define: { "import.meta.env": JSON.stringify({ DEV: true, BASE_URL: "/", VITE_ASSET_CDN_URL: "" }) },
  plugins: [{ name: "silent-test-audio", setup(build) {
    build.onLoad({ filter: /[\\/]audio[\\/]proceduralAudio\.ts$/ }, () => ({
      contents: "export const playLibraryThunder = () => {}; export const playTheaterLightOff = () => {}; export const startLibraryStorm = () => {}; export const stopLibraryStorm = () => {};",
    }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
