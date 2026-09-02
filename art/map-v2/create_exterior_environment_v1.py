"""Generate the exterior-only Zijingang east-campus environment layer.

The scene deliberately mirrors the gameplay coordinate system (x=0..42,
y=0..34). Roads are flat ribbon meshes, never beveled curves, so they read as
campus paving instead of pipes. Buildings remain separate runtime sprites.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
OUT_BLEND = ROOT / "exterior-environment-v1.blend"
OUT_PNG = ROOT / "exterior-environment-v1-preview.png"

MAP_W = 42.0
MAP_D = 34.0

COLORS = {
    "ground": (0.040, 0.078, 0.080, 1.0),
    "ground_edge": (0.085, 0.135, 0.128, 1.0),
    "grass_living": (0.055, 0.125, 0.105, 1.0),
    "grass_academic": (0.052, 0.108, 0.112, 1.0),
    "grass_medical": (0.060, 0.098, 0.102, 1.0),
    "road_edge": (0.145, 0.165, 0.152, 1.0),
    "road_main": (0.185, 0.135, 0.128, 1.0),
    "road_branch": (0.115, 0.145, 0.137, 1.0),
    "road_ring": (0.095, 0.155, 0.148, 1.0),
    "road_service": (0.095, 0.125, 0.118, 1.0),
    "plaza": (0.130, 0.158, 0.145, 1.0),
    "plaza_line": (0.205, 0.225, 0.202, 1.0),
    "water": (0.020, 0.190, 0.255, 1.0),
    "shore": (0.100, 0.195, 0.165, 1.0),
    "island": (0.090, 0.235, 0.135, 1.0),
    "building_pad": (0.055, 0.068, 0.068, 1.0),
    "tree_trunk": (0.125, 0.072, 0.038, 1.0),
    "tree_a": (0.045, 0.175, 0.092, 1.0),
    "tree_b": (0.060, 0.225, 0.110, 1.0),
    "lamp": (1.000, 0.460, 0.105, 1.0),
    "metal": (0.075, 0.090, 0.088, 1.0),
    "wet": (0.055, 0.180, 0.195, 1.0),
}

ROAD = {
    "ySouth": 30.5,
    "yNorth": 8.2,
    "yCanteen": 14.5,
    "yLakeSouth": 22.8,
    "yLibrary": 15.9,
    "yWestMid": 18.5,
    "yTheater": 11.6,
    "yAdmin": 18.2,
    "yBaishaDoor": 7.12,
    "yMedDoor": 30.32,
    "yLibDoor": 15.12,
    "xWest": 4.2,
    "xDorm": 10.2,
    "xBaishaDoor": 6.05,
    "xTheater": 12.1,
    "xMed": 12.6,
    "xMedLib": 19.4,
    "xLakeWest": 14.5,
    "xLakeSouth": 19.0,
    "xLakeEast": 26.5,
    "xEastTeach": 30.2,
    "xLibDoor": 33.7,
    "xEast": 36.5,
}

ROADS = [
    ("south-main-axis", "main", 1.18, [
        (ROAD["xDorm"], ROAD["ySouth"]), (ROAD["xMed"], ROAD["ySouth"]),
        (ROAD["xMedLib"], ROAD["ySouth"]), (ROAD["xEast"], ROAD["ySouth"]),
        (ROAD["xEast"], ROAD["yAdmin"]), (ROAD["xEast"], ROAD["yLibrary"]),
        (ROAD["xEast"], ROAD["yNorth"]), (ROAD["xLakeEast"], ROAD["yNorth"]),
        (ROAD["xLakeWest"], ROAD["yNorth"]), (ROAD["xDorm"], ROAD["yNorth"]),
    ]),
    ("west-inner-axis", "main", 0.86, [
        (ROAD["xDorm"], ROAD["yNorth"]), (ROAD["xDorm"], ROAD["yTheater"]),
        (ROAD["xDorm"], ROAD["yCanteen"]), (ROAD["xDorm"], ROAD["yWestMid"]),
        (ROAD["xDorm"], ROAD["ySouth"]),
    ]),
    ("lake-loop", "ring", 0.98, [
        (ROAD["xLakeWest"], ROAD["yCanteen"]), (ROAD["xLakeWest"], ROAD["yNorth"]),
        (ROAD["xLakeEast"], ROAD["yNorth"]), (ROAD["xLakeEast"], ROAD["yLibrary"]),
        (ROAD["xLakeEast"], ROAD["yAdmin"]), (ROAD["xLakeEast"], 20.8),
        (ROAD["xLakeEast"], ROAD["yLakeSouth"]), (ROAD["xLakeSouth"], ROAD["yLakeSouth"]),
        (ROAD["xLakeWest"], ROAD["yLakeSouth"]), (ROAD["xLakeWest"], ROAD["yCanteen"]),
    ]),
    ("dorm-branch", "branch", 0.78, [
        (ROAD["xDorm"], ROAD["yNorth"]), (ROAD["xBaishaDoor"], ROAD["yNorth"]),
        (ROAD["xWest"], ROAD["yNorth"]), (ROAD["xWest"], ROAD["yTheater"]),
    ]),
    ("baisha-ocean-link", "service", 0.62, [
        (ROAD["xWest"], ROAD["yTheater"]), (ROAD["xWest"], ROAD["yWestMid"]),
    ]),
    ("west-medical-road", "branch", 0.86, [
        (ROAD["xDorm"], ROAD["ySouth"]), (ROAD["xWest"], ROAD["ySouth"]),
        (ROAD["xWest"], ROAD["yWestMid"]), (ROAD["xDorm"], ROAD["yWestMid"]),
    ]),
    ("library-east-link", "branch", 0.84, [
        (ROAD["xLakeEast"], ROAD["yLibrary"]), (ROAD["xLibDoor"], ROAD["yLibrary"]),
        (ROAD["xEast"], ROAD["yLibrary"]),
    ]),
    ("lake-admin-bridge", "branch", 0.82, [
        (ROAD["xLakeEast"], ROAD["yAdmin"]), (ROAD["xEast"], ROAD["yAdmin"]),
    ]),
    ("east-teaching-spur", "service", 0.62, [
        (ROAD["xLakeEast"], 20.8), (ROAD["xEastTeach"], 20.8),
    ]),
    ("canteen-lake-link", "service", 0.62, [
        (ROAD["xDorm"], ROAD["yCanteen"]), (12.05, ROAD["yCanteen"]),
        (ROAD["xLakeWest"], ROAD["yCanteen"]),
    ]),
    ("theater-spur", "service", 0.62, [
        (ROAD["xDorm"], ROAD["yTheater"]), (ROAD["xTheater"], ROAD["yTheater"]),
    ]),
    ("baisha-door", "service", 0.55, [
        (ROAD["xBaishaDoor"], ROAD["yNorth"]), (ROAD["xBaishaDoor"], ROAD["yBaishaDoor"]),
    ]),
    ("medical-college-spur", "service", 0.55, [
        (ROAD["xMed"], ROAD["ySouth"]), (ROAD["xMed"], ROAD["yMedDoor"]),
    ]),
    ("medical-library-spur", "service", 0.55, [
        (ROAD["xMedLib"], ROAD["ySouth"]), (ROAD["xMedLib"], ROAD["yMedDoor"]),
    ]),
    ("library-door", "service", 0.55, [
        (ROAD["xLibDoor"], ROAD["yLibrary"]), (ROAD["xLibDoor"], ROAD["yLibDoor"]),
    ]),
]

PLAZAS = [
    ("gate-plaza", 5.6, 30.0, 3.8, 1.5),
    ("canteen-plaza", 10.4, 14.5, 4.0, 1.8),
    ("lake-west-plaza", 14.0, 20.8, 3.7, 2.3),
    ("library-plaza", 31.6, 15.0, 4.0, 1.8),
    ("east-teaching-yard", 25.0, 9.8, 6.6, 5.0),
    ("dorm-plaza", 6.0, 7.5, 2.9, 1.6),
    ("theater-plaza", 10.5, 11.5, 3.2, 1.6),
    ("medical-plaza", 10.4, 30.0, 4.8, 1.5),
]

LAKE = [
    (19.8, 5.8), (22.2, 4.6), (24.8, 7.0), (23.6, 11.2),
    (24.2, 14.2), (24.8, 18.6), (23.9, 22.4), (23.8, 26.6),
    (20.8, 28.0), (18.4, 26.4), (17.0, 23.2), (15.8, 20.0),
    (16.2, 16.4), (15.8, 12.0), (17.0, 8.4),
]

ISLAND = [
    (18.0, 16.5), (19.1, 15.8), (21.2, 16.2), (22.0, 17.5),
    (21.3, 18.8), (19.2, 19.2), (18.0, 18.3),
]

BUILDING_PADS = [
    (5.0, 31.2, 4.2, 0.7), (2.4, 3.1, 5.8, 3.0), (10.9, 3.6, 4.3, 2.6),
    (15.6, 2.6, 4.0, 2.3), (4.6, 5.5, 2.9, 1.5), (10.8, 12.2, 2.5, 2.2),
    (11.1, 9.4, 2.0, 1.8), (27.6, 24.2, 2.3, 1.5), (27.4, 16.9, 2.2, 1.2),
    (1.9, 20.1, 1.8, 1.4), (4.9, 21.5, 2.5, 1.5), (1.9, 25.6, 1.7, 2.7),
    (31.4, 27.6, 3.8, 2.0), (11.0, 28.6, 3.5, 1.7), (32.1, 12.0, 3.2, 3.0),
    (30.0, 16.2, 2.2, 1.7), (30.0, 18.6, 2.2, 1.7), (30.0, 21.0, 2.2, 1.7),
    (30.0, 23.4, 2.2, 1.7), (33.0, 17.0, 2.5, 1.6), (33.0, 20.3, 2.4, 1.5),
    (33.1, 23.7, 2.6, 1.6), (33.2, 9.6, 3.5, 1.9), (17.4, 28.5, 3.9, 1.8),
    (24.2, 28.2, 4.0, 2.0), (37.3, 24.3, 2.4, 3.4),
]

TREE_POINTS = [
    (2.0, 5.0), (3.0, 7.8), (8.4, 3.0), (9.0, 6.2), (14.8, 6.4),
    (20.0, 3.0), (22.6, 3.2), (27.0, 4.5), (29.0, 6.0), (38.8, 7.0),
    (38.8, 11.2), (39.2, 15.4), (39.0, 19.0), (40.0, 22.0), (40.0, 29.0),
    (36.8, 32.0), (31.0, 32.0), (28.5, 31.8), (22.6, 31.8), (16.0, 32.0),
    (8.0, 32.0), (3.0, 30.0), (2.2, 23.0), (7.8, 20.0), (12.2, 20.5),
    (13.0, 24.6), (27.6, 27.5), (28.0, 14.2), (29.0, 11.0), (12.8, 7.0),
]

LAMP_POINTS = [
    (10.2, 9.5), (10.2, 13.0), (10.2, 17.0), (10.2, 21.0), (10.2, 25.5),
    (10.2, 29.5), (15.0, 30.5), (20.5, 30.5), (26.0, 30.5), (32.0, 30.5),
    (36.5, 27.5), (36.5, 23.0), (36.5, 18.2), (36.5, 13.0), (33.0, 8.2),
    (27.0, 8.2), (23.8, 11.0), (24.4, 16.0), (24.0, 21.0), (20.0, 22.8),
    (15.0, 22.8), (14.5, 18.0), (14.5, 14.5),
]


def collection(name: str):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


def material(name: str, color, roughness=0.9, metallic=0.0, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def mesh_object(name: str, verts, faces, mat, col):
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def rectangle(name: str, x: float, y: float, w: float, d: float, z: float, mat, col):
    return mesh_object(
        name,
        [(x, y, z), (x + w, y, z), (x + w, y + d, z), (x, y + d, z)],
        [(0, 1, 2, 3)],
        mat,
        col,
    )


def polygon(name: str, points, z: float, mat, col):
    return mesh_object(name, [(x, y, z) for x, y in points], [tuple(range(len(points)))], mat, col)


def normalize(v):
    length = math.hypot(v[0], v[1])
    return (v[0] / length, v[1] / length) if length > 1e-7 else (0.0, 0.0)


def rounded_polyline(points, radius=0.32, steps=5):
    if len(points) < 3:
        return list(points)
    result = [points[0]]
    for index in range(1, len(points) - 1):
        previous, corner, following = points[index - 1], points[index], points[index + 1]
        toward_previous = normalize((previous[0] - corner[0], previous[1] - corner[1]))
        toward_following = normalize((following[0] - corner[0], following[1] - corner[1]))
        previous_length = math.dist(previous, corner)
        following_length = math.dist(corner, following)
        distance = min(radius, previous_length * 0.28, following_length * 0.28)
        entry = (corner[0] + toward_previous[0] * distance, corner[1] + toward_previous[1] * distance)
        exit_point = (corner[0] + toward_following[0] * distance, corner[1] + toward_following[1] * distance)
        result.append(entry)
        for step in range(1, steps):
            t = step / steps
            u = 1.0 - t
            result.append((
                u * u * entry[0] + 2 * u * t * corner[0] + t * t * exit_point[0],
                u * u * entry[1] + 2 * u * t * corner[1] + t * t * exit_point[1],
            ))
        result.append(exit_point)
    result.append(points[-1])
    return result


def ribbon(name: str, points, width: float, z: float, mat, col, closed=False):
    count = len(points)
    verts = []
    for index, point in enumerate(points):
        previous = points[index - 1] if index > 0 else (points[-1] if closed else points[index])
        following = points[(index + 1) % count] if index < count - 1 or closed else points[index]
        tangent = normalize((following[0] - previous[0], following[1] - previous[1]))
        normal = (-tangent[1], tangent[0])
        verts.append((point[0] + normal[0] * width * 0.5, point[1] + normal[1] * width * 0.5, z))
        verts.append((point[0] - normal[0] * width * 0.5, point[1] - normal[1] * width * 0.5, z))
    segment_count = count if closed else count - 1
    faces = []
    for index in range(segment_count):
        nxt = (index + 1) % count
        faces.append((index * 2, nxt * 2, nxt * 2 + 1, index * 2 + 1))
    return mesh_object(name, verts, faces, mat, col)


def move_to(obj, col):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)


def add_tree(name: str, x: float, y: float, scale: float, trunk_mat, crown_mat, col):
    bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.09 * scale, depth=0.72 * scale, location=(x, y, 0.52 * scale))
    trunk = bpy.context.object
    trunk.name = f"{name}_trunk"
    trunk.data.materials.append(trunk_mat)
    move_to(trunk, col)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.48 * scale, location=(x, y, 1.12 * scale))
    crown = bpy.context.object
    crown.name = f"{name}_crown"
    crown.scale = (1.0, 0.88, 1.12)
    crown.data.materials.append(crown_mat)
    move_to(crown, col)


def add_lamp(name: str, x: float, y: float, metal_mat, lamp_mat, col, with_light=False):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.035, depth=1.15, location=(x, y, 0.72))
    pole = bpy.context.object
    pole.name = f"{name}_pole"
    pole.data.materials.append(metal_mat)
    move_to(pole, col)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.105, location=(x, y, 1.32))
    bulb = bpy.context.object
    bulb.name = f"{name}_bulb"
    bulb.scale.z = 0.72
    bulb.data.materials.append(lamp_mat)
    move_to(bulb, col)
    if with_light:
        light_data = bpy.data.lights.new(f"{name}_light", "POINT")
        light_data.energy = 38
        light_data.color = (1.0, 0.33, 0.08)
        light_data.shadow_soft_size = 1.0
        light = bpy.data.objects.new(f"{name}_light", light_data)
        light.location = (x, y, 1.25)
        col.objects.link(light)


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        if col.name != "Collection":
            bpy.data.collections.remove(col)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUT_PNG)
    scene.render.film_transparent = False
    scene.render.use_freestyle = True
    scene.render.line_thickness = 0.7
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.018, 0.034, 0.040, 1.0)
    background.inputs["Strength"].default_value = 0.42
    scene.view_settings.look = "AgX - Medium Low Contrast"
    scene.view_settings.exposure = 1.35

    ground_col = collection("01_GROUND")
    district_col = collection("02_DISTRICTS")
    water_col = collection("03_WATER")
    plaza_col = collection("04_PLAZAS")
    road_col = collection("05_ROADS")
    pad_col = collection("06_BUILDING_PADS")
    prop_col = collection("07_TREES_AND_LIGHTS")

    mats = {name: material(name, color) for name, color in COLORS.items()}
    mats["water"] = material("water", COLORS["water"], roughness=0.25, metallic=0.12)
    mats["wet"] = material("wet", COLORS["wet"], roughness=0.18, metallic=0.08)
    mats["lamp"] = material("lamp", COLORS["lamp"], roughness=0.36, emission=COLORS["lamp"], strength=5.0)

    # Slightly extruded campus slab with a readable rim.
    bpy.ops.mesh.primitive_cube_add(location=(MAP_W * 0.5, MAP_D * 0.5, -0.16), scale=(MAP_W * 0.5, MAP_D * 0.5, 0.16))
    slab = bpy.context.object
    slab.name = "campus_ground_slab"
    slab.data.materials.append(mats["ground"])
    move_to(slab, ground_col)
    bevel = slab.modifiers.new("ground_soft_edge", "BEVEL")
    bevel.width = 0.14
    bevel.segments = 2

    districts = [
        ("living_district", 1.2, 1.4, 19.2, 7.0, "grass_living"),
        ("lake_district", 12.8, 5.2, 15.2, 23.4, "grass_academic"),
        ("east_academic", 27.0, 7.0, 12.0, 20.8, "grass_academic"),
        ("medical_district", 8.8, 27.2, 30.0, 5.0, "grass_medical"),
    ]
    for name, x, y, w, d, mat_name in districts:
        rectangle(name, x, y, w, d, 0.025, mats[mat_name], district_col)

    # Lake and a flat shoreline band; the island is intentionally raised.
    ribbon("qizhen_shore", LAKE, 0.54, 0.070, mats["shore"], water_col, closed=True)
    polygon("qizhen_lake", LAKE, 0.082, mats["water"], water_col)
    polygon("qizhen_island", ISLAND, 0.145, mats["island"], water_col)

    for name, x, y, w, d in PLAZAS:
        rectangle(name, x, y, w, d, 0.105, mats["plaza"], plaza_col)
        # Sparse paving seams, kept below the roads.
        seam_count = max(2, int(w / 0.8))
        for index in range(1, seam_count):
            seam_x = x + w * index / seam_count
            ribbon(f"{name}_seam_{index}", [(seam_x, y + 0.08), (seam_x, y + d - 0.08)], 0.025, 0.112, mats["plaza_line"], plaza_col)

    road_mats = {
        "main": mats["road_main"],
        "branch": mats["road_branch"],
        "ring": mats["road_ring"],
        "service": mats["road_service"],
    }
    for name, kind, width_scale, points in ROADS:
        rounded = rounded_polyline(points, radius=0.42 if kind == "main" else 0.30, steps=6)
        width = 0.90 * width_scale
        ribbon(f"{name}_curb", rounded, width + 0.42, 0.128, mats["road_edge"], road_col)
        ribbon(name, rounded, width, 0.145, road_mats[kind], road_col)
        if kind in {"main", "ring"}:
            ribbon(f"{name}_wet_strip", rounded, width * 0.26, 0.151, mats["wet"], road_col)

    # The east lake link is a bridge, so add rails without changing its path.
    bridge_points = rounded_polyline([(ROAD["xLakeEast"], ROAD["yAdmin"]), (ROAD["xEast"], ROAD["yAdmin"])], radius=0.2)
    ribbon("lake_admin_bridge_deck", bridge_points, 0.95, 0.205, mats["road_branch"], road_col)
    ribbon("lake_admin_bridge_north_rail", [(x, y - 0.54) for x, y in bridge_points], 0.075, 0.235, mats["metal"], road_col)
    ribbon("lake_admin_bridge_south_rail", [(x, y + 0.54) for x, y in bridge_points], 0.075, 0.235, mats["metal"], road_col)

    for index, (x, y, w, d) in enumerate(BUILDING_PADS):
        rectangle(f"building_pad_{index:02d}", x - 0.12, y - 0.12, w + 0.24, d + 0.24, 0.122, mats["building_pad"], pad_col)

    for index, (x, y) in enumerate(TREE_POINTS):
        add_tree(
            f"tree_{index:02d}", x, y, 0.78 + (index % 4) * 0.08,
            mats["tree_trunk"], mats["tree_a" if index % 3 else "tree_b"], prop_col,
        )
    for index, (x, y) in enumerate(LAMP_POINTS):
        add_lamp(f"lamp_{index:02d}", x, y, mats["metal"], mats["lamp"], prop_col, with_light=index % 3 == 0)

    # Island trees use a smaller scale to preserve the island silhouette.
    for index, (x, y) in enumerate([(18.7, 17.0), (19.6, 16.7), (20.6, 17.2), (19.0, 18.0), (20.2, 18.2)]):
        add_tree(f"island_tree_{index}", x, y, 0.62, mats["tree_trunk"], mats["tree_b"], prop_col)

    # Dimetric camera matches Phaser's x-y / x+y projection closely.
    target = (MAP_W * 0.5, MAP_D * 0.5, 0.0)
    camera_data = bpy.data.cameras.new("EnvironmentCamera")
    camera = bpy.data.objects.new("EnvironmentCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (target[0] + 42.0, target[1] + 42.0, 29.7)
    look_at(camera, target)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 37.0
    scene.camera = camera

    key_data = bpy.data.lights.new("moon_key", "AREA")
    key_data.energy = 2600
    key_data.shape = "DISK"
    key_data.size = 22
    key_data.color = (0.25, 0.44, 0.50)
    key = bpy.data.objects.new("moon_key", key_data)
    key.location = (3.0, 5.0, 32.0)
    scene.collection.objects.link(key)

    rim_data = bpy.data.lights.new("warm_rim", "AREA")
    rim_data.energy = 1100
    rim_data.size = 18
    rim_data.color = (0.82, 0.24, 0.10)
    rim = bpy.data.objects.new("warm_rim", rim_data)
    rim.location = (43.0, 31.0, 18.0)
    scene.collection.objects.link(rim)

    fill_data = bpy.data.lights.new("sky_fill", "AREA")
    fill_data.energy = 1500
    fill_data.shape = "DISK"
    fill_data.size = 38
    fill_data.color = (0.16, 0.31, 0.36)
    fill = bpy.data.objects.new("sky_fill", fill_data)
    fill.location = (21.0, 17.0, 42.0)
    scene.collection.objects.link(fill)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.render.render(write_still=True)
    print(f"Saved environment scene: {OUT_BLEND}")
    print(f"Rendered preview: {OUT_PNG}")


main()
