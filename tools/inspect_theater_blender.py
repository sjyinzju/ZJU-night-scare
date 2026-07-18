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
STAGE_Z = -HALF_L + 3.5
STAGE_W = ROOM_W - 1.5
STAGE_D = 3.5
DIVIDER_Z = STAGE_Z - 0.5


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
    return obj


def curve(name: str, points: list[tuple[float, float]], mat, height: float = 0.13):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = 0.06
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, (x, z) in zip(spline.points, points):
        point.co = (x, z, height, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)


def label(text: str, x: float, z: float, mat):
    bpy.ops.object.text_add(location=(x, z, 0.2))
    obj = bpy.context.object
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.size = 0.42
    obj.data.extrude = 0.01
    obj.data.materials.append(mat)


def build(offset: float, fixed: bool, floor_mat, stage_mat, wall_mat, collider_mat, route_mat, clue_mat, text_mat):
    box("Floor", offset, 0, ROOM_W, ROOM_L, 0.05, floor_mat)
    box("OuterLeft", offset - HALF_W, 0, 0.28, ROOM_L, 0.25, wall_mat)
    box("OuterRight", offset + HALF_W, 0, 0.28, ROOM_L, 0.25, wall_mat)
    box("Stage", offset, STAGE_Z, STAGE_W, STAGE_D, 0.5, stage_mat)

    # Three audience benches and their runtime collision footprints.
    for row in range(3):
        z = STAGE_Z + 2.5 + row * 1.8
        box(f"Bench_{row}", offset, z, 4.5, 0.4, 0.18, wall_mat)
        box(f"COL_Bench_{row}", offset, z, 4.6, 0.6, 0.09, collider_mat)

    door_w = 1.6 if fixed else 1.0
    start = -HALF_W + 0.3
    end = HALF_W - 0.3
    length = end - start
    centre = start + length * 0.6
    left_len = centre - door_w / 2 - start
    right_len = end - (centre + door_w / 2)
    left_centre = start + left_len / 2
    right_centre = centre + door_w / 2 + right_len / 2

    # Red proxies show actual runtime wall collisions (correctly horizontal).
    box("COL_DividerLeft", offset + left_centre, DIVIDER_Z, left_len + 0.12, 0.32, 0.09, collider_mat)
    box("COL_DividerRight", offset + right_centre, DIVIDER_Z, right_len + 0.12, 0.32, 0.09, collider_mat)

    if fixed:
        box("DividerLeft_FIXED", offset + left_centre, DIVIDER_Z, left_len, 0.2, 2.2, wall_mat)
        box("DividerRight_FIXED", offset + right_centre, DIVIDER_Z, right_len, 0.2, 2.2, wall_mat)
        left_jamb = offset + centre - door_w / 2
        box("Door_OPEN", left_jamb, DIVIDER_Z - door_w / 2, 0.06, door_w, 2.2, stage_mat)
        curve("ReachableRoute", [(offset, 6.2), (offset + 3.7, 4.0), (offset + 3.7, -1.7), (offset + 3.3, -2.2)], route_mat)
        curve("ReachableRouteOnStage", [(offset + 3.3, -2.2), (offset, STAGE_Z + 1.2)], route_mat, 0.62)
        label("AFTER: walkable stage + aligned open door", offset, HALF_L + 0.65, text_mat)
    else:
        # Old stage collider makes its entire footprint an impassable wall.
        box("COL_Stage_BUG", offset, STAGE_Z, STAGE_W, STAGE_D, 0.1, collider_mat)
        # Old visible divider segments are rotated 90 degrees.
        box("DividerLeft_BUG", offset + left_centre, DIVIDER_Z, 0.2, left_len, 2.2, wall_mat)
        box("DividerRight_BUG", offset + right_centre, DIVIDER_Z, 0.2, right_len, 2.2, wall_mat)
        curve("BlockedRoute", [(offset, 6.2), (offset + 3.7, 4.0), (offset + 3.7, -1.7)], route_mat)
        label("BEFORE: stage collider seals the clue", offset, HALF_L + 0.65, text_mat)

    box("FinalPlanClue", offset, STAGE_Z + 1.2, 0.34, 0.34, 0.34, clue_mat, 0.72)


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    floor = material("Floor", (0.045, 0.055, 0.07, 1.0))
    stage = material("Stage", (0.34, 0.20, 0.12, 1.0))
    wall = material("VisibleWall", (0.12, 0.36, 0.70, 1.0))
    collider = material("Collider", (0.95, 0.04, 0.07, 0.52), 0.52)
    route = material("Route", (0.04, 1.0, 0.20, 1.0))
    clue = material("Clue", (1.0, 0.16, 0.06, 1.0))
    text_mat = material("Text", (1.0, 0.78, 0.18, 1.0))

    build(-5.3, False, floor, stage, wall, collider, route, clue, text_mat)
    build(5.3, True, floor, stage, wall, collider, route, clue, text_mat)

    world = bpy.data.worlds.new("TheaterReviewWorld")
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
    scene.render.filepath = str(OUT_DIR / "theater_clue_before_after.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "theater-clue-review.blend"))
    bpy.ops.render.render(write_still=True)
    print(f"THEATER_REVIEW_OK out={OUT_DIR}")


if __name__ == "__main__":
    main()
