import { build } from "esbuild";

// Import the real interior entry point: its lighting prerequisites must be
// ready before either a desktop or mobile renderer can draw the first frame.
const result = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { Interior3D } from "./src/game/interior3d/Interior3D";
      import { UniformsLib, FloatType, HalfFloatType, Scene, Group } from "three";
      import sceneMeta from "./public/models/interiors/library/scene01.meta.json";
      if (typeof Interior3D.prototype.start !== "function") throw new Error("Missing interior entry point");
      for (const [key, type] of [
        ["LTC_FLOAT_1", FloatType], ["LTC_FLOAT_2", FloatType],
        ["LTC_HALF_1", HalfFloatType], ["LTC_HALF_2", HalfFloatType],
      ]) {
        const texture = UniformsLib[key];
        if (!texture?.isDataTexture || texture.type !== type
          || texture.image.width !== 64 || texture.image.height !== 64
          || texture.image.data.length !== 64 * 64 * 4
          || !texture.image.data.some(value => value !== 0) || texture.version === 0) {
          throw new Error(key + " is not ready before the interior's first render");
        }
      }
      for (const isMobile of [false, true]) {
        const runtime = { roomKind: "library", fallRevealed: false, isMobile, scene: new Scene() };
        Interior3D.prototype.bindLibraryFallReveal.call(runtime, { root: new Group(), meta: sceneMeta });
        const light = runtime.fallSpotlight;
        if (!light?.visible || light.intensity !== 0) throw new Error("Fall spotlight must join the initial light layout");
        if (!isMobile && (!light.castShadow || light.shadow.autoUpdate
          || (!light.shadow.map && !light.shadow.needsUpdate))) {
          throw new Error("Visible cached fall spotlight has no initial shadow map or pending update");
        }
        if (isMobile && light.castShadow) throw new Error("Mobile shadow settings changed");
      }
      console.log("interior lighting prerequisites ok (LTC textures and desktop/mobile fall shadows)");
    `,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
  define: {
    "import.meta.env": JSON.stringify({ DEV: true, BASE_URL: "/", VITE_ASSET_CDN_URL: "" }),
  },
});

try {
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
