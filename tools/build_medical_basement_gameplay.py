from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "3D_Assets"
OUTPUT = ROOT / "public" / "models" / "interiors" / "medical-school" / "medical-basement-props.glb"


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


def append_normalized(
    source: Path,
    *,
    root_name: str,
    target_dimensions: tuple[float, float, float],
) -> bpy.types.Object:
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(str(source), link=False) as (data_from, data_to):
        data_to.objects = list(data_from.objects)
    for obj in data_to.objects:
        if obj and obj.name not in bpy.context.scene.objects:
            bpy.context.collection.objects.link(obj)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{source} contains no mesh")

    world_matrices = {obj: obj.matrix_world.copy() for obj in meshes}
    for obj in meshes:
        obj.parent = None
        obj.matrix_world = world_matrices[obj]
    for obj in imported:
        if obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)

    minimum, maximum = world_bounds(meshes)
    center = (minimum + maximum) * 0.5
    dimensions = maximum - minimum
    scale = Vector(tuple(
        target_dimensions[index] / max(dimensions[index], 1e-5)
        for index in range(3)
    ))
    transform = Matrix.Diagonal((scale.x, scale.y, scale.z, 1.0)) @ Matrix.Translation(-center)

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
    # Blender is Z-up. Keep the feather bundle broad in Blender X/Y and very
    # thin in Z so glTF's Y-up conversion leaves it visibly resting on the
    # warehouse floor instead of presenting a near-zero-depth edge to camera.
    feathers = append_normalized(
        ASSETS / "Feathers.blend",
        root_name="medical_basement_owl_feathers",
        target_dimensions=(0.75, 0.48, 0.08),
    )
    # The marketplace file references HairCards.png, which is absent from the
    # supplied source directory. Give the shaped feather cards a deliberate
    # local material so the runtime never exports invisible/missing textures.
    feather_material = bpy.data.materials.new("medical_basement_feather_fallback")
    feather_material.diffuse_color = (0.82, 0.76, 0.65, 1.0)
    feather_material.use_nodes = True
    principled = feather_material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = (0.82, 0.76, 0.65, 1.0)
        principled.inputs["Roughness"].default_value = 0.88
        principled.inputs["Emission Color"].default_value = (0.12, 0.025, 0.02, 1.0)
        principled.inputs["Emission Strength"].default_value = 0.7
    for child in feathers.children:
        if child.type != "MESH":
            continue
        child.data.materials.clear()
        child.data.materials.append(feather_material)
    append_normalized(
        ASSETS / "笔记本（用于第一个剧情点）" / "binder_notebook_2k.blend",
        root_name="medical_basement_notebook",
        target_dimensions=(0.52, 0.36, 0.09),
    )
    normalize_images()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(f"Exported {OUTPUT}")


if __name__ == "__main__":
    main()
