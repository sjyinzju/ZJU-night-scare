"""Split the medical-school GLB into three runtime levels.

Run from the repository root:
    blender --background --python tools/build_medical_segments.py

The source GLB is never modified. The top segment also receives the notice
board reconstructed from the legacy Blender 2.66 ASCII FBX and its textures.
"""

from pathlib import Path
import bmesh
import bpy
import sys
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/models/interiors/medical-school/medical.glb"
OUTPUT_DIR = SOURCE.parent
NOTICE_ASSETS = ROOT / "3D_Assets/公告栏"

# Authored Blender Z coordinates. Floors are centred near 0.5, -4 and -10 m.
SEGMENTS = (
    ("top", -0.75, float("inf")),
    ("garage", -6.25, -0.75),
    ("basement", float("-inf"), -6.25),
)


def reset_and_import() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))


def keep_height_band(low: float, high: float) -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        mesh = obj.data.copy()
        obj.data = mesh
        bm = bmesh.new()
        bm.from_mesh(mesh)
        remove = []
        for face in bm.faces:
            world_z = (obj.matrix_world @ face.calc_center_median()).z
            if world_z < low or world_z >= high:
                remove.append(face)
        if remove:
            bmesh.ops.delete(bm, geom=remove, context="FACES")
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        if len(mesh.polygons) == 0:
            bpy.data.objects.remove(obj, do_unlink=True)


def image_material(name: str, color_path: Path, bump_path: Path, roughness: float):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (0.55, 0.38, 0.2, 1)
    material.roughness = roughness
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    color = nodes.new("ShaderNodeTexImage")
    color.name = f"{name}_color"
    color.image = bpy.data.images.load(str(color_path), check_existing=True)
    links.new(color.outputs["Color"], bsdf.inputs["Base Color"])

    bump_image = nodes.new("ShaderNodeTexImage")
    bump_image.name = f"{name}_bump"
    bump_image.image = bpy.data.images.load(str(bump_path), check_existing=True)
    bump_image.image.colorspace_settings.name = "Non-Color"
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.28
    bump.inputs["Distance"].default_value = 0.08
    links.new(bump_image.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def add_box(name: str, center, size, material, uv_rect=None) -> None:
    bpy.ops.mesh.primitive_cube_add(location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if uv_rect and obj.data.uv_layers.active:
        min_u, min_v, max_u, max_v = uv_rect
        for uv_loop in obj.data.uv_layers.active.data:
            uv_loop.uv.x = min_u + uv_loop.uv.x * (max_u - min_u)
            uv_loop.uv.y = min_v + uv_loop.uv.y * (max_v - min_v)


def add_notice_board() -> None:
    """Mount the board diagonally ahead of spawn, on the non-dead-end wall."""
    frame = image_material(
        "medical_notice_board_frame",
        NOTICE_ASSETS / "FrameTexture.png",
        NOTICE_ASSETS / "FrameTexture-bump.png",
        0.5,
    )
    cork = image_material(
        "medical_notice_board_cork",
        NOTICE_ASSETS / "plane.jpg",
        NOTICE_ASSETS / "plane-bump.jpg",
        0.88,
    )

    # Spawn is (326, 207); west (-X) is the open corridor direction. The
    # board is a few steps west and across the corridor on the +Y wall.
    # The clear wall bay between the two nearest doors is x=321.60..323.63.
    cx, wall_y, cz = 322.61, 210.88, 1.58
    width, height = 1.5, 0.96
    frame_width, depth = 0.095, 0.075
    add_box("medical_notice_board_cork", (cx, wall_y - 0.026, cz),
            (width - frame_width * 1.35, 0.035, height - frame_width * 1.35), cork)
    horizontal_wood = (0.15, 0.13, 0.72, 0.17)
    vertical_wood = (0.76, 0.05, 0.82, 0.65)
    add_box("medical_notice_board_frame_top", (cx, wall_y, cz + height / 2),
            (width, depth, frame_width), frame, horizontal_wood)
    add_box("medical_notice_board_frame_bottom", (cx, wall_y, cz - height / 2),
            (width, depth, frame_width), frame, horizontal_wood)
    add_box("medical_notice_board_frame_left", (cx - width / 2, wall_y, cz),
            (frame_width, depth, height), frame, vertical_wood)
    add_box("medical_notice_board_frame_right", (cx + width / 2, wall_y, cz),
            (frame_width, depth, height), frame, vertical_wood)

    anchor = bpy.data.objects.new("medical_notice_board_anchor", None)
    anchor.location = Vector((cx, wall_y - 0.12, cz))
    bpy.context.scene.collection.objects.link(anchor)


def export_segment(name: str, low: float, high: float) -> None:
    reset_and_import()
    keep_height_band(low, high)
    if name == "top":
        add_notice_board()

    for obj in bpy.context.scene.objects:
        obj.select_set(obj.type in {"MESH", "EMPTY"})
    output = OUTPUT_DIR / f"medical-{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    mesh_count = sum(1 for obj in bpy.context.scene.objects if obj.type == "MESH")
    print(f"MEDICAL_SEGMENT {name}: {mesh_count} meshes -> {output}")


if __name__ == "__main__":
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    requested = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else set()
    for segment in SEGMENTS:
        if requested and segment[0] not in requested:
            continue
        export_segment(*segment)
