"""Generate the remaining stylised campus exteriors for the 2.5D map.

The game keeps ownership of placement, collision, roads, entrances and story
state.  Each Blender file produced here is an editable exterior source and each
PNG is a transparent orthographic sprite.  Set ``ZJU_BUILDING_ID`` to build one
asset, or leave it unset to build the complete missing set.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
BUILDING_ROOT = ROOT / "buildings"
sys.path.insert(0, str(ROOT))

from create_remaining_story_buildings import (  # noqa: E402
    box,
    clean_scene,
    cylinder,
    link_to,
    look_at,
    material,
)


SPECS = {
    "main-gate": {"name": "紫金港南大门", "footprint": (4.2, 0.7, 1.4), "form": "gate", "ortho": 8.3},
    "dorm-lantian": {"name": "蓝田宿舍区", "footprint": (5.8, 3.0, 5.2), "form": "dorm-twin", "ortho": 11.5},
    "dorm-danyang": {"name": "丹阳宿舍区", "footprint": (4.3, 2.6, 3.0), "form": "dorm-court", "ortho": 9.4},
    "dorm-cuibai": {"name": "翠柏宿舍区", "footprint": (4.0, 2.3, 3.0), "form": "dorm-terrace", "ortho": 9.0},
    "west-teaching": {"name": "东教学区旧楼", "footprint": (2.3, 1.5, 3.1), "form": "old-school", "ortho": 7.4},
    "ocean-building": {"name": "图书信息中心", "footprint": (2.2, 1.2, 3.6), "form": "info-center", "ortho": 10.3},
    "qiushi-auditorium": {"name": "求是大讲堂", "footprint": (1.8, 1.4, 3.8), "form": "auditorium", "ortho": 9.7},
    "marine-lab": {"name": "海洋试验厅", "footprint": (2.5, 1.5, 3.0), "form": "marine-lab", "ortho": 7.7},
    "engineering-lab": {"name": "建工实验厅", "footprint": (1.7, 2.7, 3.6), "form": "engineering-lab", "ortho": 10.8},
    "library": {"name": "基础图书馆", "footprint": (3.2, 3.0, 7.2), "form": "library", "ortho": 13.2},
    "east-teaching-5": {"name": "东5教学楼", "footprint": (2.5, 1.6, 3.0), "form": "east-5", "ortho": 7.8},
    "east-teaching-6": {"name": "东6教学楼", "footprint": (2.4, 1.5, 3.5), "form": "east-6", "ortho": 8.0},
    "east-teaching-7": {"name": "东7教学楼", "footprint": (2.6, 1.6, 3.2), "form": "east-7", "ortho": 8.0},
    "gym": {"name": "体育馆", "footprint": (3.5, 1.9, 3.4), "form": "gym", "ortho": 8.8},
    "life-science": {"name": "生命科学学院", "footprint": (4.0, 2.0, 3.8), "form": "life-science", "ortho": 10.2},
    "environment-college": {"name": "环境与资源学院", "footprint": (2.4, 3.4, 4.6), "form": "environment", "ortho": 11.2},
    "crescent-building": {"name": "月牙楼", "footprint": (5.2, 2.8, 3.2), "form": "crescent", "ortho": 10.3},
    "admin-center": {"name": "行政楼", "footprint": (5.6, 3.0, 4.2), "form": "admin-eye", "ortho": 11.2},
}


def collections(scene):
    shell = bpy.data.collections.new("BUILDING_SHELL")
    facade = bpy.data.collections.new("FACADE_DETAILS")
    landmark = bpy.data.collections.new("LANDMARK_FEATURES")
    fx = bpy.data.collections.new("CAMERA_AND_LIGHTS")
    for collection in (shell, facade, landmark, fx):
        scene.collection.children.link(collection)
    return shell, facade, landmark, fx


def materials(style: str):
    palettes = {
        "dorm": ((0.36, 0.34, 0.31), (0.13, 0.17, 0.17), (0.045, 0.14, 0.15), (0.58, 0.28, 0.07)),
        "brick": ((0.34, 0.19, 0.15), (0.12, 0.12, 0.12), (0.035, 0.12, 0.14), (0.62, 0.25, 0.05)),
        "academic": ((0.34, 0.37, 0.35), (0.11, 0.15, 0.15), (0.035, 0.14, 0.16), (0.55, 0.27, 0.06)),
        "science": ((0.30, 0.35, 0.32), (0.08, 0.14, 0.13), (0.025, 0.15, 0.16), (0.47, 0.26, 0.07)),
        "public": ((0.37, 0.34, 0.31), (0.10, 0.13, 0.14), (0.04, 0.12, 0.15), (0.64, 0.29, 0.05)),
    }
    wall, roof, glass, warm = palettes[style]
    return {
        "wall": material(f"{style}_wall", wall, roughness=0.78),
        "wall_dark": material(f"{style}_wall_shadow", tuple(max(0, c - 0.09) for c in wall), roughness=0.82),
        "roof": material(f"{style}_roof", roof, metallic=0.12, roughness=0.52),
        "glass": material(f"{style}_night_glass", glass, metallic=0.18, roughness=0.24),
        "frame": material(f"{style}_frame", (0.045, 0.10, 0.10), metallic=0.14, roughness=0.42),
        "warm": material(
            f"{style}_warm_window",
            warm,
            roughness=0.32,
            emission=(1.0, 0.28, 0.04),
            emission_strength=0.48,
        ),
        "red": material(
            f"{style}_warning_red",
            (0.42, 0.025, 0.018),
            roughness=0.35,
            emission=(1.0, 0.015, 0.008),
            emission_strength=0.40,
        ),
    }


def extruded_polygon(name, points, height, mat, collection, z0=0.0):
    count = len(points)
    verts = [(x, y, z0) for x, y in points] + [(x, y, z0 + height) for x, y in points]
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("ink_soft_bevel", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 2
    return obj


def front_windows(prefix, width, front_y, floors, columns, height, mats, facade, warm_step=7):
    z_gap = height / (floors + 0.6)
    usable = width * 0.86
    for floor in range(floors):
        z = 0.42 + floor * z_gap
        for col in range(columns):
            x = -usable / 2 + usable * (col + 0.5) / columns
            window_mat = mats["warm"] if (floor * columns + col) % warm_step == 0 else mats["glass"]
            box(
                f"{prefix}_WINDOW_{floor+1}_{col+1}",
                (x, front_y, z),
                (usable / columns * 0.62, 0.045, min(0.34, z_gap * 0.48)),
                window_mat,
                facade,
                bevel=0.006,
            )
        box(f"{prefix}_BAND_{floor+1}", (0, front_y + 0.006, z - 0.24), (width * 0.94, 0.035, 0.055), mats["frame"], facade, 0.004)


def roof_cap(prefix, width, depth, z, mats, shell):
    box(f"{prefix}_ROOF_CAP", (0, 0, z), (width + 0.16, depth + 0.16, 0.15), mats["roof"], shell, 0.03)


def entrance(prefix, x, front_y, height, mats, landmark, *, red=False):
    glass = mats["red"] if red else mats["glass"]
    box(f"{prefix}_ENTRY_GLASS", (x, front_y, height * 0.52), (0.74, 0.065, height), glass, landmark, 0.012)
    box(f"{prefix}_ENTRY_CANOPY", (x, front_y - 0.20, height + 0.08), (1.18, 0.48, 0.12), mats["roof"], landmark, 0.025)
    box(f"{prefix}_ENTRY_STEP", (x, front_y - 0.32, 0.10), (1.18, 0.54, 0.18), mats["wall_dark"], landmark, 0.025)


def build_gate(shell, facade, landmark, mats):
    box("GATE_WEST_PIER", (-2.35, 0, 1.05), (0.78, 0.82, 2.10), mats["wall"], shell, 0.08)
    box("GATE_EAST_PIER", (2.35, 0, 1.05), (0.78, 0.82, 2.10), mats["wall"], shell, 0.08)
    box("GATE_TOP_BEAM", (0, 0, 2.06), (5.45, 0.72, 0.35), mats["roof"], shell, 0.045)
    box("GATE_NAME_BAND", (0, -0.39, 1.92), (3.55, 0.05, 0.22), mats["warm"], facade, 0.008)
    for i, x in enumerate((-1.55, -0.78, 0, 0.78, 1.55)):
        box(f"GATE_VERTICAL_{i}", (x, 0, 0.88), (0.10, 0.64, 1.65), mats["frame"], landmark, 0.012)
    cylinder("GATE_SEAL", (-2.35, -0.44, 1.28), 0.25, 0.07, mats["red"], facade, 40).rotation_euler.x = math.radians(90)


def build_dorm(form, shell, facade, landmark, mats):
    if form == "dorm-twin":
        specs = [(-2.0, 0.25, 1.25, 1.65, 2.25, 4.7), (1.85, 0.18, 1.38, 1.75, 2.20, 5.15)]
        for index, (x, y, z, w, d, h) in enumerate(specs):
            box(f"LANTIAN_TOWER_{index}", (x, y, z + h / 2 - 1.2), (w, d, h), mats["wall"], shell, 0.075)
            roof_cap(f"LANTIAN_{index}", w, d, h, mats, shell)
            front_windows(f"LANTIAN_{index}", w, y - d / 2 - 0.025, 6, 4, h, mats, facade, 9 + index)
        box("LANTIAN_LOW_LINK", (0, 0.62, 0.78), (4.4, 1.35, 1.55), mats["wall_dark"], shell, 0.07)
        entrance("LANTIAN", 0, -0.10, 1.18, mats, landmark)
    elif form == "dorm-court":
        for index, x in enumerate((-1.42, 1.42)):
            box(f"DANYANG_WING_{index}", (x, 0.25, 1.52), (1.38, 2.45, 3.04), mats["wall"], shell, 0.07)
            front_windows(f"DANYANG_{index}", 1.38, -1.0, 4, 3, 3.0, mats, facade, 8 + index)
        box("DANYANG_REAR_LINK", (0, 0.94, 1.22), (2.15, 0.92, 2.45), mats["wall_dark"], shell, 0.06)
        entrance("DANYANG", 0, -1.22, 1.35, mats, landmark)
    else:
        box("CUIBAI_TERRACE_BASE", (0, 0.22, 0.75), (4.15, 2.35, 1.50), mats["wall_dark"], shell, 0.08)
        for index, (x, z) in enumerate(((-1.35, 1.72), (0, 2.02), (1.35, 2.32))):
            box(f"CUIBAI_STEP_{index}", (x, 0.34, z / 2 + 0.68), (1.34, 1.92, z), mats["wall"], shell, 0.065)
            front_windows(f"CUIBAI_{index}", 1.34, -0.64, 3, 3, z, mats, facade, 7 + index)
        entrance("CUIBAI", 0, -1.10, 1.25, mats, landmark)


def build_academic(building_id, form, shell, facade, landmark, mats):
    if form == "old-school":
        box("OLD_SCHOOL_MAIN", (0, 0.10, 1.55), (3.8, 2.2, 3.10), mats["wall"], shell, 0.07)
        box("OLD_SCHOOL_STAIR", (1.45, 0.22, 2.08), (0.72, 1.75, 4.15), mats["wall_dark"], shell, 0.06)
        front_windows("OLD_SCHOOL", 3.8, -1.02, 4, 7, 3.1, mats, facade, 11)
        entrance("OLD_SCHOOL", -0.65, -1.14, 1.28, mats, landmark)
        roof_cap("OLD_SCHOOL", 3.8, 2.2, 3.18, mats, shell)
        return
    if form == "info-center":
        box("INFO_CENTER_PODIUM", (0, 0.10, 0.68), (3.8, 2.0, 1.36), mats["wall_dark"], shell, 0.08)
        box("INFO_CENTER_BOOK_TOWER", (-0.50, 0.18, 2.32), (2.45, 1.55, 4.65), mats["wall"], shell, 0.075)
        box("INFO_CENTER_GLASS_SPINE", (1.20, -0.18, 2.10), (0.72, 1.22, 4.15), mats["glass"], landmark, 0.035)
        front_windows("INFO_CENTER", 2.45, -0.61, 5, 5, 4.6, mats, facade, 9)
        entrance("INFO_CENTER", 0.75, -1.04, 1.35, mats, landmark)
        return
    if form in {"east-5", "east-6", "east-7"}:
        variant = int(form[-1])
        width = {5: 4.45, 6: 4.15, 7: 4.55}[variant]
        height = {5: 3.05, 6: 3.55, 7: 3.25}[variant]
        if variant == 5:
            box("EAST5_LOWER", (-0.35, 0.15, 1.05), (3.55, 2.40, 2.10), mats["wall"], shell, 0.07)
            box("EAST5_UPPER", (0.55, 0.32, 2.40), (2.75, 1.72, 2.05), mats["wall_dark"], shell, 0.065)
        elif variant == 6:
            box("EAST6_BAR", (0, 0.18, height / 2), (width, 2.35, height), mats["wall"], shell, 0.07)
            box("EAST6_GLASS_NOTCH", (0, -1.02, 1.42), (0.82, 0.08, 2.45), mats["glass"], landmark, 0.012)
        else:
            box("EAST7_WEST", (-1.18, 0.18, 1.62), (1.78, 2.35, 3.24), mats["wall"], shell, 0.07)
            box("EAST7_EAST", (1.18, 0.18, 1.62), (1.78, 2.35, 3.24), mats["wall_dark"], shell, 0.07)
            box("EAST7_SKYBRIDGE", (0, 0.18, 2.18), (1.10, 1.68, 0.62), mats["glass"], landmark, 0.04)
        roof_cap(f"EAST{variant}", width, 2.35, height + 0.04, mats, shell)
        front_windows(f"EAST{variant}", width, -1.02, 4, 8, height, mats, facade, 10 + variant)
        for x in (-1.75, -1.15, -0.55, 0.55, 1.15, 1.75):
            box(f"EAST{variant}_GREEN_FIN_{x}", (x, -1.06, height * 0.54), (0.055, 0.05, height * 0.76), mats["frame"], facade, 0.004)
        entrance(f"EAST{variant}", 0, -1.18, 1.24, mats, landmark)
        return
    if form == "life-science":
        box("LIFE_LONG_PODIUM", (0, 0.16, 0.92), (5.4, 2.55, 1.84), mats["wall_dark"], shell, 0.08)
        box("LIFE_RESEARCH_BAR", (-0.25, 0.28, 2.62), (4.55, 2.05, 3.42), mats["wall"], shell, 0.075)
        box("LIFE_GREENHOUSE", (1.60, -0.58, 3.62), (1.05, 0.82, 1.20), mats["glass"], landmark, 0.035)
        front_windows("LIFE", 4.55, -0.76, 5, 9, 4.3, mats, facade, 13)
        entrance("LIFE", -0.75, -1.25, 1.32, mats, landmark)
        return
    if form == "environment":
        box("ENV_BASE", (0, 0.30, 1.05), (3.45, 3.85, 2.10), mats["wall_dark"], shell, 0.08)
        box("ENV_TOWER", (0.18, 0.42, 3.18), (2.35, 2.72, 4.85), mats["wall"], shell, 0.075)
        box("ENV_VERTICAL_GARDEN", (-1.08, -0.55, 2.65), (0.38, 1.72, 3.25), mats["frame"], landmark, 0.035)
        front_windows("ENV", 2.35, -0.96, 6, 5, 5.45, mats, facade, 11)
        entrance("ENV", 0.58, -1.66, 1.38, mats, landmark)
        return
    if form == "marine-lab":
        box("MARINE_WAVE_BASE", (0, 0.14, 0.85), (4.25, 2.25, 1.70), mats["wall_dark"], shell, 0.09)
        box("MARINE_LAB_BAR", (-0.30, 0.25, 2.08), (3.45, 1.82, 2.75), mats["wall"], shell, 0.075)
        cylinder("MARINE_OBSERVATION_DRUM", (1.62, -0.20, 1.72), 0.72, 3.15, mats["glass"], landmark, 48)
        front_windows("MARINE", 3.45, -0.68, 4, 7, 3.35, mats, facade, 10)
        entrance("MARINE", -0.65, -1.05, 1.24, mats, landmark)
        return
    if form == "engineering-lab":
        box("ENGINEERING_LONG_HALL", (0, 0.15, 1.45), (3.0, 4.35, 2.90), mats["wall"], shell, 0.08)
        box("ENGINEERING_TEST_TOWER", (0.76, 0.62, 2.75), (1.05, 2.40, 5.50), mats["wall_dark"], shell, 0.07)
        for z in (1.1, 2.0, 2.9, 3.8, 4.7):
            box(f"ENGINEERING_SLOT_{z}", (0.76, -0.61, z), (0.50, 0.055, 0.26), mats["glass"], facade, 0.006)
        front_windows("ENGINEERING", 3.0, -2.05, 4, 5, 3.0, mats, facade, 9)
        entrance("ENGINEERING", -0.55, -2.22, 1.30, mats, landmark)


def build_auditorium(shell, facade, landmark, mats):
    box("QIUSHI_HALL", (0, 0.25, 1.15), (3.70, 2.75, 2.30), mats["wall"], shell, 0.12)
    box("QIUSHI_STAGE_TOWER", (0.35, 0.55, 2.55), (2.25, 1.72, 4.25), mats["wall_dark"], shell, 0.10)
    box("QIUSHI_WIDE_STAIR", (0, -1.52, 0.18), (2.55, 0.88, 0.32), mats["wall_dark"], landmark, 0.04)
    for i, x in enumerate((-1.25, -0.62, 0, 0.62, 1.25)):
        box(f"QIUSHI_COLUMN_{i}", (x, -1.19, 1.28), (0.13, 0.13, 2.30), mats["frame"], facade, 0.016)
    box("QIUSHI_GLOWING_LOBBY", (0, -1.25, 1.18), (2.72, 0.06, 1.56), mats["warm"], facade, 0.012)
    roof_cap("QIUSHI", 3.75, 2.80, 2.38, mats, shell)


def build_library(shell, facade, landmark, mats):
    box("LIBRARY_PODIUM", (0, 0.25, 1.25), (5.15, 4.65, 2.50), mats["wall_dark"], shell, 0.11)
    box("LIBRARY_MIDDLE", (0.15, 0.35, 3.35), (3.85, 3.55, 4.05), mats["wall"], shell, 0.10)
    box("LIBRARY_CROWN", (0.28, 0.42, 6.05), (2.25, 2.20, 2.45), mats["wall"], shell, 0.09)
    box("LIBRARY_TOP_LANTERN", (0.28, 0.20, 7.55), (1.25, 1.25, 0.75), mats["glass"], landmark, 0.055)
    for width, y, z, floors, cols in ((5.15, -2.10, 1.65, 2, 9), (3.85, -1.44, 3.55, 4, 7), (2.25, -0.70, 6.15, 3, 4)):
        front_windows(f"LIBRARY_{int(z*10)}", width, y, floors, cols, max(2.0, z), mats, facade, 12)
    entrance("LIBRARY", 0, -2.42, 1.60, mats, landmark, red=True)
    for z, w, d in ((2.55, 5.3, 4.8), (5.42, 4.0, 3.7), (7.32, 2.4, 2.35)):
        roof_cap(f"LIBRARY_{z}", w, d, z, mats, shell)


def build_gym(shell, facade, landmark, mats):
    cylinder("GYM_OVAL_BASE", (0, 0.10, 0.88), 2.25, 1.76, mats["wall_dark"], shell, 64).scale.y = 0.58
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=24, location=(0, 0.18, 2.05), scale=(2.15, 1.30, 1.05))
    roof = bpy.context.object
    roof.name = "GYM_CURVED_ROOF"
    roof.data.materials.append(mats["roof"])
    link_to(roof, shell)
    box("GYM_GLASS_ENTRY", (0, -1.30, 1.08), (1.65, 0.08, 1.55), mats["glass"], landmark, 0.02)
    box("GYM_ENTRY_CANOPY", (0, -1.52, 1.82), (2.2, 0.58, 0.14), mats["roof"], landmark, 0.03)
    for index, x in enumerate((-1.55, -1.05, -0.55, 0.55, 1.05, 1.55)):
        box(f"GYM_FIN_{index}", (x, -1.14, 1.10), (0.08, 0.07, 1.45), mats["frame"], facade, 0.006)


def build_crescent(shell, facade, landmark, mats):
    outer = 3.0
    inner = 1.75
    points = []
    for i in range(33):
        angle = math.radians(-142 + 284 * i / 32)
        points.append((math.cos(angle) * outer, math.sin(angle) * outer * 0.58))
    for i in range(32, -1, -1):
        angle = math.radians(-132 + 264 * i / 32)
        points.append((0.42 + math.cos(angle) * inner, math.sin(angle) * inner * 0.52))
    extruded_polygon("CRESCENT_MAIN_ARC", points, 2.65, mats["wall"], shell)
    cylinder("CRESCENT_NORTH_TOWER", (-2.22, 0.82, 1.90), 0.62, 3.80, mats["wall_dark"], landmark, 48)
    cylinder("CRESCENT_SOUTH_TOWER", (-2.22, -0.82, 1.58), 0.55, 3.15, mats["wall_dark"], landmark, 48)
    for index, angle in enumerate(range(-115, 116, 23)):
        rad = math.radians(angle)
        x = math.cos(rad) * 2.68
        y = math.sin(rad) * 2.68 * 0.58
        cylinder(f"CRESCENT_WINDOW_{index}", (x, y - 0.04, 1.40), 0.11, 0.05, mats["warm"] if index % 4 == 0 else mats["glass"], facade, 20)
    entrance("CRESCENT", -2.45, -1.00, 1.28, mats, landmark)


def build_admin_eye(shell, facade, landmark, mats):
    points = []
    for i in range(31):
        t = i / 30
        x = -3.1 + 6.2 * t
        y = math.sin(math.pi * t) * 1.18
        points.append((x, y))
    for i in range(30, -1, -1):
        t = i / 30
        x = -3.1 + 6.2 * t
        y = -math.sin(math.pi * t) * 1.18
        points.append((x, y))
    extruded_polygon("ADMIN_EYE_BODY", points, 2.15, mats["wall"], shell)
    cylinder("ADMIN_IRIS_TOWER", (0, 0, 2.15), 0.92, 4.30, mats["wall_dark"], landmark, 64)
    cylinder("ADMIN_PUPIL_GLASS", (0, -0.91, 2.25), 0.48, 0.08, mats["glass"], facade, 48).rotation_euler.x = math.radians(90)
    for side, y in (("N", 0.88), ("S", -0.88)):
        for index, x in enumerate((-2.35, -1.55, -0.78, 0.78, 1.55, 2.35)):
            box(f"ADMIN_{side}_LASH_{index}", (x, y, 2.28), (0.08, 0.55, 0.10), mats["roof"], facade, 0.006)
    entrance("ADMIN", 0, -1.20, 1.38, mats, landmark, red=True)


def add_camera_lights(scene, fx, spec):
    target_z = min(3.2, spec["footprint"][2] * 0.46)
    bpy.ops.object.light_add(type="AREA", location=(7.0, -8.0, 11.5))
    key = bpy.context.object
    key.name = "KEY_COOL_MOON"
    key.data.energy = 1050
    key.data.color = (0.58, 0.72, 0.84)
    key.data.shape = "DISK"
    key.data.size = 6.0
    look_at(key, (0, 0, target_z))
    link_to(key, fx)

    bpy.ops.object.light_add(type="AREA", location=(-5.5, -2.8, 5.5))
    fill = bpy.context.object
    fill.name = "FILL_TEAL"
    fill.data.energy = 520
    fill.data.color = (0.24, 0.46, 0.48)
    fill.data.size = 5.0
    look_at(fill, (0, 0, 1.4))
    link_to(fill, fx)

    bpy.ops.object.light_add(type="AREA", location=(0, -5.0, 2.6))
    warm = bpy.context.object
    warm.name = "ENTRY_WARM_GLOW"
    warm.data.energy = 240
    warm.data.color = (1.0, 0.30, 0.08)
    warm.data.size = 2.0
    look_at(warm, (0, -0.6, 1.0))
    link_to(warm, fx)

    bpy.ops.object.camera_add(location=(8.9, -11.2, 8.4))
    camera = bpy.context.object
    camera.name = "GAME_ISOMETRIC_ORTHO_CAMERA"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = spec["ortho"]
    look_at(camera, (0, 0, target_z))
    scene.camera = camera
    link_to(camera, fx)


def configure_scene(building_id, spec):
    scene = bpy.context.scene
    scene.name = f"{building_id.upper()}_EXTERIOR"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.use_file_extension = True
    scene.render.use_freestyle = True
    scene.render.line_thickness = 0.78
    scene.world.color = (0.008, 0.014, 0.020)
    out_dir = BUILDING_ROOT / building_id
    out_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_dir / f"{building_id}.png")
    scene["building_id"] = building_id
    scene["display_name"] = spec["name"]
    w, d, h = spec["footprint"]
    scene["game_footprint"] = f"w={w},d={d},h={h}"
    scene["asset_role"] = "transparent exterior 2.5D sprite source"
    scene["gameplay_contract"] = "visual only; Phaser mapData owns roads, collision, entrances and story"
    freestyle = scene.view_layers[0].freestyle_settings
    freestyle.linesets[0].linestyle.color = (0.004, 0.008, 0.012)
    freestyle.linesets[0].linestyle.thickness = 0.86
    return scene


def build_one(building_id):
    spec = SPECS[building_id]
    clean_scene()
    scene = configure_scene(building_id, spec)
    shell, facade, landmark, fx = collections(scene)
    form = spec["form"]
    style = "dorm" if form.startswith("dorm") else "brick" if form == "library" else "science" if form in {"marine-lab", "life-science", "environment"} else "public" if form in {"gate", "auditorium", "gym", "crescent", "admin-eye"} else "academic"
    mats = materials(style)

    if form == "gate":
        build_gate(shell, facade, landmark, mats)
    elif form.startswith("dorm"):
        build_dorm(form, shell, facade, landmark, mats)
    elif form == "auditorium":
        build_auditorium(shell, facade, landmark, mats)
    elif form == "library":
        build_library(shell, facade, landmark, mats)
    elif form == "gym":
        build_gym(shell, facade, landmark, mats)
    elif form == "crescent":
        build_crescent(shell, facade, landmark, mats)
    elif form == "admin-eye":
        build_admin_eye(shell, facade, landmark, mats)
    else:
        build_academic(building_id, form, shell, facade, landmark, mats)

    add_camera_lights(scene, fx, spec)
    out_dir = BUILDING_ROOT / building_id
    blend_path = out_dir / f"{building_id}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.render.render(write_still=True)
    return str(blend_path), scene.render.filepath


def main():
    requested = os.environ.get("ZJU_BUILDING_ID")
    ids = [requested] if requested else list(SPECS)
    for building_id in ids:
        if building_id not in SPECS:
            raise ValueError(f"Unknown building id: {building_id}")
        build_one(building_id)


if __name__ == "__main__":
    main()
