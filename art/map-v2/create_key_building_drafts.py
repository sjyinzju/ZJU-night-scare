"""Generate the four exterior building source files used by the map preview.

Each output is an intentionally simple, editable Blender scene.  It contains
only the building silhouette and facade cues; the Phaser map remains the
authority for roads, collision, entrances, story and interior transitions.
"""

from pathlib import Path
import sys

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from create_medical_library_draft import box, cylinder, link_to, look_at, material  # noqa: E402


BUILDINGS = {
    "medical-library": {
        "name": "农医馆",
        "footprint": (3.9, 1.8),
        "height": 4.6,
        "ortho": 7.7,
        "palette": ((0.44, 0.48, 0.48), (0.30, 0.34, 0.35), (0.12, 0.27, 0.31)),
    },
    "medical-college": {
        "name": "医学院",
        "footprint": (3.5, 1.7),
        "height": 4.4,
        "ortho": 7.4,
        "palette": ((0.40, 0.46, 0.47), (0.28, 0.33, 0.35), (0.12, 0.30, 0.33)),
    },
    "dorm-baisha": {
        "name": "白沙宿舍区",
        "footprint": (2.9, 1.5),
        "height": 3.0,
        "ortho": 5.8,
        "palette": ((0.48, 0.45, 0.40), (0.25, 0.28, 0.28), (0.18, 0.28, 0.28)),
    },
    "little-theater": {
        "name": "小剧场",
        "footprint": (2.0, 1.8),
        "height": 3.6,
        "ortho": 5.8,
        "palette": ((0.46, 0.36, 0.48), (0.20, 0.17, 0.24), (0.28, 0.13, 0.18)),
    },
}


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        if col.name != "Collection":
            bpy.data.collections.remove(col)


def make_collections(scene):
    root = bpy.data.collections.new("BUILDING_SOURCE")
    details = bpy.data.collections.new("FACADE_DETAILS")
    fx = bpy.data.collections.new("CAMERA_AND_LIGHTS")
    scene.collection.children.link(root)
    scene.collection.children.link(details)
    scene.collection.children.link(fx)
    return root, details, fx


def add_lights(fx):
    bpy.ops.object.light_add(type="AREA", location=(5.0, -6.0, 10.0))
    key = bpy.context.object
    key.name = "KEY_SOFTBOX"
    key.data.energy = 850
    key.data.size = 5.0
    look_at(key, (0, 0, 1.5))
    link_to(key, fx)

    bpy.ops.object.light_add(type="AREA", location=(-5.0, 2.0, 6.0))
    fill = bpy.context.object
    fill.name = "FILL_SOFTBOX"
    fill.data.energy = 420
    fill.data.size = 4.0
    look_at(fill, (0, 0, 1.2))
    link_to(fill, fx)


def build_medical_library(root, details, mats):
    body, base, glass = mats
    box("PODIUM", (0, 0, 0.86), (3.9, 1.8, 1.78), base, root, bevel=0.09)
    box("PODIUM_CAP", (0, 0, 1.82), (4.05, 1.92, 0.18), mats[1], root, bevel=0.04)
    box("CENTRAL_TOWER", (0.15, 0.10, 3.15), (1.55, 1.25, 4.55), body, root, bevel=0.085)
    box("TOWER_CAP", (0.15, 0.10, 5.51), (1.72, 1.40, 0.16), mats[1], root, bevel=0.035)
    box("GLASS_ENTRY_SPINE", (-0.86, -0.92, 1.30), (1.00, 0.08, 1.38), glass, details, bevel=0.015)
    box("ENTRY_CANOPY", (-0.86, -1.12, 1.94), (1.42, 0.48, 0.13), mats[1], details, bevel=0.025)
    for i, x in enumerate((-1.70, -1.30, 0.92, 1.32)):
        box(f"VERTICAL_FIN_{i+1}", (x, -0.94, 1.20), (0.10, 0.08, 1.32), mats[1], details, bevel=0.012)


def build_medical_college(root, details, mats):
    body, base, glass = mats
    # L-shaped teaching block with a taller stair/elevator tower.
    box("LONG_WING", (0, 0, 1.16), (3.5, 0.92, 2.45), body, root, bevel=0.08)
    box("REAR_WING", (-1.18, 0.80, 1.16), (1.12, 0.80, 2.45), base, root, bevel=0.07)
    box("TALL_TOWER", (1.10, 0.45, 2.62), (0.96, 1.12, 4.30), body, root, bevel=0.075)
    box("ROOF_BAND", (0, 0, 2.48), (3.66, 1.04, 0.16), mats[1], root, bevel=0.03)
    box("TOWER_CAP", (1.10, 0.45, 4.88), (1.10, 1.28, 0.16), mats[1], root, bevel=0.03)
    box("GLASS_LOBBY", (-0.46, -0.50, 1.26), (1.05, 0.08, 1.86), glass, details, bevel=0.015)
    for i, x in enumerate((-1.42, -0.98, 0.52, 0.90)):
        box(f"FACADE_FIN_{i+1}", (x, -0.49, 1.32), (0.09, 0.07, 1.95), mats[1], details, bevel=0.012)
    for i, z in enumerate((1.15, 2.0, 2.85, 3.7)):
        box(f"TOWER_WINDOW_BAND_{i+1}", (1.10, -0.125, z), (0.56, 0.06, 0.12), glass, details, bevel=0.01)


