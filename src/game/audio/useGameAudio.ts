import { useCallback, useEffect } from "react";
import { audioManager } from "./audioManager";
import type { HorrorEffect, StoryScene } from "../storyData";

type UseGameAudioOptions = {
  sanity: number;
  activeStory: boolean;
  ending?: StoryScene["ending"];
};

export function useGameAudio({ sanity, activeStory, ending }: UseGameAudioOptions) {
  useEffect(() => {
    const unlockAudio = () => audioManager.unlock();

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    audioManager.setSceneState({ sanity, activeStory, ending });
  }, [activeStory, ending, sanity]);

  const playEffect = useCallback((effect?: HorrorEffect) => {
    audioManager.playEffect(effect);
  }, []);

  const playChoice = useCallback(() => {
    audioManager.playChoice();
  }, []);

  const playItem = useCallback(() => {
    audioManager.playItem();
  }, []);

  const resetAudio = useCallback(() => {
    audioManager.reset();
  }, []);

  return { playEffect, playChoice, playItem, resetAudio };
}
