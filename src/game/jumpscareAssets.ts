import { assetUrl } from "./assetPath";

export type JumpscareSpriteId = "library-shelf" | "library-fall";

const spriteFiles: Record<JumpscareSpriteId, string> = {
  "library-shelf": "library-shelf-ghost.png",
  "library-fall": "library-fall-ghost.png",
};

export const JUMPSCARE_SPRITE_IDS = Object.keys(spriteFiles) as JumpscareSpriteId[];

type SpriteRecord = {
  image: HTMLImageElement;
  ready: Promise<boolean>;
};

const spriteRecords = new Map<JumpscareSpriteId, SpriteRecord>();

export function jumpscareSpriteUrl(spriteId: JumpscareSpriteId): string {
  return assetUrl(`images/jumpscares/${spriteFiles[spriteId]}`);
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
