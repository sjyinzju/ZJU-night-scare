from __future__ import annotations

import bpy
from pathlib import Path
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "models" / "interiors" / "library" / "library.glb"
OUTPUT = ROOT / "public" / "models" / "interiors" / "library" / "library-scene01-props.glb"
ASSETS = ROOT / "3D_Assets"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((float("inf"), float("inf"), float("inf")))
    maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    return minimum, maximum


def finish_import(
    imported: list[bpy.types.Object],
    *,
    root_name: str,
    target_center: tuple[float, float, float],
    target_dimensions: tuple[float, float, float],
) -> bpy.types.Object:
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{root_name}: imported asset contains no mesh")

    # Bake every mesh's current world transform before removing helper rigs,
    # cameras and lights from third-party source files.
    world_matrices = {obj: obj.matrix_world.copy() for obj in meshes}
    for obj in meshes:
        obj.parent = None
        obj.matrix_world = world_matrices[obj]
    for obj in imported:
        if obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)

    minimum, maximum = world_bounds(meshes)
    source_center = (minimum + maximum) * 0.5
    source_dimensions = maximum - minimum
    scales = Vector(tuple(
        target_dimensions[index] / max(source_dimensions[index], 1e-5)
        for index in range(3)
    ))
    transform = (
        Matrix.Translation(Vector(target_center))
        @ Matrix.Diagonal((scales.x, scales.y, scales.z, 1.0))
        @ Matrix.Translation(-source_center)
    )

    root = bpy.data.objects.new(root_name, None)
    bpy.context.collection.objects.link(root)
    for index, obj in enumerate(meshes):
        obj.matrix_world = transform @ obj.matrix_world
        obj.name = f"{root_name}_mesh_{index:02d}"
        for material in obj.data.materials:
            if material:
                material.use_backface_culling = False
        matrix = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = matrix
    return root


def append_blend(
    source: Path,
    *,
    root_name: str,
    target_center: tuple[float, float, float],
    target_dimensions: tuple[float, float, float],
) -> bpy.types.Object:
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(str(source), link=False) as (data_from, data_to):
        data_to.objects = list(data_from.objects)
    for obj in data_to.objects:
        if obj and obj.name not in bpy.context.scene.objects:
            bpy.context.collection.objects.link(obj)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    return finish_import(
        imported,
        root_name=root_name,
        target_center=target_center,
        target_dimensions=target_dimensions,
    )


def import_fbx(
    source: Path,
    *,
    root_name: str,
    target_center: tuple[float, float, float],
    target_dimensions: tuple[float, float, float],
) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    return finish_import(
        imported,
        root_name=root_name,
        target_center=target_center,
        target_dimensions=target_dimensions,
    )


def import_obj(
    source: Path,
    *,
    root_name: str,
    target_center: tuple[float, float, float],
    target_dimensions: tuple[float, float, float],
) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=str(source), forward_axis="NEGATIVE_Z", up_axis="Y")
    imported = [obj for obj in bpy.data.objects if obj not in before]
    return finish_import(
        imported,
        root_name=root_name,
        target_center=target_center,
        target_dimensions=target_dimensions,
    )


def add_anchor(name: str, three_x: float, three_y: float, three_z: float) -> None:
    anchor = bpy.data.objects.new(name, None)
    anchor.location = (three_x, -three_z, three_y)
    anchor.empty_display_type = "SPHERE"
    anchor.empty_display_size = 0.12
    bpy.context.collection.objects.link(anchor)


EXIT_CENTER_X = 0.15


def add_exit_void() -> bpy.types.Object:
    material = bpy.data.materials.new("library_exit_void_material")
    material.diffuse_color = (0.002, 0.001, 0.001, 1.0)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = (0.002, 0.001, 0.001, 1.0)
        principled.inputs["Roughness"].default_value = 1.0

    # The mask sits behind the glass door from the player's approach side.
    # Both are in front of the authored wall so the activated exit is visible
    # before the proximity trigger fades the interior to black.
    bpy.ops.mesh.primitive_cube_add(location=(EXIT_CENTER_X, -0.30, 1.35))
    void = bpy.context.object
    void.name = "library_exit_void"
    void.dimensions = (2.12, 0.035, 2.7)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    void.data.materials.append(material)
    return void