def build_dorm(root, details, mats):
    body, roof, glass = mats
    # Two connected residential slabs with a recessed central entrance court.
    box("DORM_WING_LEFT", (-0.82, 0, 1.18), (1.18, 1.50, 2.55), body, root, bevel=0.065)
    box("DORM_WING_RIGHT", (0.82, 0, 1.18), (1.18, 1.50, 2.55), body, root, bevel=0.065)
    box("DORM_CONNECTOR", (0, 0.12, 0.72), (0.62, 1.22, 1.10), roof, root, bevel=0.05)
    box("DORM_ROOF_LEFT", (-0.82, 0, 2.58), (1.28, 1.62, 0.16), roof, root, bevel=0.03)
    box("DORM_ROOF_RIGHT", (0.82, 0, 2.58), (1.28, 1.62, 0.16), roof, root, bevel=0.03)
    box("DORM_ENTRY", (0, -0.78, 0.90), (0.74, 0.08, 1.16), glass, details, bevel=0.015)
    for side, x in (("L", -0.82), ("R", 0.82)):
        for i, z in enumerate((0.75, 1.35, 1.95, 2.42)):
            box(f"WINDOW_{side}_{i+1}", (x, -0.77, z), (0.58, 0.05, 0.12), glass, details, bevel=0.008)
    box("DORM_SIGN_BAND", (0, -0.84, 1.82), (1.24, 0.06, 0.13), roof, details, bevel=0.012)


def build_theater(root, details, mats):
    body, roof, stage = mats
    # Low hall plus a raised stage volume.  The rounded canopy is the readable
    # cue, not a pipe-like road or a separate map element.
    box("THEATER_HALL", (0, 0.08, 0.92), (2.0, 1.58, 1.72), body, root, bevel=0.11)
    box("STAGE_VOLUME", (0.35, 0.20, 1.92), (1.02, 1.22, 2.95), body, root, bevel=0.10)
    cylinder("STAGE_CANOPY", (-0.22, -0.78, 1.80), 0.72, 0.16, stage, details, vertices=32)
    # Lay the canopy flat and make it slightly elliptical from the camera.
    bpy.context.object.scale.y = 0.48
    bpy.context.object.rotation_euler[0] = 0.0
    box("THEATER_ENTRY", (-0.22, -0.83, 0.92), (0.76, 0.08, 1.06), stage, details, bevel=0.025)
    box("THEATER_ROOF_BAND", (0, 0.08, 1.86), (2.16, 1.72, 0.16), roof, root, bevel=0.04)
    for i, x in enumerate((-0.70, -0.35, 0.70)):
        box(f"THEATER_FACADE_FIN_{i+1}", (x, -0.74, 1.05), (0.09, 0.06, 1.10), roof, details, bevel=0.012)


BUILDERS = {
    "medical-library": build_medical_library,
    "medical-college": build_medical_college,
    "dorm-baisha": build_dorm,
    "little-theater": build_theater,
}


def build_one(building_id, spec):
    clean_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.render.filepath = str(ROOT / "buildings" / building_id / f"{building_id}.png")
    scene.world.color = (0.02, 0.03, 0.04)
    scene.render.use_freestyle = True
    scene.render.line_thickness = 0.7

    root, details, fx = make_collections(scene)
    palette = spec["palette"]
    mats = (
        material(f"{building_id}_body", palette[0]),
        material(f"{building_id}_roof", palette[1]),
        material(f"{building_id}_glass", palette[2], metallic=0.04, roughness=0.30),
    )
    BUILDERS[building_id](root, details, mats)
    add_lights(fx)

    bpy.ops.object.camera_add(location=(8.8, -10.8, 8.5))
    camera = bpy.context.object
    camera.name = f"{building_id.upper()}_ORTHO_CAMERA"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = spec["ortho"]
    look_at(camera, (0, 0, spec["height"] * 0.42))
    scene.camera = camera
    link_to(camera, fx)

    scene[f"building_id"] = building_id
    scene["display_name"] = spec["name"]
    scene["game_footprint"] = f"w={spec['footprint'][0]},d={spec['footprint'][1]},h={spec['height']}"
    scene["asset_role"] = "exterior 2.5D sprite source"
    scene["integration_rule"] = "overlay at mapData building centre; keep roads and gameplay in Phaser"

    freestyle = scene.view_layers[0].freestyle_settings
    freestyle.linesets[0].linestyle.color = (0.008, 0.012, 0.016)
    freestyle.linesets[0].linestyle.thickness = 0.8

    out_dir = ROOT / "buildings" / building_id
    out_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / f"{building_id}.blend"))
    bpy.ops.render.render(write_still=True)


def main():
    for building_id, spec in BUILDINGS.items():
        build_one(building_id, spec)


if __name__ == "__main__":
    main()
