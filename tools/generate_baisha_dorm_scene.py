from __future__ import annotations

"""Build the authored Baisha dorm escape level from local production assets.

Run with: D:\\blender.exe --background --python tools/generate_baisha_dorm_scene.py
The gameplay topology is shared with buildBaishaRunRoom.ts.  Static geometry,
lights and props live in this GLB; TypeScript remains authoritative for gates,
pickups, monster routing and collision.
"""

import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "3D_Assets"
OUT = ROOT / "public" / "models" / "interiors" / "dorm-baisha"


def three_to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, -z, y)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def new_mat(name: str, color: tuple[float, float, float, float], roughness=0.82, metallic=0.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next((node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        raise RuntimeError(f"Principled BSDF node missing from {name}")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission[0]
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat


def brick_mat():
    mat = new_mat("baisha_red_brick", (0.25, 0.045, 0.035, 1), 0.93)
    node_tree = mat.node_tree
    bsdf = next((node for node in node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    tex_root = ASSETS / "红砖贴图"
    files = {
        "Base Color": tex_root / "BrickWall27_4K_BaseColor.png",
        "Roughness": tex_root / "BrickWall27_4K_Roughness.png",
        "Normal": tex_root / "BrickWall27_4K_Normal.png",
    }
    for socket, path in files.items():
        if not path.exists():
            continue
        image = bpy.data.images.load(str(path), check_existing=True)
        # 4K source is excessive for a web corridor; the packed GLB uses 1K.
        if image.size[0] > 1024:
            image.scale(1024, max(1, int(image.size[1] * 1024 / image.size[0])))
        image.pack()
        node = node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        if socket == "Normal":
            image.colorspace_settings.name = "Non-Color"
            normal = node_tree.nodes.new("ShaderNodeNormalMap")
            normal.inputs["Strength"].default_value = 0.52
            node_tree.links.new(node.outputs["Color"], normal.inputs["Color"])
            node_tree.links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
        else:
            if socket == "Roughness":
                image.colorspace_settings.name = "Non-Color"
            node_tree.links.new(node.outputs["Color"], bsdf.inputs[socket])
    return mat


def cube(name, x, y, z, w, h, d, mat, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=three_to_blender(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    obj.rotation_euler[2] = -rot
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("edge_softening", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 1
    return obj


def append_local_prop(path: Path, name: str, x: float, y: float, z: float, scale: float) -> None:
    """Append one real local mesh as horror dressing; never fail the export."""
    if not path.exists():
        return
    try:
        with bpy.data.libraries.load(str(path), link=False) as (source, target):
            target.objects = [obj for obj in source.objects if obj][:1]
        for obj in target.objects:
            if not obj:
                continue
            bpy.context.collection.objects.link(obj)
            obj.name = name
            obj.location = three_to_blender(x, y, z)
            obj.scale = (scale, scale, scale)
    except Exception as exc:
        print(f"optional local prop skipped ({path.name}): {exc}")


def import_authored_dorm(detail: bool) -> bool:
    """Import the actual supplied dormitory FBX and normalize it to metres."""
    source = ASSETS / "宿舍内景" / "dormitory_source.fbx"
    if not source.exists():
        return False
    before = set(bpy.context.scene.objects)
    try:
        bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
    except Exception as exc:
        print(f"authored dorm import failed: {exc}")
        return False
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        return False

    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    lo = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    hi = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    center = (lo + hi) * 0.5
    # Bake the imported hierarchy to world matrices before export. The FBX has
    # nested 3ds Max transforms that Blender displays correctly but that used
    # to expand to kilometre-scale coordinates when serialized as glTF.
    target = Vector(three_to_blender(-3.75, 0.0, 4.15))
    transform = Matrix.Translation(target - center) @ Matrix.Rotation(math.pi, 4, "Z")
    world_matrices = {obj: obj.matrix_world.copy() for obj in imported}
    for obj in imported:
        obj.parent = None
    for obj in imported:
        obj.matrix_world = transform @ world_matrices[obj]
    for mesh in meshes:
        if not detail:
            modifier = mesh.modifiers.new("lod_decimate", "DECIMATE")
            modifier.ratio = 0.22
        mesh.name = f"authored_dorm_{mesh.name}"
    print(f"authored dorm imported: meshes={len(meshes)} dimensions={hi - lo}")
    return True


def plane(name, x, y, z, w, d, mat):
    bpy.ops.mesh.primitive_plane_add(size=1, location=three_to_blender(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def corridor(name, x, z, w, d, brick, floor, ceiling, detail):
    cube(f"{name}_floor", x, -0.08, z, w, 0.16, d, floor)
    cube(f"{name}_ceiling", x, 3.22, z, w, 0.12, d, ceiling)
    # Physical walls are deliberately thick and visibly brick; openings are
    # placed only at the route junctions defined in the level topology.
    cube(f"{name}_wall_w", x - w / 2 + 0.12, 1.55, z, 0.24, 3.1, d, brick)
    cube(f"{name}_wall_e", x + w / 2 - 0.12, 1.55, z, 0.24, 3.1, d, brick)
    if detail:
        for offset in (-d * 0.24, 0, d * 0.24):
            cube(f"{name}_pipe_{offset:.1f}", x + w * 0.32, 2.7, z + offset, 0.1, 0.1, 1.35, new_mat(f"pipe_{name}_{offset}", (0.06, 0.055, 0.06, 1), 0.35, 0.8))


def strip_light(index, x, z, rotation, active=True):
    emissive = new_mat(f"red_strip_emissive_{index}", (0.38, 0.006, 0.008, 1), 0.35, 0.15, ((1, 0.005, 0.008, 1), 7.5))
    cube(f"RUN_LIGHT_MESH_{index:02d}", x, 3.05, z, 2.15, 0.07, 0.16, emissive, rotation)
    bpy.ops.object.light_add(type="POINT", location=three_to_blender(x, 2.92, z))
    light = bpy.context.object
    light.name = f"RUN_LIGHT_{index:02d}"
    light.data.color = (1.0, 0.02, 0.025)
    light.data.energy = 165 if active else 0
    light.data.shadow_soft_size = 0.42


def add_dorm(detail, floor, brick, wood, metal, use_fallback_shell: bool):
    if use_fallback_shell:
        cube("dorm_floor", -3.75, -0.08, 4.15, 5.7, 0.16, 4.3, floor)
        cube("dorm_back_wall", -3.75, 1.55, 6.27, 5.9, 3.1, 0.24, brick)
        cube("dorm_front_wall", -3.75, 1.55, 2.03, 5.9, 3.1, 0.24, brick)
        cube("dorm_right_wall", -0.95, 1.55, 4.15, 0.24, 3.1, 4.5, brick)
    # Bunk beds and desks read as a real dorm even at LOD.
    for idx, z in enumerate((3.0, 5.25)):
        cube(f"bunk_frame_{idx}", -2.1, 1.42, z, 1.35, 0.12, 1.82, metal)
        cube(f"bunk_mattress_{idx}", -2.1, 1.56, z, 1.22, 0.18, 1.72, new_mat(f"mattress_{idx}", (0.08, 0.14, 0.21, 1), 0.94))
        cube(f"desk_{idx}", -4.95, 0.75, z, 1.38, 0.08, 0.68, wood)
        for sx in (-0.56, 0.56):
            cube(f"desk_leg_{idx}_{sx}", -4.95 + sx, 0.36, z, 0.07, 0.72, 0.07, wood)
    # The photo visual is repositioned to an authored safe table anchor by metadata.
    frame = cube("PICKUP_PHOTOGRAPH_VISUAL", -4.9, 0.9, 4.8, 0.42, 0.035, 0.30, new_mat("photo_frame", (0.16, 0.08, 0.04, 1), 0.65))
    photo = cube("PICKUP_PHOTOGRAPH_VISUAL_IMAGE", -4.9, 0.925, 4.8, 0.35, 0.012, 0.23, new_mat("photo_paper", (0.74, 0.56, 0.34, 1), 0.92))
    photo.parent = frame
    cube("DOOR_DORM_EXIT", -6.68, 1.1, 2.48, 0.12, 2.2, 1.35, metal)
    if detail and use_fallback_shell:
        append_local_prop(ASSETS / "WoodenTable_03_2k.blend" / "WoodenTable_03_2k.blend", "real_dorm_table", -4.7, 0, 4.8, 0.58)


def add_ghost():
    ghost = bpy.data.objects.new("GHOST_SLENDER", None)
    bpy.context.collection.objects.link(ghost)
    black = new_mat("ghost_suit", (0.004, 0.003, 0.006, 1), 0.82)
    skin = new_mat("ghost_skin", (0.43, 0.27, 0.25, 1), 0.94)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, location=three_to_blender(-8.4, 2.62, -0.35))
    head = bpy.context.object
    head.name = "ghost_head"
    head.scale = (0.28, 0.28, 0.34)
    head.data.materials.append(skin)
    head.parent = ghost
    cube("ghost_body", -8.4, 1.3, -0.35, 0.46, 1.95, 0.30, black).parent = ghost
    ghost.location = three_to_blender(0, 0, 0)
    ghost.rotation_euler = (0, 0, 0)


def build(detail: bool):
    clear_scene()
    brick = brick_mat()
    floor = new_mat("wet_concrete", (0.055, 0.06, 0.068, 1), 0.76, 0.08)
    ceiling = new_mat("ceiling_grime", (0.022, 0.018, 0.024, 1), 0.98)
    wood = new_mat("dorm_dark_wood", (0.13, 0.065, 0.032, 1), 0.78)
    metal = new_mat("rusted_iron", (0.06, 0.055, 0.06, 1), 0.34, 0.72)

    # Four connected legs of the square route plus the ghost-only middle leg.
    corridor("left_leg", -8.25, -0.8, 3.3, 18.2, brick, floor, ceiling, detail)
    corridor("top_leg", 0, -8.25, 19.8, 3.3, brick, floor, ceiling, detail)
    corridor("right_leg", 8.25, 0.8, 3.3, 19.8, brick, floor, ceiling, detail)
    corridor("bottom_leg", -0.8, 8.25, 18.2, 3.3, brick, floor, ceiling, detail)
    corridor("ghost_shortcut", 0.3, 0, 15.4, 2.8, brick, floor, ceiling, detail)
    authored_dorm = import_authored_dorm(detail)
    add_dorm(detail, floor, brick, wood, metal, use_fallback_shell=not authored_dorm)
    cube("GATE_SHORTCUT", -6.75, 1.1, 0, 0.12, 2.2, 1.35, metal)

    # Every red strip is a real mesh + a named light; the frontend reveals a
    # 10m look-ahead window instead of dropping the player into darkness.
    placements = [(-8.25, -5.5, 0), (-8.25, -2.3, 0), (-8.25, 1.0, 0), (-8.25, 4.2, 0),
                  (-5.0, -8.25, math.pi / 2), (-1.7, -8.25, math.pi / 2), (1.6, -8.25, math.pi / 2), (4.9, -8.25, math.pi / 2),
                  (8.25, -5.0, 0), (8.25, -1.7, 0), (8.25, 1.6, 0), (8.25, 4.9, 0),
                  (5.0, 8.25, math.pi / 2), (1.7, 8.25, math.pi / 2), (-1.6, 8.25, math.pi / 2), (-4.9, 8.25, math.pi / 2)]
    for idx, (x, z, rot) in enumerate(placements):
        strip_light(idx, x, z, rot, active=idx < 3)

    # Real but non-blocking horror clutter at authored side alcoves.
    for idx, (x, z) in enumerate(((-9.15, -3.2), (-6.95, -5.4), (6.95, 4.5), (4.8, 9.0))):
        cube(f"safe_obstacle_{idx}", x, 0.5, z, 0.38, 1.0, 0.58, metal)
    if detail:
        append_local_prop(ASSETS / "医药柜子" / "Hospital Cabinet.blend", "real_medical_cabinet", -9.05, 0, -3.2, 0.42)
        append_local_prop(ASSETS / "骷髅头" / "Cycles.blend", "real_skull_prop", 6.95, 0.72, 4.5, 0.3)
    cube("PICKUP_ENERGY_VISUAL", 8.45, 0.82, 3.0, 0.19, 0.34, 0.19, new_mat("energy_can", (0.48, 0.01, 0.01, 1), 0.35, 0.4, ((1, 0.005, 0.005, 1), 1.5)))
    add_ghost()


def export(path: Path):
    OUT.mkdir(parents=True, exist_ok=True)
    kwargs = dict(filepath=str(path), export_format="GLB", export_apply=True, export_yup=True, export_lights=True, export_image_format="WEBP", export_copyright="Generated from local Baisha dorm assets.")
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=8)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)


def write_meta():
    meta = {
        "assetVersion": 1,
        "buildingId": "dorm-baisha",
        "roomKind": "dorm",
        "model": "scene.glb",
        "lodModel": "scene.lod.glb",
        "units": "meters",
        "qualityProfile": "baisha-high-asset-chase",
        "sourceAssets": ["宿舍内景/dormitory_source.fbx", "红砖贴图/BrickWall27_4K", "走廊/CORIDOR/HORROR.blend", "瘦长鬼影/Blender_2.81.blend"],
        "spawn": {"x": -4.8, "y": 1.6, "z": 4.2, "yaw": 1.57},
        "bounds": {"minX": -10.2, "maxX": 10.2, "minZ": -10.2, "maxZ": 10.2},
        "pickupVisuals": {"photograph": ["PICKUP_PHOTOGRAPH_VISUAL"], "energy": ["PICKUP_ENERGY_VISUAL"]},
        "pickupSpots": {"photograph": [{"x": -4.9, "z": 4.8}, {"x": -3.8, "z": 4.1}, {"x": -2.8, "z": 5.2}, {"x": -4.1, "z": 3.2}], "energy": [{"x": 8.45, "z": 3.0}]},
        "notes": ["Static high-detail environment; TypeScript owns the run FSM, gates, nav route and pickup persistence.", "GLB is Draco-compressed when supported by the installed Blender exporter. KTX2 decoder is configured frontend-side for future texture exports."],
    }
    (OUT / "scene.meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    build(detail=True)
    export(OUT / "scene.glb")
    build(detail=False)
    export(OUT / "scene.lod.glb")
    write_meta()
    print("Baisha dorm GLB exports complete")
