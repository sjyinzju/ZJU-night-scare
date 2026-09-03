import path from "node:path";
import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const result = await build({
  entryPoints: [path.join(projectRoot, "tools/road-movement-contract.test.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const code = result.outputFiles[0]?.text;
if (!code) throw new Error("Road movement contract test did not compile.");

// A data URL keeps the verifier read-only: no generated test bundle is left in
// the workspace after the run.
await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
