from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "models" / "interiors" / "baisha" / "baisha.glb"
OUT_DIR = ROOT / "tmp" / "baisha-door-views"
DOOR_X = (5.65, 9.58, 13.55, 17.66, 22.02, 26.56)


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.render.resolution_x = 480
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "PERSP"
    camera.data.lens = 48
    scene.camera = camera

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for side, camera_y, target_y in (("lower", 8.35, 9.55), ("upper", 8.75, 7.60)):
        for index, x in enumerate(DOOR_X):
            camera.location = (x, camera_y, 1.28)
            point_camera(camera, Vector((x, target_y, 1.15)))
            scene.render.filepath = str(OUT_DIR / f"{index}_{x:.2f}_{side}.png")
            bpy.ops.render.render(write_still=True)

    # A camera placed just below the collision slice excludes the authored
    # ceiling while retaining every first-floor wall and doorway. This is the
    # source-of-truth topology view used to map the hand-drawn chase plan.
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 24.0
    camera.location = (19.8, 10.55, 1.44)
    camera.rotation_euler = (0.0, 0.0, 0.0)
    scene.render.filepath = str(ROOT / "tmp" / "baisha-topology-slice.png")
    bpy.ops.render.render(write_still=True)

    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    camera.data.ortho_scale = 15.5
    camera.location = (9.0, 13.6, 1.44)
    scene.render.filepath = str(ROOT / "tmp" / "baisha-topology-left.png")
    bpy.ops.render.render(write_still=True)

    marker_dir = ROOT / "tmp" / "baisha-marker-textures"
    marker_dir.mkdir(parents=True, exist_ok=True)
    for image_name in ("Image_79", "Image_80", "Image_81", "Image_82", "Image_83"):
        image = bpy.data.images.get(image_name)
        if image is None:
            continue
        image.filepath_raw = str(marker_dir / f"{image_name}.png")
        image.file_format = "PNG"
        image.save()

    print(f"Rendered Baisha door views to {OUT_DIR}")


if __name__ == "__main__":
    main()
