# Audio Asset Notes

Some WAV sound effects in this directory were procedurally generated for this
project by `tools/generate_audio_assets.py`.

They are original generated assets and can be used in this project without
requiring third-party attribution. Regenerate them with:

```bash
python tools/generate_audio_assets.py
```

Main BGM files currently used by the game:

- `bgm/score-1.mp3`: copied from the project-provided local file `配乐1.mp3`.
- `bgm/score-2.mp3`: copied from the project-provided local file `配乐2.mp3`.

Only these two files are used as looping background music. Generated ambience
layers such as wind, electric hum, lake noise, and low-sanity drones were removed
from the runtime mix to avoid broadband hiss.

Choice page-turn sound:

- `sfx/story-open.mp3`: copied from the project-provided local file `文字页面音效.mp3`.
  It is used as a Howler audio sprite, so each option click plays one short
  peak instead of the full file. Runtime volume is reduced by 35%.
- `sfx/choice-select.wav`: extracted from teammate's `origin/main` choice sound
  and layered with the page-turn sprite on option clicks.

Suggested external sources for future replacement assets:

- Kenney audio packs: https://kenney.nl/assets/category:Audio
- OpenGameArt CC0 sound effects: https://opengameart.org/content/cc0-sound-effects
- Pixabay Music/Sound Effects: https://pixabay.com/music/ and
  https://pixabay.com/sound-effects/

Use only assets whose individual page lists CC0 or another
  project-compatible license.
For Pixabay, verify the current Content License for each selected asset before
shipping.

Do not add external audio to this folder without recording its source URL,
author, license, and download date.
