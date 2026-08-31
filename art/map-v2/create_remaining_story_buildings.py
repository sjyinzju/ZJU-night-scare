"""Build the remaining exterior landmarks used by the authored story route.

The Phaser map remains authoritative for placement, roads, collision, story
hotspots and interior transitions.  This script creates editable Blender source
files plus transparent orthographic renders for the five missing sprite ids:

* linhu-canteen
* east-teaching-1 .. east-teaching-4

Set ``ZJU_BUILDING_ID`` to build one asset, or leave it unset to build all.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
BUILDING_ROOT = ROOT / "buildings"


SPECS = {
    "linhu-canteen": {
        "name": "临湖餐厅",
        "footprint": (2.5, 2.2, 2.5),
        "ortho": 9.25,
        "target_z": 2.10,
    },
    "east-teaching-1": {
        "name": "东1教学楼",
        "footprint": (2.2, 1.7, 2.9),
        "ortho": 7.85,
        "target_z": 1.82,
        "variant": 1,
    },
    "east-teaching-2": {
        "name": "东2教学楼",
        "footprint": (2.2, 1.7, 3.8),
        "ortho": 8.45,
        "target_z": 2.10,
        "variant": 2,
    },
    "east-teaching-3": {
        "name": "东3教学楼",
        "footprint": (2.2, 1.7, 2.6),
        "ortho": 7.85,
        "target_z": 1.80,
        "variant": 3,
    },
    "east-teaching-4": {
        "name": "东4教学楼",
        "footprint": (2.2, 1.7, 4.2),
        "ortho": 8.85,
        "target_z": 2.22,
        "variant": 4,
    },
}


def clean_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


def material(
    name: str,
    color: tuple[float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.72,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission is not None:
            emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
            if emission_input:
                emission_input.default_value = (*emission, 1.0)
            strength_input = bsdf.inputs.get("Emission Strength")
            if strength_input:
                strength_input.default_value = emission_strength
    return mat


def link_to(obj, collection) -> None:
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)


def box(name, location, dimensions, mat, collection, bevel=0.05):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    link_to(obj, collection)
    if bevel:
        mod = obj.modifiers.new("ink_soft_bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def cylinder(name, location, radius, depth, mat, collection, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    link_to(obj, collection)
    bevel = obj.modifiers.new("ink_soft_bevel", "BEVEL")
    bevel.width = 0.035
    bevel.segments = 2
    return obj


def make_slope_panel(name, center, width, height, depth, angle, mat, collection):
    panel = box(name, center, (width, depth, height), mat, collection, bevel=0.025)
    panel.rotation_euler.x = math.radians(angle)
    return panel


def wave_canopy(name, width, y, z, mat, collection, phase=0.0):
    """Create one readable segment of the east teaching area's wavy arcade."""
    segments = 28
    depth = 0.42
    verts = []
    faces = []
    for i in range(segments + 1):
        t = i / segments
        x = -width / 2 + width * t
        wave_z = z + math.sin(t * math.pi * 2.0 + phase) * 0.16
        verts.extend(((x, y - depth / 2, wave_z), (x, y + depth / 2, wave_z)))
    for i in range(segments):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    solidify = obj.modifiers.new("canopy_thickness", "SOLIDIFY")
    solidify.thickness = 0.09
    bevel = obj.modifiers.new("canopy_soft_edge", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    return obj


def add_window_grid(
    prefix,
    *,
    width,
    front_y,
    floors,
    columns,
    z0,
    floor_gap,
    window_w,
    window_h,
    window_mat,
    frame_mat,
    collection,
    warm_every=0,
    warm_mat=None,
):
    usable = width - 0.55
    for floor in range(floors):
        z = z0 + floor * floor_gap
        for col in range(columns):
            x = -usable / 2 + usable * (col + 0.5) / columns
            mat = window_mat
            if warm_every and warm_mat and (floor * columns + col) % warm_every == 0:
                mat = warm_mat
            box(
                f"{prefix}_WINDOW_{floor+1}_{col+1}",
                (x, front_y, z),
                (window_w, 0.055, window_h),
                mat,
                collection,
                bevel=0.008,
            )
        box(
            f"{prefix}_FLOOR_BAND_{floor+1}",
            (0, front_y + 0.004, z - window_h * 0.60),
            (width - 0.18, 0.035, 0.07),
            frame_mat,
            collection,
            bevel=0.006,
        )


def make_collections(scene):
    shell = bpy.data.collections.new("BUILDING_SHELL")
    facade = bpy.data.collections.new("FACADE_DETAILS")
    landmarks = bpy.data.collections.new("LANDMARK_FEATURES")
    fx = bpy.data.collections.new("CAMERA_AND_LIGHTS")
    for collection in (shell, facade, landmarks, fx):
        scene.collection.children.link(collection)
    return shell, facade, landmarks, fx


def build_linhu(shell, facade, landmarks, mats):
    wall, wall_dark, roof, glass, green, warm, orange = mats

    # Long, low lakeside body with two glazed stair towers.  The stepped white
    # wings and amber central bay are the cues visible in the official photo.
    box("LINHU_LOWER_PODIUM", (0, 0.18, 0.72), (5.9, 3.25, 1.45), wall_dark, shell, 0.10)
    box("LINHU_UPPER_BAR", (0, 0.28, 2.08), (5.2, 2.72, 1.55), wall, shell, 0.09)
    box("LINHU_WEST_WING", (-2.48, 0.36, 1.78), (1.12, 2.55, 2.52), wall, shell, 0.08)
    box("LINHU_EAST_WING", (2.48, 0.36, 1.78), (1.12, 2.55, 2.52), wall, shell, 0.08)
    box("LINHU_ROOF_SLAB", (0, 0.28, 2.92), (5.55, 2.92, 0.15), roof, shell, 0.035)

    # Two dark green glass towers give the silhouette its campus identity.
    for side, x in (("WEST", -2.36), ("EAST", 2.36)):
        box(f"LINHU_{side}_GLASS_TOWER", (x, -0.02, 2.64), (0.74, 1.34, 3.72), glass, landmarks, 0.045)
        box(f"LINHU_{side}_TOWER_CAP", (x, -0.02, 4.56), (0.88, 1.48, 0.18), green, landmarks, 0.025)
        for z in (1.35, 2.15, 2.95, 3.75):
            box(f"LINHU_{side}_TOWER_BAND_{z}", (x, -0.71, z), (0.80, 0.045, 0.075), green, facade, 0.006)
        for dx in (-0.27, 0.27):
            box(f"LINHU_{side}_TOWER_MULLION_{dx}", (x + dx, -0.72, 2.65), (0.055, 0.045, 3.55), green, facade, 0.006)

    # The lake-facing orange bay reads as a warm, occupied restaurant at night.
    box("LINHU_AMBER_CURTAIN_WALL", (0, -1.48, 1.42), (2.72, 0.07, 1.55), warm, facade, 0.015)
    for x in (-1.08, -0.54, 0, 0.54, 1.08):
        box("LINHU_AMBER_MULLION", (x, -1.53, 1.42), (0.07, 0.055, 1.62), orange, facade, 0.007)
    for x in (-1.72, -1.48, 1.48, 1.72):
        post = box("LINHU_SLOPED_PORTICO", (x, -1.63, 1.48), (0.13, 0.13, 2.18), wall, landmarks, 0.018)
        post.rotation_euler.y = math.radians(-13 if x < 0 else 13)
    make_slope_panel("LINHU_LAKE_CANOPY", (0, -1.67, 2.52), 4.2, 0.16, 0.70, -8, roof, landmarks)

    # Repeated balcony bands and railings sell the two-storey facade at sprite scale.
    for z in (1.04, 2.08):
        box(f"LINHU_BALCONY_{z}", (0, -1.22, z), (5.15, 0.42, 0.11), wall, facade, 0.018)
        box(f"LINHU_RAIL_{z}", (0, -1.43, z + 0.30), (5.0, 0.045, 0.07), green, facade, 0.006)
        for x in (-2.25, -1.75, -1.25, 1.25, 1.75, 2.25):
            box(f"LINHU_RAIL_POST_{z}_{x}", (x, -1.43, z + 0.18), (0.035, 0.04, 0.40), green, facade, 0.005)

    box("LINHU_ENTRY_STEP", (0, -1.80, 0.12), (2.15, 0.56, 0.20), wall_dark, landmarks, 0.035)
    box("LINHU_ENTRY_SIGN_BAND", (0, -1.58, 2.20), (2.20, 0.06, 0.16), orange, landmarks, 0.015)


def build_east_teaching(shell, facade, landmarks, mats, variant):
    wall, wall_shadow, roof, glass, green, warm = mats
    width = 4.65
    depth = 2.85
    floor_gap = 0.67
    floors = {1: 3, 2: 4, 3: 3, 4: 4}[variant]
    body_height = floors * floor_gap + 0.42

    # Each block is recognisably part of the same five-zone teaching complex,
    # but its massing follows the height differences already present in mapData.
    if variant == 1:
        box("EAST1_MAIN_SLAB", (0, 0.18, body_height / 2), (width, depth, body_height), wall, shell, 0.075)
        box("EAST1_RECESSED_ENTRY", (0, -1.48, 0.92), (1.25, 0.16, 1.65), glass, landmarks, 0.02)
        box("EAST1_ENTRY_FRAME", (0, -1.60, 1.00), (1.62, 0.16, 1.92), green, landmarks, 0.025)
        box("EAST1_ENTRY_VOID", (0, -1.70, 0.94), (1.30, 0.08, 1.60), glass, landmarks, 0.012)
    elif variant == 2:
        box("EAST2_LONG_SLAB", (-0.45, 0.18, body_height / 2), (3.75, depth, body_height), wall, shell, 0.075)
        box("EAST2_TOWER", (1.65, 0.22, 2.05), (1.05, 2.60, 4.10), wall_shadow, shell, 0.07)
        box("EAST2_TOWER_GLASS", (1.65, -1.12, 2.02), (0.62, 0.07, 3.45), glass, landmarks, 0.012)
    elif variant == 3:
        box("EAST3_WEST_WING", (-1.32, 0.18, body_height / 2), (1.90, depth, body_height), wall, shell, 0.075)
        box("EAST3_EAST_WING", (1.32, 0.18, body_height / 2), (1.90, depth, body_height), wall, shell, 0.075)
        box("EAST3_BRIDGE", (0, 0.30, 1.62), (1.15, 2.30, 0.70), wall_shadow, shell, 0.05)
        box("EAST3_ENTRY_GLASS", (0, -1.20, 0.82), (1.05, 0.16, 1.45), glass, landmarks, 0.018)
    else:
        box("EAST4_BASE", (-0.38, 0.18, body_height / 2), (3.85, depth, body_height), wall, shell, 0.075)
        box("EAST4_STAIR_TOWER", (1.72, 0.28, 2.34), (1.05, 2.48, 4.68), wall_shadow, shell, 0.07)
        for z in (0.80, 1.52, 2.24, 2.96, 3.68):
            box(f"EAST4_TOWER_SLOT_{z}", (1.72, -0.99, z), (0.40, 0.06, 0.32), glass, facade, 0.008)

    box(f"EAST{variant}_ROOF_CAP", (0, 0.18, body_height + 0.06), (width + 0.18, depth + 0.16, 0.16), roof, shell, 0.03)

    add_window_grid(
        f"EAST{variant}",
        width=width,
        front_y=-1.285,
        floors=floors,
        columns=8,
        z0=0.56,
        floor_gap=floor_gap,
        window_w=0.34,
        window_h=0.35,
        window_mat=glass,
        frame_mat=green,
        collection=facade,
        warm_every=9 + variant,
        warm_mat=warm,
    )

    # Deep green verticals and the wavy photovoltaic arcade are the shared
    # identity of the real east teaching complex.
    for x in (-2.05, -1.53, -1.01, -0.50, 0.50, 1.01, 1.53, 2.05):
        box(
            f"EAST{variant}_GREEN_FIN_{x}",
            (x, -1.326, body_height * 0.52),
            (0.055, 0.045, body_height * 0.82),
            green,
            facade,
            0.005,
        )
    wave_canopy(
        f"EAST{variant}_WAVE_PHOTOVOLTAIC_ARCADE",
        5.15,
        -1.90,
        1.02,
        roof,
        landmarks,
        phase=(variant - 1) * math.pi / 2,
    )
    for x in (-2.30, -1.15, 0, 1.15, 2.30):
        box(
            f"EAST{variant}_ARCADE_COLUMN_{x}",
            (x, -1.90, 0.50),
            (0.075, 0.075, 0.96),
            green,
            landmarks,
            0.008,
        )
    box(f"EAST{variant}_ENTRY_STEP", (0, -1.66, 0.12), (1.72, 0.56, 0.20), wall_shadow, landmarks, 0.03)


def add_camera_and_lights(scene, fx, spec):
    bpy.ops.object.light_add(type="AREA", location=(6.5, -7.5, 11.0))
    key = bpy.context.object
    key.name = "KEY_COOL_MOON"
    key.data.energy = 980
    key.data.color = (0.63, 0.75, 0.85)
    key.data.shape = "DISK"
    key.data.size = 6.0
    look_at(key, (0, 0, spec["target_z"]))
    link_to(key, fx)

    bpy.ops.object.light_add(type="AREA", location=(-5.0, -3.0, 5.0))
    fill = bpy.context.object
    fill.name = "FILL_TEAL"
    fill.data.energy = 520
    fill.data.color = (0.28, 0.48, 0.52)
    fill.data.size = 5.0
    look_at(fill, (0, 0, 1.2))
    link_to(fill, fx)

    bpy.ops.object.light_add(type="AREA", location=(0, -5.0, 2.4))
    entry = bpy.context.object
    entry.name = "ENTRY_WARM_GLOW"
    entry.data.energy = 260
    entry.data.color = (1.0, 0.42, 0.12)
    entry.data.size = 2.0
    look_at(entry, (0, -1.0, 1.1))
    link_to(entry, fx)

    bpy.ops.object.camera_add(location=(8.9, -11.2, 8.4))
    camera = bpy.context.object
    camera.name = "GAME_ISOMETRIC_ORTHO_CAMERA"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = spec["ortho"]
    look_at(camera, (0, 0, spec["target_z"]))
    scene.camera = camera
    link_to(camera, fx)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene(building_id, spec):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.use_file_extension = True
    scene.world.color = (0.012, 0.020, 0.027)
    scene.render.use_freestyle = True
    scene.render.line_thickness = 0.75
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(BUILDING_ROOT / building_id / f"{building_id}.png")

    scene["building_id"] = building_id
    scene["display_name"] = spec["name"]
    w, d, h = spec["footprint"]
    scene["game_footprint"] = f"w={w},d={d},h={h}"
    scene["asset_role"] = "transparent exterior 2.5D sprite source"
    scene["gameplay_contract"] = "visual only; mapData owns roads, entrance, collision and story"
    scene["reference_basis"] = "ZJU public campus photos and official east teaching architecture description"

    freestyle = scene.view_layers[0].freestyle_settings
    freestyle.linesets[0].linestyle.color = (0.006, 0.010, 0.014)
    freestyle.linesets[0].linestyle.thickness = 0.85
    return scene


def build_one(building_id):
    if building_id not in SPECS:
        raise ValueError(f"Unknown building id: {building_id}")
    spec = SPECS[building_id]
    out_dir = BUILDING_ROOT / building_id
    out_dir.mkdir(parents=True, exist_ok=True)
    clean_scene()
    scene = configure_scene(building_id, spec)
    shell, facade, landmarks, fx = make_collections(scene)

    if building_id == "linhu-canteen":
        mats = (
            material("linhu_off_white", (0.43, 0.46, 0.44)),
            material("linhu_shadow_wall", (0.24, 0.29, 0.29)),
            material("linhu_dark_roof", (0.055, 0.090, 0.100), metallic=0.14, roughness=0.44),
            material("linhu_teal_glass", (0.035, 0.15, 0.17), metallic=0.18, roughness=0.25),
            material("linhu_green_frame", (0.035, 0.14, 0.14), metallic=0.12, roughness=0.38),
            material(
                "linhu_warm_glass",
                (0.46, 0.18, 0.035),
                roughness=0.30,
                emission=(1.0, 0.20, 0.025),
                emission_strength=0.55,
            ),
            material("linhu_orange_trim", (0.36, 0.10, 0.025), roughness=0.56),
        )
        build_linhu(shell, facade, landmarks, mats)
    else:
        mats = (
            material("east_white_tile", (0.40, 0.42, 0.40)),
            material("east_shadow_tile", (0.22, 0.25, 0.24)),
            material("east_photovoltaic_roof", (0.035, 0.065, 0.072), metallic=0.28, roughness=0.35),
            material("east_blue_green_glass", (0.035, 0.13, 0.14), metallic=0.14, roughness=0.25),
            material("east_green_steel", (0.025, 0.11, 0.105), metallic=0.18, roughness=0.40),
            material(
                "east_warm_window",
                (0.44, 0.22, 0.055),
                roughness=0.34,
                emission=(1.0, 0.34, 0.06),
                emission_strength=0.38,
            ),
        )
        build_east_teaching(shell, facade, landmarks, mats, spec["variant"])

    add_camera_and_lights(scene, fx, spec)
    blend_path = out_dir / f"{building_id}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.render.render(write_still=True)
    return str(blend_path), scene.render.filepath


def main():
    requested = os.environ.get("ZJU_BUILDING_ID")
    ids = [requested] if requested else list(SPECS)
    for building_id in ids:
        build_one(building_id)


if __name__ == "__main__":
    main()
