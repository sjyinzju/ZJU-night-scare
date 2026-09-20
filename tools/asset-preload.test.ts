const requestCounts = new Map<string, number>();

const medicalMeta = {
  assetVersion: 17,
  buildingId: "medical-college",
  roomKind: "medical",
  model: "medical-top.glb",
  medicalTopGameplay: {
    bed: { model: "medical-top-props.glb" },
    rooms: {
      "601": { model: "medical-top-601.glb" },
      "603": { model: "medical-top-603.glb" },
      "605": { model: "medical-top-605.glb" },
    },
  },
  medicalGarageGameplay: { propsModel: "medical-garage-props.glb" },
  medicalBasementGameplay: { propsModel: "medical-basement-props.glb" },
};

const theaterMeta = {
  assetVersion: 8,
  buildingId: "little-theater",
  roomKind: "hall",
  model: "theater.glb",
  additionalModels: ["theater-gameplay-props.glb"],
  theaterGameplay: {
    ghost: { model: "models/interiors/medical-school/medical-garage-props.glb" },
    photoFrame: { model: "models/interiors/baisha/baisha-dorm-props.glb" },
  },
};

Object.assign(globalThis, {
  window: globalThis,
  fetch: async (input: string | URL | Request) => {
    const url = String(input);
    requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1);
    if (url.includes("top-gameplay.meta.json")) {
      return new Response(JSON.stringify(medicalMeta), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("theater-gameplay.meta.json")) {
      return new Response(JSON.stringify(theaterMeta), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), { status: 200 });
  },
});

class FakeImage {
  complete = true;
  naturalWidth = 1;
  crossOrigin: string | null = null;
  decoding = "auto";
  fetchPriority = "auto";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = "";

  get src(): string { return this.value; }
  set src(value: string) {
    this.value = value;
    requestCounts.set(value, (requestCounts.get(value) ?? 0) + 1);
    queueMicrotask(() => this.onload?.());
  }

  decode(): Promise<void> { return Promise.resolve(); }
}

Object.assign(globalThis, { Image: FakeImage });

const {
  preloadAllMedicalInteriorAssets,
  preloadInteriorAsset,
} = await import("../src/game/interior3d/InteriorAssetLoader");
const {
  preloadMedicalVisualAssets,
  preloadTheaterVisualAssets,
} = await import("../src/game/imagePreloader");
const { preloadJumpscareSprites } = await import("../src/game/jumpscareAssets");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await preloadAllMedicalInteriorAssets({
  buildingId: "medical-college",
  roomKind: "medical",
  isMobile: false,
});
await preloadMedicalVisualAssets();
await preloadJumpscareSprites();
await preloadInteriorAsset({
  buildingId: "little-theater",
  roomKind: "hall",
  isMobile: false,
});
await preloadTheaterVisualAssets();

const requestedUrls = [...requestCounts.keys()];
for (const requiredFile of [
  "medical-top.glb",
  "medical-garage.glb",
  "medical-basement.glb",
  "medical-top-props.glb",
  "medical-top-601.glb",
  "medical-top-603.glb",
  "medical-top-605.glb",
  "medical-garage-props.glb",
  "medical-basement-props.glb",
  "theater.glb",
  "theater-gameplay-props.glb",
  "baisha-dorm-props.glb",
  "archive-notebook-spread-v1.png",
  "theater-stage-suwan-flash.png",
  "theater-reel-r07a-baiqiu-remembers.png",
  "theater-reel-r07b-baiqiu-lost.png",
  "library-shelf-ghost.png",
  "library-fall-ghost.png",
]) {
  assert(requestedUrls.some((url) => url.includes(requiredFile)), `Missing preload request for ${requiredFile}`);
}
const basementJumpscareUrl = requestedUrls.find((url) => url.includes("suwan-door-v1.png"));
assert(Boolean(basementJumpscareUrl), "Missing shared medical-basement apparition/jumpscare image");
assert(
  requestCounts.get(basementJumpscareUrl!) === 1,
  "Medical-basement apparition and jumpscare must reuse one decoded image URL",
);

const requestCountAfterFirstPass = [...requestCounts.values()].reduce((sum, count) => sum + count, 0);
await preloadAllMedicalInteriorAssets({
  buildingId: "medical-college",
  roomKind: "medical",
  isMobile: false,
});
await preloadMedicalVisualAssets();
await preloadJumpscareSprites();
await preloadInteriorAsset({
  buildingId: "little-theater",
  roomKind: "hall",
  isMobile: false,
});
await preloadTheaterVisualAssets();
const requestCountAfterSecondPass = [...requestCounts.values()].reduce((sum, count) => sum + count, 0);
assert(
  requestCountAfterSecondPass === requestCountAfterFirstPass,
  "Resolved model/image preloads must be reused instead of requesting the same URL twice",
);

console.log(`asset preload contract ok (${requestCounts.size} unique URLs)`);
