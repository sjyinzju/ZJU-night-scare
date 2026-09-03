import { assetUrl } from "./assetPath";
import type { JumpscareContext } from "./jumpscareTexts";

export type JumpscareSpriteId = "library-shelf" | "library-fall" | "medical-garage" | "medical-basement";

const spriteFiles: Record<JumpscareSpriteId, string> = {
  "library-shelf": "jumpscares/library-shelf-ghost.png",
  "library-fall": "jumpscares/library-fall-ghost.png",
  "medical-garage": "jumpscares/medical-garage-ghost.png",
  "medical-basement": "medical-basement/suwan-door-v1.png",
};

export const JUMPSCARE_SPRITE_IDS = Object.keys(spriteFiles) as JumpscareSpriteId[];

type SpriteRecord = {
  image: HTMLImageElement;
  ready: Promise<boolean>;
};

const spriteRecords = new Map<JumpscareSpriteId, SpriteRecord>();

export function jumpscareSpriteUrl(spriteId: JumpscareSpriteId): string {
  return assetUrl(
    `images/${spriteFiles[spriteId]}`,
    spriteId === "medical-garage"
      ? "medical-garage-v1"
      : spriteId === "medical-basement" ? "medical-basement-v1" : undefined,
  );
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

function createSpriteRecord(spriteId: JumpscareSpriteId): SpriteRecord {
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";

  const ready = new Promise<boolean>((resolve) => {
    image.onload = () => {
      // `load` only means the bytes arrived. Waiting for decode prevents the
      // first visible animation frame from racing the PNG decoder.
      void image.decode().then(
        () => resolve(true),
        () => resolve(image.complete && image.naturalWidth > 0),
      );
    };
    image.onerror = () => {
      // Do not pin a transient CDN/network failure for the entire session.
      // The next authored scare gets one fresh request and can still fall back
      // to the procedural face if that retry also misses its deadline.
      spriteRecords.delete(spriteId);
      resolve(false);
    };
  });

  image.src = jumpscareSpriteUrl(spriteId);
  return { image, ready };
}

function getSpriteRecord(spriteId: JumpscareSpriteId): SpriteRecord {
  const existing = spriteRecords.get(spriteId);
  if (existing) return existing;
  const created = createSpriteRecord(spriteId);
  spriteRecords.set(spriteId, created);
  return created;
}

export function preloadJumpscareSprites(): Promise<boolean[]> {
  return Promise.all(JUMPSCARE_SPRITE_IDS.map((id) => getSpriteRecord(id).ready));
}

/**
 * Wait briefly for a sprite that is already warming in the background.
 * Returning false lets the caller use the procedural face instead of showing
 * a broken/late image during a one-shot scare.
 */
export function prepareJumpscareSprite(spriteId: JumpscareSpriteId, timeoutMs = 1600): Promise<boolean> {
  const ready = getSpriteRecord(spriteId).ready;
  return Promise.race([
    ready,
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
