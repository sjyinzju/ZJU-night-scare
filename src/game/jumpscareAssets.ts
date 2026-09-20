import { assetUrl } from "./assetPath";
import {
  MEDICAL_BASEMENT_IMAGE_VERSION,
  JUMPSCARE_IMAGE_CACHE_VERSION,
  preloadImageAssets,
  type ImageAssetDescriptor,
} from "./imagePreloader";
import type { JumpscareContext } from "./jumpscareTexts";

export type JumpscareSpriteId = "library-shelf" | "library-fall" | "medical-garage" | "medical-basement";

const spriteFiles: Record<JumpscareSpriteId, string> = {
  "library-shelf": "jumpscares/library-shelf-ghost.png",
  "library-fall": "jumpscares/library-fall-ghost.png",
  "medical-garage": "jumpscares/medical-garage-ghost.png",
  "medical-basement": "medical-basement/suwan-door-v1.png",
};

export const JUMPSCARE_SPRITE_IDS = Object.keys(spriteFiles) as JumpscareSpriteId[];

function jumpscareSpriteDescriptor(spriteId: JumpscareSpriteId): ImageAssetDescriptor {
  return {
    path: `images/${spriteFiles[spriteId]}`,
    version: spriteId === "medical-basement"
      ? MEDICAL_BASEMENT_IMAGE_VERSION
      : JUMPSCARE_IMAGE_CACHE_VERSION,
    priority: "high",
  };
}

export function jumpscareSpriteUrl(spriteId: JumpscareSpriteId): string {
  const descriptor = jumpscareSpriteDescriptor(spriteId);
  return assetUrl(descriptor.path, descriptor.version);
}

/**
 * A `jumpscare` effect always has a decoded bitmap. Text-only shocks use the
 * separate shake/text effect path and therefore never reach this resolver.
 */
export function defaultJumpscareSprite(context: JumpscareContext): JumpscareSpriteId {
  if (context === "library_fall" || context === "story_death" || context === "ghost_caught") {
    return "library-fall";
  }
  return "library-shelf";
}

export function preloadJumpscareSprites(): Promise<boolean[]> {
  return preloadImageAssets(JUMPSCARE_SPRITE_IDS.map(jumpscareSpriteDescriptor));
}

/**
 * Wait briefly for a sprite that is already warming in the background.
 * Returning false lets the caller use the procedural face instead of showing
 * a broken/late image during a one-shot scare.
 */
export function prepareJumpscareSprite(spriteId: JumpscareSpriteId, timeoutMs = 1600): Promise<boolean> {
  const ready = preloadImageAssets([jumpscareSpriteDescriptor(spriteId)]).then(([loaded]) => loaded);
  return Promise.race([
    ready,
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
