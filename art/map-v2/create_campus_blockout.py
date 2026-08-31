"""Build a controllable 2.5D cartoon blockout from OSM key-building geometry.

This is intentionally a source-scene generator, not a game runtime importer.
Run with Blender's bundled Python in background mode.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source" / "zijingang-key-geom.json"
OUT_BLEND = ROOT / "zijingang-east-blockout.blend"
OUT_PNG = ROOT / "zijingang-east-blockout.png"

ORIGIN_LAT = 30.3037120  # Qizhen Lake center from OSM
ORIGIN_LON = 120.0824442
METERS_PER_DEG_LAT = 110540.0
METERS_PER_DEG_LON = 110540.0 * math.cos(math.radians(ORIGIN_LAT))
SCALE = 0.075  # 1 real-world metre -> Blender units


COLORS = {
    "ground": (0.035, 0.055, 0.065, 1),
    "ground_edge": (0.075, 0.095, 0.095, 1),
    "water": (0.025, 0.105, 0.145, 1),
    "island": (0.10, 0.17, 0.12, 1),
    "dorm": (0.28, 0.31, 0.28, 1),
    "academic": (0.26, 0.34, 0.35, 1),
    "library": (0.37, 0.22, 0.19, 1),
    "theater": (0.30, 0.18, 0.30, 1),
    "moon": (0.38, 0.30, 0.23, 1),
    "medical": (0.22, 0.33, 0.35, 1),
    "road": (0.065, 0.075, 0.075, 1),
    "road_edge": (0.20, 0.17, 0.13, 1),
    "window": (0.82, 0.56, 0.25, 1),
    "cold_window": (0.25, 0.58, 0.60, 1),
    "red": (0.62, 0.06, 0.07, 1),
}


def mat(name: str, color, roughness: float = 0.9, emission=None, emission_strength=0.0):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        if emission:
            bsdf.inputs["Emission Color"].default_value = emission
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return material


def collection(name: str):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        try:
            bpy.context.scene.collection.children.link(col)
        except RuntimeError:
            pass
    return col


def move_to(obj, col):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)


def local(lon: float, lat: float):
    x = (lon - ORIGIN_LON) * METERS_PER_DEG_LON * SCALE
    y = (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT * SCALE
    return x, y


def polygon_xy(points):
    return [local(point["lon"], point["lat"]) for point in points]


def make_prism(name, xy, height, material, col, bevel=0.06):
    if len(xy) < 3:
        return None
    # OSM rings are closed; Blender's face indices should not repeat the first vertex.
    if xy[0] == xy[-1]:
        xy = xy[:-1]
    n = len(xy)
    verts = [(x, y, 0.10) for x, y in xy] + [(x, y, 0.10 + height) for x, y in xy]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new("soft_cartoon_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def make_flat_polygon(name, xy, z, material, col):
    if len(xy) < 3:
        return None
    if xy[0] == xy[-1]:
        xy = xy[:-1]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata([(x, y, z) for x, y in xy], [], [tuple(range(len(xy)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def make_road(name, points, width, col, material):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = width / 2
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for item, (x, y) in zip(spline.points, points):
        item.co = (x, y, 0.15, 1)
    obj = bpy.data.objects.new(name, curve)
    col.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_window_light(x, y, z, material, col, size=0.18):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z), scale=(size, 0.025, size * 0.7))
    obj = bpy.context.object
    obj.name = "window_light"
    obj.data.materials.append(material)
    move_to(obj, col)
    return obj


def load_elements():
    data = json.loads(SOURCE.read_text())
    return data["elements"]


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        if col.name != "Collection":
            bpy.data.collections.remove(col)

    scene = bpy.context.scene
    # Blender 5.2 exposes the Eevee engine as BLENDER_EEVEE (older builds
    # called the same renderer BLENDER_EEVEE_NEXT).
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUT_PNG)
    scene.render.film_transparent = False
    scene.render.use_freestyle = True
    scene.render.line_thickness = 0.9
    scene.world.color = (0.008, 0.012, 0.018)

    ground = collection("GROUND")
    roads = collection("ROADS")
    landmarks = collection("LANDMARKS")
    props = collection("PROPS")
    fx = collection("LIGHTS_AND_FX")

    ground_mat = mat("ground", COLORS["ground"])
    water_mat = mat("water", COLORS["water"])
    island_mat = mat("island", COLORS["island"])
    road_mat = mat("road", COLORS["road"])
    road_edge_mat = mat("road_edge", COLORS["road_edge"])
    window_mat = mat("warm_window", COLORS["window"], emission=COLORS["window"], emission_strength=2.8)
    cold_mat = mat("cold_window", COLORS["cold_window"], emission=COLORS["cold_window"], emission_strength=2.2)
    red_mat = mat("red_story_light", COLORS["red"], emission=COLORS["red"], emission_strength=3.6)

    # A compact ground plane, intentionally larger than the sample camera.
    bpy.ops.mesh.primitive_plane_add(size=48, location=(0, 0, 0))
    move_to(bpy.context.object, ground)
    bpy.context.object.name = "east_ground"
    bpy.context.object.data.materials.append(ground_mat)

    elements = load_elements()
    by_name = {}
    for item in elements:
        name = (item.get("tags") or {}).get("name")
        if name:
            by_name.setdefault(name, []).append(item)

    # Lake relation with outer and island inner rings.
    for item in elements:
        if item.get("type") != "relation" or item.get("id") != 7927357:
            continue
        for member in item.get("members", []):
            geom = member.get("geometry") or []
            xy = polygon_xy(geom)
            target = island_mat if member.get("role") == "inner" else water_mat
            make_flat_polygon("qizhen_island" if member.get("role") == "inner" else "qizhen_lake", xy, 0.06, target, ground)

    key_names = {
        "浙江大学紫金港校区农医图书馆": ("medical-library", "medical", 1.2),
        "浙江大学医学院": ("medical-college", "medical", 2.1),
        "浙江大学基础图书馆": ("library", "library", 1.8),
        "月牙楼": ("crescent-building", "moon", 1.5),
        "小剧场A座": ("little-theater-a", "theater", 1.7),
        "小剧场B座": ("little-theater-b", "theater", 1.9),
        "白沙1舍": ("dorm-baisha-1", "dorm", 1.4),
        "白沙2舍": ("dorm-baisha-2", "dorm", 1.4),
        "白沙3舍": ("dorm-baisha-3", "dorm", 1.4),
        "白沙4舍": ("dorm-baisha-4", "dorm", 1.4),
        "白沙3-4舍大厅": ("dorm-baisha-hall-34", "dorm", 0.7),
        "白沙1-2舍大厅": ("dorm-baisha-hall-12", "dorm", 0.7),
        "东1教学楼": ("east-teaching-1", "academic", 1.6),
        "东2教学楼": ("east-teaching-2", "academic", 1.1),
        "东3教学楼": ("east-teaching-3", "academic", 1.1),
        "东4教学楼": ("east-teaching-4", "academic", 1.1),
        "东5教学楼": ("east-teaching-5", "academic", 1.4),
        "东6东7教学楼": ("east-teaching-6-7", "academic", 1.3),
        "湖心岛": ("qizhen-island", "island", 0.18),
    }
    materials = {key: mat(key, COLORS[key]) for key in ("dorm", "academic", "library", "theater", "moon", "medical", "island")}

    for osm_name, records in by_name.items():
        if osm_name not in key_names:
            continue
        game_id, style, default_height = key_names[osm_name]
        for index, item in enumerate(records):
            xy = polygon_xy(item.get("geometry") or [])
            tags = item.get("tags") or {}
            levels = float(tags.get("building:levels", default_height / 0.32))
            height = max(default_height, min(3.2, levels * 0.32))
            obj = make_prism(f"{game_id}_{index}", xy, height, materials.get(style, materials["academic"]), landmarks)
            if not obj:
                continue
            obj["game_id"] = game_id
            obj["osm_name"] = osm_name
            obj["source"] = "OpenStreetMap"
            obj["enterable"] = game_id in {"medical-library", "medical-college", "little-theater-a"}
            # A small roof cap makes landmarks readable without adding interior geometry.
            if style in {"moon", "theater", "library"}:
                top = make_prism(f"{game_id}_{index}_roof_cap", xy, height + 0.10, materials[style], landmarks, bevel=0.035)
                if top:
                    top.scale.z = 0.055

            # Two or three emissive windows facing the camera give the night read.
            if style in {"moon", "theater", "medical", "library"} and xy:
                cx = sum(point[0] for point in xy) / len(xy)
                cy = sum(point[1] for point in xy) / len(xy)
                add_window_light(cx, cy - 0.12, min(height * 0.65, height - 0.15), cold_mat if style == "medical" else window_mat, props, size=0.12)

    # Road skeleton for the playable sample. These are deliberately broad and legible.
    road_specs = [
        ("north_lake_walk", [(-13, 0), (-8, 2), (-2, 2), (7, 1), (14, 4)], 0.32),
        ("baisha_to_theater", [(-6.4, 0.55), (-4.2, 1.3), (-1.6, 2.6), (1.5, 2.6), (4.2, 3.1)], 0.25),
        ("lake_south_link", [(-7, -8.0), (-4, -5), (-1, -2), (3, 0), (8, 4)], 0.28),
        ("medical_axis", [(-8, -15), (-6, -11), (-4, -8), (-1, -6)], 0.30),
    ]
    for name, points, width in road_specs:
        make_road(name + "_edge", points, width + 0.12, roads, road_edge_mat)
        make_road(name, points, width, roads, road_mat)

    # Curated lanterns: procedural atmosphere, not baked horror decoration.
    for point in [(-2.2, 2.5, 1.3), (4.1, 3.0, 1.4), (-7.0, -8.0, 1.2)]:
        bpy.ops.object.light_add(type="POINT", location=point)
        light = bpy.context.object
        light.name = "warm_lantern"
        light.data.energy = 75
        light.data.color = (1.0, 0.35, 0.12)
        light.data.shadow_soft_size = 1.4
        move_to(light, fx)
    bpy.ops.object.light_add(type="AREA", location=(0, -5, 22))
    moon = bpy.context.object
    moon.name = "soft_moon_fill"
    moon.data.energy = 450
    moon.data.shape = "DISK"
    moon.data.size = 18
    moon.data.color = (0.25, 0.38, 0.55)
    look_at(moon, (0, 0, 0))
    move_to(moon, fx)

    bpy.ops.object.camera_add(location=(24, -28, 27))
    camera = bpy.context.object
    camera.name = "CAMPUS_ORTHO_CAMERA"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 35
    look_at(camera, (0, 0, 1.2))
    scene.camera = camera
    move_to(camera, fx)

    # Freestyle is used only for the ink edge; materials carry the palette.
    view_layer = scene.view_layers[0]
    freestyle = view_layer.freestyle_settings
    freestyle.linesets[0].linestyle.color = (0.005, 0.008, 0.012)
    freestyle.linesets[0].linestyle.thickness = 0.85

    scene["map_version"] = "east-v2-blockout-01"
    scene["coordinate_origin"] = "Qizhen Lake center 30.303712, 120.0824442"
    scene["source_license"] = "OpenStreetMap ODbL; attribution required"
    scene["merge_contract"] = "Keep game IDs and export layers; do not import interiors"

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
