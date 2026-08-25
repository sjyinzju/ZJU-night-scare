from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "3D_Assets" / "能量饮料.blend"
OUTPUT = ROOT / "public" / "models" / "interiors" / "baisha" / "baisha-chase-props.glb"
TARGET_HEIGHT = 0.24


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(corner[index] for corner in corners) for index in range(3))),
        Vector(tuple(max(corner[index] for corner in corners) for index in range(3))),
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    sources = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not sources:
        raise RuntimeError("能量饮料源文件没有可导出的网格")

    minimum, maximum = world_bounds(sources)
    height = max(0.001, maximum.z - minimum.z)
    scale = TARGET_HEIGHT / height
    center = Vector(((minimum.x + maximum.x) * 0.5, (minimum.y + maximum.y) * 0.5, minimum.z))
    local_transform = Matrix.Scale(scale, 4) @ Matrix.Translation(-center)

    root = bpy.data.objects.new("baisha_energy_drink", None)
    bpy.context.collection.objects.link(root)
    exported: list[bpy.types.Object] = []
    for source in sources:
        clone = source.copy()
        clone.data = source.data.copy()
        clone.name = f"baisha_energy_{source.name}"
        bpy.context.collection.objects.link(clone)
        clone.parent = root
        clone.matrix_parent_inverse = Matrix.Identity(4)
        clone.matrix_world = local_transform @ source.matrix_world
        exported.append(clone)

    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    root.select_set(True)
    for obj in exported:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = exported[0]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_yup=True,
    )
    print(f"BAISHA_CHASE_PROPS_OK output={OUTPUT}")


if __name__ == "__main__":
    main()