def normalize_images(max_size: int = 1024) -> None:
    for image in list(bpy.data.images):
        if not image.users or image.source != "FILE":
            continue
        width, height = image.size
        longest = max(width, height)
        if longest <= max_size:
            continue
        ratio = max_size / longest
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))


def main() -> None:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    base_objects = set(bpy.context.scene.objects)

    # Blender uses (X, Y, Z-up). Positions below are the measured locations
    # in the imported authored scene, not guessed procedural-room coordinates.
    append_blend(
        ASSETS / "笔记本（用于第一个剧情点）" / "binder_notebook_2k.blend",
        root_name="story_notebook_visual",
        # Measured desk top: X 6.6328–7.5028, Y -5.1335–-2.2794,
        # Z 1.3694. Keep the whole binder on the desk instead of clipping it
        # through the right edge and 40 cm below the surface.
        # Lower the lower leather cover into the measured desktop by another
        # 2.5 cm. The raised straps still remain clearly visible.
        target_center=(7.05, -4.5038, 1.325),
        target_dimensions=(0.58, 0.4, 0.09),
    )
    append_blend(
        ASSETS / "small_plastic_torch_2k.blend" / "small_plastic_torch_2k.blend",
        root_name="pickup_flashlight_visual",
        # Blender 5.1.30 source asset, laid horizontally on the long table
        # beside the authored spawn point (measured top Z 1.3694).
        # Lower the round housing into the measured desktop enough to remove
        # the first-person parallax gap while preserving the lens and switch.
        target_center=(9.45, -9.25, 1.365),
        target_dimensions=(0.32, 0.13, 0.12),
    )
    append_blend(
        ASSETS / "便签（用于借阅小票）" / "office_notepads_2k.blend",
        root_name="pickup_receipt_visual",
        # The right-hand recessed cubicle is the receipt location. Its outer
        # standing-desk surface is Z 1.5656; keep the ticket at the reachable
        # front edge and rest its lower face on the desktop.
        target_center=(-4.88, -8.18, 1.591),
        target_dimensions=(0.50, 0.32, 0.05),
    )
    import_fbx(
        ASSETS / "符咒" / "符3+3DMAX2022" / "符3 3DMAX2022" / "符3.fbx",
        root_name="pickup_talisman_visual",
        # The left-hand desk beside the shelves is the talisman location. Its
        # tabletop is Z 0.986; the model is placed on top rather than inside it.
        target_center=(-3.62, -10.63, 1.011),
        target_dimensions=(0.58, 0.34, 0.05),
    )
    door = import_obj(
        ASSETS / "门" / "Glass Door" / "Glass Door.obj",
        root_name="library_exit_door",
        target_center=(EXIT_CENTER_X, -0.37, 1.35),
        target_dimensions=(2.06, 0.18, 2.7),
    )
    add_exit_void()

    add_anchor("story_book_anchor_0", -3.25, 1.45, 24.0)
    add_anchor("story_book_anchor_1", -0.45, 1.45, 36.0)
    add_anchor("story_book_anchor_2", -3.15, 1.45, 48.0)
    add_anchor("story_fall_trigger_anchor", 2.2, 0.15, 31.0)
    add_anchor("story_exit_trigger_anchor", EXIT_CENTER_X, 0.15, 0.72)

    # The existing library stays in its original compact GLB. Export only the
    # scene-one additions so its already-compressed textures are not decoded
    # and re-encoded into a 100+ MB monolith.
    for obj in list(base_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    normalize_images()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=True,
        export_lights=False,
        export_extras=True,
        export_animations=False,
    )
    print(f"Exported {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
