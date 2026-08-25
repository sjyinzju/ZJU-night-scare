from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "3D_Assets" / "瘦长鬼影" / "Blender_2.81.blend"
OUTPUT = ROOT / "public" / "models" / "interiors" / "baisha" / "baisha-corridor-props.glb"
GHOST_MESHES = ("body", "head", "ojo", "ojo2", "cap")

# Blender uses +Y where the runtime GLB uses -Z.
TARGET_X = 35.0
TARGET_BLENDER_Y = 8.9
TARGET_FLOOR_Z = 0.03
TARGET_SCALE = 0.92
TARGET_YAW = math.radians(-67.0)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(corner[index] for corner in corners) for index in range(3))),
        Vector(tuple(max(corner[index] for corner in corners) for index in range(3))),
    )


def build_ghost_root() -> bpy.types.Object:
    meshes = [bpy.data.objects.get(name) for name in GHOST_MESHES]
    if any(mesh is None for mesh in meshes):
        missing = [name for name, mesh in zip(GHOST_MESHES, meshes) if mesh is None]
        raise RuntimeError(f"瘦长鬼影源文件缺少网格: {', '.join(missing)}")
    ghost_meshes = [mesh for mesh in meshes if mesh is not None]
    armature = ghost_meshes[0].parent
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError("瘦长鬼影网格没有可导出的骨架父对象")

    minimum, maximum = world_bounds(ghost_meshes)
    source_center = Vector(((minimum.x + maximum.x) * 0.5, (minimum.y + maximum.y) * 0.5, minimum.z))
    local_transform = (
        Matrix.Rotation(TARGET_YAW, 4, "Z")
        @ Matrix.Scale(TARGET_SCALE, 4)
        @ Matrix.Translation(-source_center)
    )

    root = bpy.data.objects.new("baisha_slender_ghost", None)
    bpy.context.collection.objects.link(root)
    root.location = (TARGET_X, TARGET_BLENDER_Y, TARGET_FLOOR_Z)
    root.matrix_world = Matrix.Translation(root.location)

    # Freeze the source's current armature pose into ordinary static meshes.
    # The corridor figure never animates in this scene, so exporting bones and
    # their custom control shapes would add weight and can shift the old rig.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    exported_meshes: list[bpy.types.Object] = []
    for source in ghost_meshes:
        evaluated = source.evaluated_get(depsgraph)
        mesh_data = bpy.data.meshes.new_from_object(
            evaluated,
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
        exported = bpy.data.objects.new(f"baisha_slender_ghost_{source.name}", mesh_data)
        bpy.context.collection.objects.link(exported)
        exported.parent = root
        exported.matrix_parent_inverse = Matrix.Identity(4)
        exported.matrix_world = root.matrix_world @ local_transform @ source.matrix_world
        exported_meshes.append(exported)

    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    root.select_set(True)
    for mesh in exported_meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = exported_meshes[0]
    return root


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    build_ghost_root()
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
    print(f"BAISHA_CORRIDOR_PROPS_OK output={OUTPUT}")


if __name__ == "__main__":
    main()
