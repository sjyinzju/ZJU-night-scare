# Medical Library Interior Art Brief

Target scene: the first playable 3D interior for the medical branch library.

Intent:
- A real campus library after midnight, not a monster arena.
- Cold institutional darkness, old wood shelves, worn parquet, low ceiling pressure, and peeling wall texture graded toward a colder medical-library tone.
- Horror comes from controlled realism: dust, dampness, misaligned records, localized red reflected light, and props that feel plausible but wrong.
- The second art pass must be real-asset led, not AI cube/procedural blockout led.
- Keep the room single-floor. No second floor and no spiral staircase in this pass.

Layout:
- Reading area preserves the original library rhythm: six study tables total, two on the left and four on the right, with four chairs around each desktop table.
- Shelf area uses the real `wooden_bookshelf_worn_1k` asset. Books come from `decorative_book_set_01_2k` / `book_encyclopedia_set_01_2k` and sit on the shelves, replacing the old procedural shelf/book blocks.
- Shelves are spaced with wider aisles. Medical anomaly props such as the bed frame and tool cart sit in side clearings near the shelves, not inside shelf rows.
- The old two-zone divider is now wall segments plus a central `large_iron_gate_1k` gate.

Required gameplay anchors:
- Spawn: near the left-front study aisle, looking toward the first clue route.
- `library_intro`: the first red story point near the blocked archive bar.
- `library_sound`: the sound/anomaly point in the right bookshelf aisle.
- `library_exit`: exit trigger at the turnstiles.
- Flashlight pickup spots remain near the early study area.
- The `large_iron_gate_1k` visual is phase-controlled: visible/closed during `library_intro`, then hidden/opened after the first scene completes. The TypeScript collider still owns the actual blocking behavior.

Production path:
- Use `3D_Assets` as the source of truth for visible hero props and PBR surface texture.
- Use Blender as the assembly, cleanup, texture resize, LOD, and GLB export stage.
- Desktop budget: `scene.glb` plus embedded textures should stay around 12-20MB.
- Mobile budget: `scene.lod.glb` should stay around 3-6MB.
- Use Infinigen-style procedural materials and scattering only for reusable grime, wall aging, paper, book, wood, and tile variation around the real assets.
- Use TRELLIS-generated GLB props later for hero objects such as the catalog terminal, old archive cabinet, door-card reader, and damaged shelf.
- Keep ATISS/AnyHome as reference-only because of licensing and fit concerns.

Current real assets in the medical-library pass:
- `WoodenTable_03_2k`, `modern_arm_chair_01_2k`, `decorative_book_set_01_2k`, `book_encyclopedia_set_01_2k`
- `wooden_bookshelf_worn_1k`, `large_iron_gate_1k`, `peeling_painted_wall_1k`
- `tool_cart_2k`, `old_bed_frame_2k`, `wall_clock_1k`, `chinese_chandelier_2k`, `small_plastic_torch_2k`
- `diagonal_parquet_2k` for floor PBR texture

Current export:
- Desktop: `public/models/interiors/medical-library/scene.glb`, about 12.8MB, about 381k triangles.
- Mobile/LOD: `public/models/interiors/medical-library/scene.lod.glb`, about 5.7MB, about 164k triangles.
- `scene.meta.json` records source assets, quality profile, pickup visual names, story spots, phase visuals, and red light metadata.
