"""Create a single-building Blender draft for the Nongyi Library (农医馆).

This is an editable geometry source, not a game asset.  The footprint and
game-facing id intentionally match src/game/mapData.ts:
medical-library, x=17.4, y=28.5, w=3.9, d=1.8, h=4.6.
"""

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "buildings" / "medical-library"
OUT_BLEND = OUT_DIR / "medical-library-draft.blend"
OUT_PNG = OUT_DIR / "medical-library-draft.png"


def material(name, color, metallic=0.0, roughness=0.82):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def link_to(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)


def box(name, location, dimensions, mat, collection, bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    link_to(obj, collection)
    if bevel:
        mod = obj.modifiers.new("soft_ink_edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def cylinder(name, location, radius, depth, mat, collection, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    link_to(obj, collection)
    bevel = obj.modifiers.new("soft_ink_edges", "BEVEL")
    bevel.width = 0.035
    bevel.segments = 2
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clean_scene()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUT_PNG)
    scene.render.film_transparent = False
    scene.world.color = (0.025, 0.035, 0.052)
    scene.render.use_freestyle = True
    scene.render.line_thickness = 0.75

    site = bpy.data.collections.new("SITE_REFERENCE")
    building = bpy.data.collections.new("BUILDING_NONGYI")
    details = bpy.data.collections.new("BUILDING_DETAILS")
    camera_fx = bpy.data.collections.new("CAMERA_AND_LIGHTS")
    for collection in (site, building, details, camera_fx):
        scene.collection.children.link(collection)

    ground_mat = material("site_neutral", (0.075, 0.095, 0.11))
    base_mat = material("nongyi_base", (0.30, 0.34, 0.35))
    wall_mat = material("nongyi_wall", (0.44, 0.48, 0.48))
    roof_mat = material("nongyi_roof", (0.12, 0.16, 0.18))
    glass_mat = material("nongyi_glass", (0.12, 0.27, 0.31), metallic=0.05, roughness=0.32)
    trim_mat = material("nongyi_trim", (0.22, 0.27, 0.28))
    entry_mat = material("nongyi_entry", (0.20, 0.24, 0.24))
    lamp_mat = material("nongyi_entry_light", (0.78, 0.30, 0.08), roughness=0.4)

    # A small site plate preserves the exact game footprint ratio without
    # pretending this is a measured survey model.
    box("SITE_FOOTPRINT_3p9x1p8", (0, 0, -0.16), (6.0, 4.4, 0.22), ground_mat, site, bevel=0.03)
    box("SITE_BUILDING_FOOTPRINT", (0, 0, -0.01), (3.9, 1.8, 0.12), trim_mat, site, bevel=0.015)

    # Nongyi's first-pass silhouette: long low podium, central taller tower,
    # stepped roof caps and a readable glazed entrance spine.
    box("NONGYI_PODIUM", (0, 0, 0.86), (3.9, 1.8, 1.78), base_mat, building, bevel=0.09)
    box("NONGYI_PODIUM_CAP", (0, 0, 1.82), (4.05, 1.92, 0.18), roof_mat, building, bevel=0.04)
    box("NONGYI_TOWER", (0.15, 0.10, 3.15), (1.55, 1.25, 4.55), wall_mat, building, bevel=0.085)
    box("NONGYI_TOWER_CAP", (0.15, 0.10, 5.51), (1.72, 1.40, 0.16), roof_mat, building, bevel=0.035)
    box("NONGYI_TOWER_CROWN", (0.15, 0.10, 5.73), (0.92, 0.78, 0.28), trim_mat, building, bevel=0.035)

    # A slightly recessed centre bay is the main visual cue for the entrance.
    box("NONGYI_GLASS_SPINE", (-0.86, -0.92, 1.30), (1.00, 0.08, 1.38), glass_mat, details, bevel=0.015)
    box("NONGYI_GLASS_SPINE_TOP", (-0.86, -0.94, 2.08), (1.18, 0.16, 0.12), trim_mat, details, bevel=0.02)
    box("NONGYI_ENTRY_CANOPY", (-0.86, -1.12, 1.94), (1.42, 0.48, 0.13), roof_mat, details, bevel=0.025)
    box("NONGYI_ENTRY_STEP", (-0.86, -1.02, 0.17), (1.18, 0.48, 0.18), entry_mat, details, bevel=0.025)

    # Repeated vertical fins read as ink-friendly facade rhythm.  They remain
    # separate meshes so the artist can replace them with windows or signage.
    for i, x in enumerate((-1.70, -1.30, 0.92, 1.32)):
        box(f"NONGYI_FACADE_FIN_{i+1}", (x, -0.94, 1.20), (0.10, 0.08, 1.32), trim_mat, details, bevel=0.012)
    for i, x in enumerate((-0.35, 0.05, 0.45)):
        box(f"NONGYI_TOWER_FIN_{i+1}", (x, -0.56, 3.28), (0.10, 0.06, 2.62), trim_mat, details, bevel=0.012)

    # Entrance marker is intentionally geometry-only; final art can swap this
    # for a texture, sign, or emissive window strip.
    cylinder("NONGYI_ENTRY_MARKER", (-0.86, -1.38, 0.42), 0.10, 0.06, lamp_mat, details, vertices=24)

    # Soft neutral studio lighting makes the blockout inspectable.  No horror
    # decoration or final palette is baked into this source file.
    bpy.ops.object.light_add(type="AREA", location=(5.0, -6.0, 10.0))
    key = bpy.context.object
    key.name = "KEY_SOFTBOX"
    key.data.energy = 850
    key.data.shape = "DISK"
    key.data.size = 5.0
    look_at(key, (0, 0, 1.5))
    link_to(key, camera_fx)

    bpy.ops.object.light_add(type="AREA", location=(-5.0, 2.0, 6.0))
    fill = bpy.context.object
    fill.name = "FILL_SOFTBOX"
    fill.data.energy = 430
    fill.data.size = 4.0
    look_at(fill, (0, 0, 1.2))
    link_to(fill, camera_fx)

    bpy.ops.object.camera_add(location=(8.8, -10.8, 8.5))
    camera = bpy.context.object
    camera.name = "NONGYI_ORTHO_CAMERA"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 8.3
    look_at(camera, (0, 0, 2.0))
    scene.camera = camera
    link_to(camera, camera_fx)

    # Contract metadata travels with the .blend and is easy to inspect later.
    scene["building_id"] = "medical-library"
    scene["display_name"] = "农医馆"
    scene["game_footprint"] = "x=17.4,y=28.5,w=3.9,d=1.8,h=4.6"
    scene["draft_scope"] = "geometry-only exterior source; no interior or gameplay changes"
    scene["next_step"] = "artist refinement: silhouette, windows, materials, texture, export"

    view_layer = scene.view_layers[0]
    freestyle = view_layer.freestyle_settings
    freestyle.linesets[0].linestyle.color = (0.008, 0.012, 0.016)
    freestyle.linesets[0].linestyle.thickness = 0.8

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
