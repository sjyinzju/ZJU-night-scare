from __future__ import annotations

import sys
from pathlib import Path

import bpy


def arg_after(name: str) -> Path:
    args = sys.argv[sys.argv.index("--") + 1 :]
    return Path(args[args.index(name) + 1]).resolve()


OUT_DIR = arg_after("--out")
OUT_DIR.mkdir(parents=True, exist_ok=True)
ROOM_W = 8.5
ROOM_L = 15.0
HALF_W = ROOM_W / 2
HALF_L = ROOM_L / 2
DIVIDER_Z = -HALF_L + 5.5
DIVIDER_START = -HALF_W + 0.3
DIVIDER_END = HALF_W - 0.3
DOOR_POSITION = 0.25


def material(name: str, color: tuple[float, float, float, float], alpha: float = 1.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Alpha"].default_value = alpha
        bsdf.inputs["Roughness"].default_value = 0.72
    if alpha < 1:
        mat.surface_render_method = "DITHERED"
    return mat


def box(name: str, x: float, z: float, w: float, d: float, h: float, mat, y: float | None = None):
    bpy.ops.mesh.primitive_cube_add(location=(x, z, h / 2 if y is None else y))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (w / 2, d / 2, h / 2)
    obj.data.materials.append(mat)


def curve(name: str, points: list[tuple[float, float]], mat):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = 0.06
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, (x, z) in zip(spline.points, points):
        point.co = (x, z, 0.14, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)


def label(text: str, x: float, z: float, mat):
    bpy.ops.object.text_add(location=(x, z, 0.2))
    obj = bpy.context.object
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.size = 0.44
    obj.data.extrude = 0.01
    obj.data.materials.append(mat)


def build(offset: float, fixed: bool, floor_mat, wall_mat, prop_mat, collider_mat, route_mat, clue_mat, text_mat):
    box("Floor", offset, 0, ROOM_W, ROOM_L, 0.05, floor_mat)
    box("OuterLeft", offset - HALF_W, 0, 0.28, ROOM_L, 0.25, wall_mat)
    box("OuterRight", offset + HALF_W, 0, 0.28, ROOM_L, 0.25, wall_mat)

    # Left loft desks. Red overlays are their runtime collision footprints.
    for index, z in enumerate((-3.6, 0.4)):
        box(f"LoftDesk_{index}", offset - HALF_W + 1.1, z, 1.4, 2.0, 1.0, prop_mat)
        box(f"COL_LoftDesk_{index}", offset - HALF_W + 1.1, z, 1.4, 2.0, 0.09, collider_mat)
    box("RightLoftDesk", offset + HALF_W - 1.1, -4.4, 1.4, 2.0, 1.0, prop_mat)
    box("Sink", offset, -HALF_L + 6.7, 0.6, 0.4, 0.8, prop_mat)

    door_w = 1.6 if fixed else 1.0
    length = DIVIDER_END - DIVIDER_START
    centre = DIVIDER_START + length * DOOR_POSITION
    left_len = centre - door_w / 2 - DIVIDER_START
    right_len = DIVIDER_END - (centre + door_w / 2)
    left_centre = DIVIDER_START + left_len / 2
    right_centre = centre + door_w / 2 + right_len / 2

    box("COL_DividerLeft", offset + left_centre, DIVIDER_Z, left_len + 0.12, 0.32, 0.09, collider_mat)
    box("COL_DividerRight", offset + right_centre, DIVIDER_Z, right_len + 0.12, 0.32, 0.09, collider_mat)

    if fixed:
        box("DividerLeft_FIXED", offset + left_centre, DIVIDER_Z, left_len, 0.2, 2.2, wall_mat)
        box("DividerRight_FIXED", offset + right_centre, DIVIDER_Z, right_len, 0.2, 2.2, wall_mat)
        left_jamb = offset + centre - door_w / 2
        box("Door_OPEN", left_jamb, DIVIDER_Z - door_w / 2, 0.06, door_w, 2.2, prop_mat)
        clue_x = offset - 2.0
        curve("ReachableRoute", [(offset, 5.6), (offset - 2.0, -1.4), (offset - 2.0, -2.6), (clue_x, -3.6)], route_mat)
        label("AFTER: clue in front of desk / working door", offset, HALF_L + 0.65, text_mat)
    else:
        # Old visible divider is rotated 90 degrees and the door has no collider.
        box("DividerLeft_BUG", offset + left_centre, DIVIDER_Z, 0.2, left_len, 2.2, wall_mat)
        box("DividerRight_BUG", offset + right_centre, DIVIDER_Z, 0.2, right_len, 2.2, wall_mat)
        clue_x = offset - HALF_W + 1.1
        curve("ClippedRoute", [(offset, 5.6), (offset - 2.0, -1.4), (clue_x, -3.6)], route_mat)
        label("BEFORE: clue inside loft-desk collider", offset, HALF_L + 0.65, text_mat)

    box("DormForumClue", clue_x, -3.6, 0.34, 0.34, 0.34, clue_mat, 0.75)


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    floor = material("Floor", (0.045, 0.055, 0.07, 1.0))
    wall = material("VisibleWall", (0.12, 0.36, 0.70, 1.0))
    props = material("DormProps", (0.36, 0.24, 0.15, 1.0))
    collider = material("Collider", (0.95, 0.04, 0.07, 0.52), 0.52)
    route = material("Route", (0.04, 1.0, 0.20, 1.0))
    clue = material("Clue", (1.0, 0.16, 0.06, 1.0))
    text_mat = material("Text", (1.0, 0.78, 0.18, 1.0))
    build(-5.3, False, floor, wall, props, collider, route, clue, text_mat)
    build(5.3, True, floor, wall, props, collider, route, clue, text_mat)

    world = bpy.data.worlds.new("DormBathroomReviewWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.01, 0.016, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 18))
    bpy.context.object.data.energy = 1900
    bpy.context.object.data.shape = "RECTANGLE"
    bpy.context.object.data.size = 24
    bpy.context.object.data.size_y = 18
    bpy.ops.object.camera_add(location=(0, 0, 26))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 18.8
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUT_DIR / "dorm_bathroom_before_after.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "dorm-bathroom-review.blend"))
    bpy.ops.render.render(write_still=True)
    print(f"DORM_BATHROOM_REVIEW_OK out={OUT_DIR}")


if __name__ == "__main__":
    main()
