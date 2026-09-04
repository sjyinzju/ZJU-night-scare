"""Build the lightweight film-reel prop used by the final theater chapter.

Run with Blender from the repository root:
  blender --background --python tools/build_theater_gameplay_props.py
"""

from pathlib import Path

import bpy
from mathutils import Vector


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / "3D_Assets" / "JDH5455681510_fbx" / "3d66.com_JDH5455681510.fbx"
OUTPUT = REPO_ROOT / "public" / "models" / "interiors" / "theater" / "theater-gameplay-props.glb"
TARGET_LONGEST_SIDE_METERS = 0.48


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in corners) for index in range(3))),
        Vector(tuple(max(point[index] for point in corners) for index in range(3))),
    )


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(SOURCE))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("The film-reel FBX contained no mesh objects")

    minimum, maximum = world_bounds(meshes)
    size = maximum - minimum
    scale = TARGET_LONGEST_SIDE_METERS / max(size.x, size.y, size.z)
    center = (minimum + maximum) * 0.5

    container = bpy.data.objects.new("theater_film_reel", None)
    bpy.context.scene.collection.objects.link(container)
    for obj in list(bpy.context.scene.objects):
        if obj == container or obj.parent is not None:
            continue
        world = obj.matrix_world.copy()
        obj.parent = container
        obj.matrix_world = world
    container.scale = (scale, scale, scale)
    container.location = -center * scale

    for obj in bpy.context.scene.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = container
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
