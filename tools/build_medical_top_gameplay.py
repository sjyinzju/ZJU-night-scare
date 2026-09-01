"""Build independently streamed top-floor medical gameplay assets.

Run from the repository root:
    blender --background --python tools/build_medical_top_gameplay.py

The source files stay untouched. Output GLBs use the final Three.js runtime
coordinate frame (Blender X, -Y, Z -> Three X, Z, Z-runtime) and therefore do
not receive the stacked-building offset used by medical-top.glb.
"""

from __future__ import annotations

from math import radians
from pathlib import Path
import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "3D_Assets"
OUT = ROOT / "public/models/interiors/medical-school"


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum


def place(objects, runtime_x: float, runtime_z: float, scale: float, rotation_deg: float = 0) -> None:
    minimum, maximum = bounds(objects)
    source_center = Vector(((minimum.x + maximum.x) * 0.5, (minimum.y + maximum.y) * 0.5, minimum.z))
    transform = (
        Matrix.Translation(Vector((runtime_x, -runtime_z, 0)))
        @ Matrix.Rotation(radians(rotation_deg), 4, "Z")
        @ Matrix.Scale(scale, 4)
        @ Matrix.Translation(-source_center)
    )
    for obj in objects:
        obj.matrix_world = transform @ obj.matrix_world


def root_objects(objects, name: str):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for obj in objects:
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()
    return root


def remove_unselected(keep) -> None:
    keep_set = set(keep)
    for obj in list(bpy.context.scene.objects):
        if obj not in keep_set and obj.type in {"MESH", "EMPTY", "LIGHT", "CAMERA"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def decimate(objects, ratio: float) -> None:
    """Reduce source meshes for small, dark runtime props without touching the source blend."""
    for obj in objects:
        if obj.type != "MESH" or len(obj.data.polygons) < 2_000:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new(name="medical_runtime_decimate", type="DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError:
            obj.modifiers.remove(modifier)


def resize_runtime_images(max_side: int = 2048) -> None:
    """Cap oversized packed textures; originals on disk remain unchanged."""
    for image in bpy.data.images:
        width, height = image.size[:]
        if width <= 0 or height <= 0 or max(width, height) <= max_side:
            continue
        scale = max_side / max(width, height)
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))


def remove_missing_image_nodes(objects) -> None:
    """Prevent Blender from emitting texture entries with no image source."""
    materials = {material for obj in objects if obj.type == "MESH" for material in obj.data.materials if material}
    for material in materials:
        if not material.use_nodes:
            continue
        for node in list(material.node_tree.nodes):
            if node.type != "TEX_IMAGE":
                continue
            image = node.image
            if image is None or min(image.size[:]) <= 0:
                material.node_tree.nodes.remove(node)


def export(objects, filename: str, optimize_images: bool = False) -> None:
    remove_missing_image_nodes(objects)
    if optimize_images:
        resize_runtime_images()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    path = OUT / filename
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_image_format="WEBP" if optimize_images else "AUTO",
        export_image_quality=82,
        export_image_webp_fallback=False,
    )
    print(f"MEDICAL_TOP_ASSET {filename}: {len([obj for obj in objects if obj.type == 'MESH'])} meshes -> {path}")


def append_meshes(filepath: Path):
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(str(filepath), link=False) as (data_from, data_to):
        data_to.objects = [name for name in data_from.objects]
    for obj in data_to.objects:
        if obj is not None and obj.type == "MESH":
            bpy.context.scene.collection.objects.link(obj)
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def import_fbx(filepath: Path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(filepath))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def build_601() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(ASSETS / "601.blend"))
    discard = {"G-__555564", "G-__555582", "G-__555573"}
    keep = [obj for obj in mesh_objects() if obj.name not in discard]
    remove_unselected(keep)
    place(keep, -3.67, 4.15, 0.78, 90)
    root = root_objects(keep, "medical_room_601")
    export([root, *keep], "medical-top-601.glb")


