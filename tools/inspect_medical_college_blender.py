from __future__ import annotations

import math
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
DIVIDER_Z = -HALF_L + 5.2
DIVIDER_START = -HALF_W + 0.3
DIVIDER_END = HALF_W - 0.3
DOOR_WIDTH = 1.6


def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


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


def curve(name: str, points: list[tuple[float, float]], mat, z_height: float = 0.12, bevel: float = 0.055):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = bevel
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, (x, z) in zip(spline.points, points):
        point.co = (x, z, z_height, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def label(text: str, x: float, z: float, mat):
    bpy.ops.object.text_add(location=(x, z, 0.18), rotation=(0, 0, 0))
    obj = bpy.context.object
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.size = 0.48
    obj.data.extrude = 0.01
    obj.data.materials.append(mat)


def build_room(offset: float, fixed: bool, visual_mat, collider_mat, route_mat, floor_mat, prop_mat, text_mat):
    # Runtime room footprint and representative medical furniture.
    box("Floor", offset, 0, ROOM_W, ROOM_L, 0.05, floor_mat)
    box("WallLeft", offset - HALF_W, 0, 0.28, ROOM_L, 0.3, visual_mat)
    box("WallRight", offset + HALF_W, 0, 0.28, ROOM_L, 0.3, visual_mat)
    box("WallFront", offset, -HALF_L, ROOM_W, 0.28, 0.3, visual_mat)
    box("WallBack", offset, HALF_L, ROOM_W, 0.28, 0.3, visual_mat)

    for idx, z in enumerate((-3.5, 0.1, 3.7), start=1):
        box(f"Bed_{idx}", offset - HALF_W + 1.3, z, 1.0, 2.0, 0.5, prop_mat)
    box("Cabinet_1", offset + HALF_W - 1.1, -2.5, 1.0, 0.6, 1.5, prop_mat)
    box("Cabinet_2", offset + HALF_W - 1.1, 1.5, 1.0, 0.6, 1.5, prop_mat)
    box("Desk", offset + HALF_W - 2.6, 4.2, 1.1, 0.7, 0.78, prop_mat)
    box("EntranceCabinet", offset + 1.4, HALF_L - 3.0, 0.6, 0.6, 0.9, prop_mat)

    door_width = DOOR_WIDTH
    segment_len = (DIVIDER_END - DIVIDER_START - door_width) / 2
    left_center = (DIVIDER_START + (-door_width / 2)) / 2
    right_center = ((door_width / 2) + DIVIDER_END) / 2

    # Red footprints are the actual collision AABBs used at runtime.
    box("COL_DividerLeft", offset + left_center, DIVIDER_Z, segment_len + 0.12, 0.32, 0.12, collider_mat)
    box("COL_DividerRight", offset + right_center, DIVIDER_Z, segment_len + 0.12, 0.32, 0.12, collider_mat)

    box("DividerVisibleLeft", offset + left_center, DIVIDER_Z, segment_len, 0.2, 2.2, visual_mat)
    box("DividerVisibleRight", offset + right_center, DIVIDER_Z, segment_len, 0.2, 2.2, visual_mat)

    if fixed:
        # Correct 90-degree opening around the left jamb. The leaf is edge-on
        # to the doorway and the runtime collider is disabled while open.
        left_jamb = offset - door_width / 2
        box("DoorPanel_OPEN_90", left_jamb, DIVIDER_Z - door_width / 2, 0.06, door_width, 2.2, prop_mat)
        curve("WalkableRoute_FIXED", [(offset, 6.3), (offset, -4.4)], route_mat)
        label("AFTER: left hinge + full 90deg opening", offset, HALF_L + 0.7, text_mat)
    else:
        # Bug reproduced from the screenshot: the doorway centre is used as
        # the pivot, so the closed leaf starts at the centre and half embeds
        # into the right wall, visually resembling a half-open door.
        box("DoorPanel_HALF_BUG", offset + door_width / 2, DIVIDER_Z, door_width, 0.06, 2.2, prop_mat)
        box("COL_ClosedDoor", offset, DIVIDER_Z, door_width, 0.16, 0.14, collider_mat)
        curve("BlockedRoute_BUG", [(offset, 6.3), (offset, DIVIDER_Z + 0.35)], route_mat)
        label("BEFORE: centre pivot / half leaf", offset, HALF_L + 0.7, text_mat)


def main() -> None:
    clear()
    visual = material("VisibleGeometry", (0.10, 0.38, 0.75, 1.0))
    collider = material("CollisionProxy", (0.95, 0.05, 0.08, 0.58), 0.58)
    route = material("PlayerRoute", (0.05, 1.0, 0.22, 1.0))
    floor = material("Floor", (0.055, 0.07, 0.09, 1.0))
    props = material("MedicalProps", (0.38, 0.46, 0.48, 1.0))
    text_mat = material("Labels", (1.0, 0.78, 0.18, 1.0))

    build_room(-5.3, False, visual, collider, route, floor, props, text_mat)
    build_room(5.3, True, visual, collider, route, floor, props, text_mat)

    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("MedicalCollegeReviewWorld")
        bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.012, 0.018, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22

    bpy.ops.object.light_add(type="AREA", location=(0, 0, 18))
    light = bpy.context.object
    light.data.energy = 1900
    light.data.shape = "RECTANGLE"
    light.data.size = 24
    light.data.size_y = 18

    bpy.ops.object.camera_add(location=(0, 0, 26), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 18.8
    camera.rotation_euler = (0, 0, 0)
    # Blender camera looks down local -Z by default.
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(OUT_DIR / "medical_college_door_before_after.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "medical-college-door-review.blend"))
    bpy.ops.render.render(write_still=True)
    print(f"MEDICAL_COLLEGE_REVIEW_OK out={OUT_DIR}")


if __name__ == "__main__":
    main()