def build_603() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(ASSETS / "603.blend"))
    keep_names = {
        "Cylinder.017", "Cylinder.018", "Cylinder.023", "Mop", "Painting",
        "Plane.007", "Plane.008", "Biohazard", "Cylinder.003", "Cylinder.021", "Cylinder.020",
    }
    keep = [obj for obj in mesh_objects() if obj.name in keep_names]
    remove_unselected(keep)
    place(keep, 0.28, 4.45, 0.42, 90)

    # The already-streamed corridor bed is moved into 603 at runtime, avoiding
    # a second copy of its mesh and three large PBR textures in this segment.
    skull = [obj for obj in append_meshes(ASSETS / "骷髅头/Cycles.blend") if "lamp" not in obj.name.lower()]
    decimate(skull, 0.14)
    skull_min, skull_max = bounds(skull)
    skull_scale = 0.23 / max(0.001, skull_max.x - skull_min.x)
    # Face the skull back toward the approach path inside 603. The source
    # asset's forward axis was reversed in the first runtime export.
    place(skull, 0.28, 3.94, skull_scale, 188)
    for obj in skull:
        obj.matrix_world.translation.z += 0.93
    skull_root = root_objects(skull, "medical_603_skull")

    medicine = append_meshes(ASSETS / "Medicine+bottle/Medicine bottle/Medicine bottle.blend")
    med_min, med_max = bounds(medicine)
    med_scale = 0.16 / max(0.001, med_max.z - med_min.z)
    place(medicine, 1.42, 4.74, med_scale, 0)
    for obj in medicine:
        obj.matrix_world.translation.z += 0.82
    medicine_root = root_objects(medicine, "medical_603_sedative")

    fuse = import_fbx(ASSETS / "保险丝.fbx")
    fuse_min, fuse_max = bounds(fuse)
    fuse_scale = 0.15 / max(0.001, max((fuse_max - fuse_min)[:]))
    place(fuse, 0.32, 4.94, fuse_scale, 90)
    for obj in fuse:
        obj.matrix_world.translation.z += 0.84
    fuse_root = root_objects(fuse, "medical_603_fuse")

    all_meshes = [*keep, *skull, *medicine, *fuse]
    root = root_objects(keep, "medical_room_603")
    export([root, skull_root, medicine_root, fuse_root, *all_meshes], "medical-top-603.glb", optimize_images=True)


def build_605() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(ASSETS / "605.blend"))
    keep = []
    for obj in mesh_objects():
        name = obj.name
        if name in {"Plane.004", "Plane.005"}:
            keep.append(obj)
        elif name in {
            "Estelle Desk Swivel Chair", "Estelle Desk Swivel Chair.001",
            "Apple iMac", "Apple iMac.001",
        }:
            keep.append(obj)
        elif name.startswith("TV"):
            suffix = int(name.split(".")[-1]) if "." in name else 0
            if suffix <= 7:
                keep.append(obj)
        elif name.startswith("10111_DVR"):
            suffix = int(name.split(".")[-1]) if "." in name else 0
            if suffix <= 2:
                keep.append(obj)
    remove_unselected(keep)
    for obj in keep:
        if obj.name.startswith("Estelle Desk Swivel Chair"):
            decimate([obj], 0.12)
        elif obj.name.startswith("Apple iMac"):
            decimate([obj], 0.14)
        elif obj.name.startswith("10111_DVR"):
            decimate([obj], 0.35)
    place(keep, 4.36, 4.3, 0.5, 90)
    root = root_objects(keep, "medical_room_605")
    export([root, *keep], "medical-top-605.glb", optimize_images=True)


def build_corridor_props() -> None:
    reset()
    bed = import_fbx(ASSETS / "HOSPITAL+Bed+50K.fbx")
    bed_min, bed_max = bounds(bed)
    scale = 2.0 / max(0.001, bed_max.x - bed_min.x)
    place(bed, 0, 0, scale, 0)
    root = root_objects(bed, "medical_corridor_bed")
    root.hide_render = False
    export([root, *bed], "medical-top-props.glb", optimize_images=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_601()
    build_603()
    build_605()
    build_corridor_props()
