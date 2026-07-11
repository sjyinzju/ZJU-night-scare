from __future__ import annotations

import json
import math
import random
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "3D_Assets"
OUT_DIR = ROOT / "public" / "models" / "interiors" / "medical-library"

ROOM_W = 13.5
ROOM_L = 18.0
ROOM_H = 4.2

FLASHLIGHT_SPOTS = [
    {"x": -3.15, "y": 0.08, "z": -2.15},
    {"x": -2.25, "y": 0.08, "z": -3.25},
    {"x": -3.25, "y": 0.08, "z": -4.75},
    {"x": -1.55, "y": 0.08, "z": -5.15},
]


def rgb(hex_color: int, alpha: float = 1.0) -> tuple[float, float, float, float]:
    return (
        ((hex_color >> 16) & 255) / 255,
        ((hex_color >> 8) & 255) / 255,
        (hex_color & 255) / 255,
        alpha,
    )


def three_to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, -z, y)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)
    for block in list(bpy.data.lights):
        bpy.data.lights.remove(block)
    for block in list(bpy.data.cameras):
        bpy.data.cameras.remove(block)


def set_input(bsdf: bpy.types.Node, name: str, value) -> None:
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


def material(
    name: str,
    color: int,
    *,
    roughness: float = 0.85,
    metallic: float = 0.0,
    alpha: float = 1.0,
    emission: int | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        set_input(bsdf, "Base Color", rgb(color, alpha))
        set_input(bsdf, "Roughness", roughness)
        set_input(bsdf, "Metallic", metallic)
        set_input(bsdf, "Alpha", alpha)
        if emission is not None:
            set_input(bsdf, "Emission Color", rgb(emission))
            set_input(bsdf, "Emission Strength", emission_strength)
    mat.blend_method = "BLEND" if alpha < 1.0 else "OPAQUE"
    return mat


def adjust_color_image(
    img: bpy.types.Image,
    *,
    value: float = 1.0,
    saturation: float = 1.0,
    tint: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> bpy.types.Image:
    adjusted = img.copy()
    adjusted.name = f"{img.name}_grade_v{value:.2f}_s{saturation:.2f}"
    pixels = array("f", [0.0]) * (img.size[0] * img.size[1] * 4)
    img.pixels.foreach_get(pixels)
    for i in range(0, len(pixels), 4):
        r = pixels[i]
        g = pixels[i + 1]
        b = pixels[i + 2]
        gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
        pixels[i] = max(0.0, min(1.0, (gray + (r - gray) * saturation) * value * tint[0]))
        pixels[i + 1] = max(0.0, min(1.0, (gray + (g - gray) * saturation) * value * tint[1]))
        pixels[i + 2] = max(0.0, min(1.0, (gray + (b - gray) * saturation) * value * tint[2]))
    adjusted.pixels.foreach_set(pixels)
    adjusted.pack()
    return adjusted


def image_texture(
    path: Path,
    *,
    non_color: bool = False,
    value: float = 1.0,
    saturation: float = 1.0,
    tint: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> bpy.types.Image | None:
    if not path.exists():
        return None
    img = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        try:
            img.colorspace_settings.name = "Non-Color"
        except TypeError:
            pass
    elif value != 1.0 or saturation != 1.0 or tint != (1.0, 1.0, 1.0):
        img = adjust_color_image(img, value=value, saturation=saturation, tint=tint)
    return img


def pbr_material(
    name: str,
    *,
    base: Path | None = None,
    normal: Path | None = None,
    roughness: Path | None = None,
    metallic: Path | None = None,
    base_value: float = 1.0,
    base_saturation: float = 1.0,
    base_tint: tuple[float, float, float] = (1.0, 1.0, 1.0),
    fallback: int = 0x777777,
) -> bpy.types.Material:
    mat = material(name, fallback, roughness=0.86)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if not bsdf:
        return mat

    if base:
        img = image_texture(base, value=base_value, saturation=base_saturation, tint=base_tint)
        if img:
            node = nodes.new("ShaderNodeTexImage")
            node.image = img
            links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if roughness:
        img = image_texture(roughness, non_color=True)
        if img:
            node = nodes.new("ShaderNodeTexImage")
            node.image = img
            links.new(node.outputs["Color"], bsdf.inputs["Roughness"])
    if metallic:
        img = image_texture(metallic, non_color=True)
        if img:
            node = nodes.new("ShaderNodeTexImage")
            node.image = img
            links.new(node.outputs["Color"], bsdf.inputs["Metallic"])
    if normal:
        img = image_texture(normal, non_color=True)
        if img:
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            nmap = nodes.new("ShaderNodeNormalMap")
            nmap.inputs["Strength"].default_value = 0.55
            links.new(tex.outputs["Color"], nmap.inputs["Color"])
            links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def generated_wall_material(name: str, *, seed: int = 1047, size: int = 512) -> bpy.types.Material:
    rng = random.Random(seed)
    img = bpy.data.images.new(f"{name}_albedo", width=size, height=size, alpha=False)
    pixels: list[float] = []
    streaks = [rng.uniform(0, size) for _ in range(12)]
    for y in range(size):
        for x in range(size):
            fine = rng.uniform(-0.025, 0.025)
            blotch = math.sin(x * 0.037 + y * 0.019) * 0.018 + math.sin(x * 0.011 - y * 0.029) * 0.014
            damp = 0.0
            for sx in streaks:
                dist = abs(x - sx)
                if dist < 18:
                    damp += (1 - dist / 18) * max(0, (size - y) / size) * rng.uniform(0.0, 0.012)
            lower_grime = max(0, (70 - y) / 70) * 0.11
            value = max(0.12, min(0.55, 0.34 + fine + blotch - damp - lower_grime))
            pixels.extend((value * 0.82, value * 0.95, value, 1.0))
    img.pixels.foreach_set(pixels)
    img.pack()

    mat = material(name, 0x42505a, roughness=0.98)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def add_bevel(obj: bpy.types.Object, width: float = 0.015, segments: int = 1) -> bpy.types.Object:
    bevel = obj.modifiers.new("softened_edges", "BEVEL")
    bevel.width = width
    bevel.segments = segments
    bevel.affect = "EDGES"
    obj.modifiers.new("weighted_normals", "WEIGHTED_NORMAL")
    return obj


def add_box(
    name: str,
    x: float,
    y: float,
    z: float,
    w: float,
    h: float,
    d: float,
    mat: bpy.types.Material,
    *,
    rot_y: float = 0.0,
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=three_to_blender(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    obj.rotation_euler[2] = -rot_y
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        add_bevel(obj, bevel)
    return obj


def add_plane_mesh(
    name: str,
    verts: list[tuple[float, float, float]],
    uvs: list[tuple[float, float]],
    mat: bpy.types.Material,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop, uv in zip(uv_layer.data, uvs):
        loop.uv = uv
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def add_floor_plane(mat: bpy.types.Material) -> bpy.types.Object:
    w = ROOM_W
    l = ROOM_L
    verts = [(-w / 2, -l / 2, 0), (w / 2, -l / 2, 0), (w / 2, l / 2, 0), (-w / 2, l / 2, 0)]
    uvs = [(0, 0), (w / 2.2, 0), (w / 2.2, l / 2.2), (0, l / 2.2)]
    return add_plane_mesh("pbr_worn_parquet_floor", verts, uvs, mat)


def add_floor_decal(
    name: str,
    x: float,
    z: float,
    w: float,
    d: float,
    mat: bpy.types.Material,
    *,
    rot_y: float = 0.0,
) -> bpy.types.Object:
    hw = w / 2
    hd = d / 2
    local = [Vector((-hw, -hd, 0)), Vector((hw, -hd, 0)), Vector((hw, hd, 0)), Vector((-hw, hd, 0))]
    rot = Matrix.Rotation(-rot_y, 4, "Z")
    base = Vector(three_to_blender(x, 0.024, z))
    verts = [tuple(base + (rot @ p)) for p in local]
    return add_plane_mesh(name, verts, [(0, 0), (1, 0), (1, 1), (0, 1)], mat)


def add_cylinder(
    name: str,
    x: float,
    y: float,
    z: float,
    radius: float,
    height: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 24,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=height,
        location=three_to_blender(x, y + height / 2, z),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    add_bevel(obj, 0.004)
    return obj


def add_point_light(name: str, x: float, y: float, z: float, color: int, energy: float, distance: float) -> None:
    bpy.ops.object.light_add(type="POINT", location=three_to_blender(x, y, z))
    light = bpy.context.object
    light.name = name
    data = light.data
    data.color = (((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255)
    data.energy = energy
    data.shadow_soft_size = 3.0
    if hasattr(data, "cutoff_distance"):
        data.cutoff_distance = distance


@dataclass
class AssetPrototype:
    name: str
    objects: list[bpy.types.Object]
    bbox_min: Vector
    bbox_max: Vector

    @property
    def center(self) -> Vector:
        return (self.bbox_min + self.bbox_max) * 0.5


def load_asset(
    asset_folder: str,
    *,
    filter_fn: Callable[[str], bool] | None = None,
    max_objects: int | None = None,
) -> AssetPrototype:
    folder = ASSET_DIR / asset_folder
    blend_path = next(folder.glob("*.blend"))
    with bpy.data.libraries.load(str(blend_path), link=False) as (data_from, data_to):
        names = [n for n in sorted(data_from.objects) if filter_fn is None or filter_fn(n)]
        if max_objects is not None:
            names = names[:max_objects]
        data_to.objects = names

    objects = [obj for obj in data_to.objects if obj and obj.type == "MESH"]
    if not objects:
        raise RuntimeError(f"No mesh objects loaded from {asset_folder}")

    for obj in objects:
        obj.name = f"proto_{asset_folder}_{obj.name}"
        for mat in obj.data.materials:
            if mat:
                mat.use_backface_culling = False

    bbox_min = Vector((float("inf"), float("inf"), float("inf")))
    bbox_max = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            bbox_min.x = min(bbox_min.x, point.x)
            bbox_min.y = min(bbox_min.y, point.y)
            bbox_min.z = min(bbox_min.z, point.z)
            bbox_max.x = max(bbox_max.x, point.x)
            bbox_max.y = max(bbox_max.y, point.y)
            bbox_max.z = max(bbox_max.z, point.z)

    return AssetPrototype(asset_folder, objects, bbox_min, bbox_max)


def instance_asset(
    proto: AssetPrototype,
    name: str,
    x: float,
    y: float,
    z: float,
    *,
    rot_y: float = 0.0,
    scale: float | tuple[float, float, float] = 1.0,
    anchor: str = "base",
    decimate: float = 1.0,
) -> list[bpy.types.Object]:
    if anchor == "center":
        offset_vec = -proto.center
    else:
        offset_vec = Vector((-proto.center.x, -proto.center.y, -proto.bbox_min.z))

    if isinstance(scale, tuple):
        scale_matrix = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    else:
        scale_matrix = Matrix.Scale(scale, 4)

    transform = (
        Matrix.Translation(Vector(three_to_blender(x, y, z)))
        @ Matrix.Rotation(-rot_y, 4, "Z")
        @ scale_matrix
        @ Matrix.Translation(offset_vec)
    )

    created: list[bpy.types.Object] = []
    for obj in proto.objects:
        copy = obj.copy()
        copy.data = obj.data
        copy.animation_data_clear()
        copy.name = f"{name}_{obj.name.removeprefix('proto_')}"
        bpy.context.collection.objects.link(copy)
        copy.matrix_world = transform @ obj.matrix_world
        copy.hide_render = False
        copy.hide_viewport = False
        copy.visible_shadow = True
        if decimate < 0.999:
            mod = copy.modifiers.new("lod_decimate", "DECIMATE")
            mod.ratio = decimate
        created.append(copy)
    return created


def normalize_loaded_images(max_size: int) -> None:
    for image in list(bpy.data.images):
        if not image.users:
            bpy.data.images.remove(image)
            continue
        name = image.name.lower()
        if any(token in name for token in ("nor", "rough", "metal", "alpha", "ao", "disp", "mask")):
            try:
                image.colorspace_settings.name = "Non-Color"
            except TypeError:
                pass
        width, height = image.size
        if width <= 0 or height <= 0:
            continue
        if max(width, height) > max_size:
            ratio = max_size / max(width, height)
            image.scale(max(1, int(width * ratio)), max(1, int(height * ratio)))
        try:
            image.pack()
        except RuntimeError:
            pass


def add_bookshelf_frame(
    name: str,
    x: float,
    z: float,
    w: float,
    h: float,
    d: float,
    mat: bpy.types.Material,
    *,
    rot_y: float = 0.0,
) -> None:
    add_box(f"{name}_back", x, h / 2, z, w, h, 0.08, mat, rot_y=rot_y, bevel=0.012)
    add_box(f"{name}_left", x - math.cos(rot_y) * w / 2, h / 2, z + math.sin(rot_y) * w / 2, 0.12, h, d, mat, rot_y=rot_y, bevel=0.012)
    add_box(f"{name}_right", x + math.cos(rot_y) * w / 2, h / 2, z - math.sin(rot_y) * w / 2, 0.12, h, d, mat, rot_y=rot_y, bevel=0.012)
    for i in range(5):
        add_box(f"{name}_shelf_{i}", x, 0.26 + i * 0.52, z, w, 0.07, d, mat, rot_y=rot_y, bevel=0.006)


def add_low_poly_books(
    rng: random.Random,
    name: str,
    x: float,
    z: float,
    shelf_w: float,
    mats: list[bpy.types.Material],
    *,
    rot_y: float = 0.0,
    rows: int = 4,
    density: int = 12,
) -> None:
    for row in range(rows):
        cursor = -shelf_w / 2 + 0.16
        i = 0
        while cursor < shelf_w / 2 - 0.18 and i < density:
            bw = rng.uniform(0.055, 0.13)
            bh = rng.uniform(0.25, 0.45)
            bd = rng.uniform(0.12, 0.22)
            lx = cursor + bw / 2
            wx = x + math.cos(rot_y) * lx
            wz = z - math.sin(rot_y) * lx
            add_box(
                f"{name}_{row}_{i}",
                wx,
                0.36 + row * 0.52 + bh / 2,
                wz,
                bw,
                bh,
                bd,
                rng.choice(mats),
                rot_y=rot_y,
                bevel=0.004,
            )
            cursor += bw + rng.uniform(0.012, 0.035)
            i += 1


def selected_decorative_book(name: str) -> bool:
    keep = {
        "book_softcover_01_cover01",
        "book_hardcover_01_cover02",
    }
    return name in keep


def selected_encyclopedia_book(name: str) -> bool:
    lowered = name.lower()
    return not any(token in lowered for token in ("sphere", "stash", "ball"))


def create_materials() -> dict[str, bpy.types.Material]:
    parquet = ASSET_DIR / "diagonal_parquet_2k.blend" / "textures"
    wall = ASSET_DIR / "peeling_painted_wall_1k.blend" / "textures"
    mats = {
        "floor": pbr_material(
            "pbr_diagonal_parquet_worn_floor",
            base=parquet / "diagonal_parquet_diff_2k.jpg",
            normal=parquet / "diagonal_parquet_nor_gl_2k.exr",
            roughness=parquet / "diagonal_parquet_rough_2k.exr",
            base_value=0.42,
            base_saturation=0.55,
            base_tint=(0.95, 0.88, 0.78),
            fallback=0x263441,
        ),
        "wall": pbr_material(
            "pbr_peeling_painted_wall",
            base=wall / "peeling_painted_wall_diff_1k.jpg",
            normal=wall / "peeling_painted_wall_nor_gl_1k.exr",
            roughness=wall / "peeling_painted_wall_rough_1k.exr",
            base_value=0.62,
            base_saturation=0.12,
            base_tint=(0.72, 0.86, 0.94),
            fallback=0x42505a,
        ),
        "wall_dark": material("older_lower_wall_band", 0x182229, roughness=0.98),
        "ceiling": material("low_dirty_acoustic_ceiling", 0x12171b, roughness=0.98),
        "wood": material("dark_library_shelf_wood", 0x3e2b20, roughness=0.9),
        "metal": material("dull_scratched_medical_metal", 0x5b6469, roughness=0.62, metallic=0.52),
        "brass": material("tarnished_brass_edges", 0x9c7440, roughness=0.52, metallic=0.36),
        "glass": material("dusty_glass", 0x9fb0b5, roughness=0.2, alpha=0.32),
        "paper": material("old_paper_pages", 0xb7ad91, roughness=0.96),
        "stain": material("transparent_damp_wall_stain", 0x071215, roughness=1.0, alpha=0.48),
        "dust": material("thin_floor_dust", 0xaaa189, roughness=1.0, alpha=0.28),
        "red": material("flickering_red_anomaly_surface", 0x8b1210, roughness=0.55, emission=0xff2b1f, emission_strength=0.55),
        "lamp_red": material("chandelier_red_glow", 0x8e120f, roughness=0.38, emission=0xff2a21, emission_strength=0.45),
        "tube": material("cold_fluorescent_tube", 0xcfe5e8, roughness=0.35, emission=0xcfeaff, emission_strength=1.3),
    }
    for i, color in enumerate((0x673735, 0x334e68, 0x44563b, 0x6b5a35, 0x3a3346, 0x6c6049)):
        mats[f"book_{i}"] = material(f"fallback_book_spine_{i}", color, roughness=0.88)
    return mats


def build_shell(rng: random.Random, mats: dict[str, bpy.types.Material]) -> None:
    add_floor_plane(mats["floor"])
    add_box("ceiling_slab_low_heavy", 0, ROOM_H + 0.04, 0, ROOM_W, 0.08, ROOM_L, mats["ceiling"])
    add_box("north_wall_cold_plaster", 0, ROOM_H / 2, -ROOM_L / 2, ROOM_W + 0.3, ROOM_H, 0.3, mats["wall"], bevel=0.006)
    add_box("south_wall_exit_plaster", 0, ROOM_H / 2, ROOM_L / 2, ROOM_W + 0.3, ROOM_H, 0.3, mats["wall"], bevel=0.006)
    add_box("west_wall_damp_plaster", -ROOM_W / 2, ROOM_H / 2, 0, 0.3, ROOM_H, ROOM_L + 0.3, mats["wall"], bevel=0.006)
    add_box("east_wall_damp_plaster", ROOM_W / 2, ROOM_H / 2, 0, 0.3, ROOM_H, ROOM_L + 0.3, mats["wall"], bevel=0.006)

    add_box("west_lower_mold_band", -ROOM_W / 2 + 0.012, 0.42, 0, 0.035, 0.42, ROOM_L - 0.4, mats["wall_dark"])
    add_box("east_lower_mold_band", ROOM_W / 2 - 0.012, 0.42, 0, 0.035, 0.42, ROOM_L - 0.4, mats["wall_dark"])
    add_box("north_lower_mold_band", 0, 0.42, -ROOM_L / 2 + 0.012, ROOM_W - 0.4, 0.42, 0.035, mats["wall_dark"])
    add_box("south_lower_mold_band", 0, 0.42, ROOM_L / 2 - 0.012, ROOM_W - 0.4, 0.42, 0.035, mats["wall_dark"])

    for i in range(18):
        side = rng.choice(("west", "east", "north", "south"))
        if side in ("west", "east"):
            x = -ROOM_W / 2 + 0.028 if side == "west" else ROOM_W / 2 - 0.028
            z = rng.uniform(-7.6, 7.6)
            add_box(f"{side}_vertical_water_stain_{i}", x, rng.uniform(0.8, 2.0), z, 0.018, rng.uniform(0.35, 1.3), rng.uniform(0.12, 0.34), mats["stain"])
        else:
            z = -ROOM_L / 2 + 0.028 if side == "north" else ROOM_L / 2 - 0.028
            x = rng.uniform(-5.8, 5.8)
            add_box(f"{side}_vertical_water_stain_{i}", x, rng.uniform(0.8, 2.0), z, rng.uniform(0.12, 0.44), rng.uniform(0.35, 1.1), 0.018, mats["stain"])

    for i, z in enumerate([-6.2, -2.9, 0.4, 3.7, 6.8]):
        add_box(f"fluorescent_housing_left_{i}", -3.2, ROOM_H - 0.15, z, 1.55, 0.07, 0.16, mats["metal"], bevel=0.004)
        add_box(f"fluorescent_tube_left_{i}", -3.2, ROOM_H - 0.22, z, 1.32, 0.035, 0.045, mats["tube"])
        if i % 2 == 0:
            add_box(f"fluorescent_housing_right_{i}", 3.2, ROOM_H - 0.15, z, 1.55, 0.07, 0.16, mats["metal"], bevel=0.004)
            add_box(f"fluorescent_tube_right_{i}", 3.2, ROOM_H - 0.22, z, 1.32, 0.035, 0.045, mats["tube"])


def build_procedural_fixtures(rng: random.Random, mats: dict[str, bpy.types.Material], detail: int) -> None:
    add_box("old_service_counter_real_asset_anchor", -4.65, 0.48, 4.7, 2.25, 0.95, 0.52, mats["wood"], bevel=0.025)
    add_box("metal_catalog_machine_body", -5.25, 0.88, 6.15, 0.62, 0.62, 0.42, mats["metal"], bevel=0.018)
    add_box("catalog_machine_red_screen", -5.25, 1.18, 5.92, 0.46, 0.26, 0.028, mats["red"])
    add_box("library_intro_wall_left", -4.65, 1.85, 0.45, 4.2, 3.7, 0.2, mats["wall"], bevel=0.006)
    add_box("library_intro_wall_right", 3.45, 1.85, 0.45, 6.1, 3.7, 0.2, mats["wall"], bevel=0.006)


def build_real_asset_scene(detail: int) -> dict:
    clear_scene()
    rng = random.Random(1776 + detail)
    mats = create_materials()
    build_shell(rng, mats)
    build_procedural_fixtures(rng, mats, detail)

    table = load_asset("WoodenTable_03_2k.blend")
    chair = load_asset("modern_arm_chair_01_2k.blend")
    bookshelf = load_asset("wooden_bookshelf_worn_1k.blend")
    gate = load_asset("large_iron_gate_1k.blend")
    tool_cart = load_asset("tool_cart_2k.blend")
    bed = load_asset("old_bed_frame_2k.blend")
    clock = load_asset("wall_clock_1k.blend")
    chandelier = load_asset("chinese_chandelier_2k.blend")
    torch = load_asset("small_plastic_torch_2k.blend")
    encyclopedia = load_asset(
        "book_encyclopedia_set_01_2k.blend",
        filter_fn=selected_encyclopedia_book,
        max_objects=3 if detail else 2,
    )
    decorative = load_asset(
        "decorative_book_set_01_2k.blend",
        filter_fn=selected_decorative_book if detail else lambda n: n == "book_hardcover_01_cover02",
    )

    lod_decimate = 0.72 if detail else 0.4
    table_positions = [
        (-5.0, -5.85, 0.04),
        (-5.0, -3.25, -0.03),
        (0.95, -5.85, 0.02),
        (4.25, -5.85, -0.02),
        (0.95, -3.25, 0.0),
        (4.25, -3.25, 0.03),
    ]
    for idx, (x, z, angle) in enumerate(table_positions):
        instance_asset(table, f"real_reading_table_{idx}", x, 0, z, rot_y=angle, scale=1.0, decimate=lod_decimate)
        for j, (dx, dz, ry) in enumerate(((-0.52, 0.92, 0), (0.52, -0.92, math.pi), (0.52, 0.92, 0), (-0.52, -0.92, math.pi))):
            if not detail and j > 1:
                continue
            instance_asset(chair, f"real_armchair_{idx}_{j}", x + dx, 0, z + dz, rot_y=ry + angle + math.pi, scale=0.55, decimate=0.35 if not detail else 0.55)

    shelf_positions = [(2.0, 2.05), (2.0, 4.75), (2.0, 7.05), (5.15, 2.05), (5.15, 4.75), (5.15, 7.05)]
    for idx, (x, z) in enumerate(shelf_positions):
        instance_asset(bookshelf, f"real_worn_bookshelf_{idx}", x, 0, z, rot_y=math.pi / 2, scale=1.18 if detail else 1.02, decimate=0.68 if detail else 0.42)
        rows = [0.58, 1.12, 1.66] if detail else [0.72, 1.48]
        for row_idx, y in enumerate(rows):
            for slot, offset in enumerate((-0.42, 0.42) if detail else (0.0,)):
                book_z = z + offset
                book_x = x - 0.16 + rng.uniform(-0.025, 0.025)
                book_proto = encyclopedia if detail and (idx + row_idx + slot) % 3 == 0 else decorative
                instance_asset(
                    book_proto,
                    f"real_books_on_shelf_{idx}_{row_idx}_{slot}",
                    book_x,
                    y,
                    book_z,
                    rot_y=math.pi / 2 + rng.uniform(-0.05, 0.05),
                    scale=0.34 if detail and book_proto is encyclopedia else (0.36 if detail else 0.28),
                    anchor="center",
                    decimate=0.32 if not detail else 0.38,
                )

    instance_asset(decorative, "desk_scattered_real_books", -5.05, 0.84, -3.45, rot_y=0.08, scale=0.32 if detail else 0.24, anchor="center", decimate=0.35 if not detail else 0.45)
    if detail:
        instance_asset(encyclopedia, "red_light_reference_books", 5.15, 0.62, 3.65, rot_y=math.pi / 2, scale=0.58, anchor="center", decimate=0.42)

    instance_asset(gate, "library_intro_gate_visual", -0.8, 0, 0.45, rot_y=0, scale=0.88 if detail else 0.76, decimate=0.78 if detail else 0.45)
    instance_asset(gate, "library_exit_gate_visual", 0.0, 0, 7.35, rot_y=0, scale=0.92 if detail else 0.72, decimate=0.72 if detail else 0.42)
    instance_asset(tool_cart, "medical_tool_cart_anomaly", -1.15, 0, 5.65, rot_y=-0.35, scale=0.82, decimate=0.7 if detail else 0.4)
    instance_asset(bed, "old_medical_bed_frame_intrusion", -4.45, 0, 2.75, rot_y=0.08, scale=0.82, decimate=0.55 if detail else 0.32)
    add_cylinder("red_glow_over_tool_cart", -1.15, 1.72, 5.65, 0.2, 0.025, mats["lamp_red"], vertices=18 if detail else 12)
    add_cylinder("red_glow_over_bed_frame", -4.45, 1.82, 2.75, 0.24, 0.025, mats["lamp_red"], vertices=18 if detail else 12)
    chandelier_positions = [(-5.0, -4.5), (0.95, -4.55), (4.25, -4.55), (2.0, 3.35), (5.15, 5.95)]
    for idx, (x, z) in enumerate(chandelier_positions):
        instance_asset(
            chandelier,
            f"wrong_chinese_chandelier_{idx}",
            x,
            3.35,
            z,
            rot_y=0.35 + idx * 0.19,
            scale=0.78 if detail else 0.58,
            anchor="center",
            decimate=0.58 if detail else 0.35,
        )
        add_cylinder(f"red_glow_under_chandelier_{idx}", x, 3.05, z, 0.22, 0.025, mats["lamp_red"], vertices=18 if detail else 12)
        add_point_light(f"red_chandelier_light_{idx}", x, 2.82, z, 0xff2a21, 0.36 if detail else 0.2, 2.4)
    instance_asset(clock, "wall_clock_stopped_0047", -6.55, 2.1, 3.8, rot_y=math.pi / 2, scale=1.45 if detail else 1.0, anchor="center", decimate=0.9)
    instance_asset(torch, "pickup_flashlight_visual", FLASHLIGHT_SPOTS[0]["x"], FLASHLIGHT_SPOTS[0]["y"], FLASHLIGHT_SPOTS[0]["z"], rot_y=0.65, scale=0.95 if detail else 0.7, anchor="center", decimate=0.7 if detail else 0.4)

    add_floor_decal("red_light_bleed_on_floor_library_sound", 5.0, 3.35, 1.55, 1.05, mats["red"], rot_y=-0.1)
    add_floor_decal("damp_runner_to_records", -0.85, 1.35, 1.25, 2.25, mats["stain"])
    add_floor_decal("thin_dust_path_to_sound", 1.75, 2.25, 5.25, 0.85, mats["dust"])
    for i in range(18 if detail else 9):
        add_floor_decal(
            f"loose_paper_{i:02d}",
            rng.uniform(-5.6, 5.2),
            rng.uniform(-6.8, 6.9),
            rng.uniform(0.18, 0.42),
            rng.uniform(0.12, 0.28),
            mats["paper"],
            rot_y=rng.uniform(-math.pi, math.pi),
        )

    max_texture = 560 if detail else 280
    normalize_loaded_images(max_texture)
    return collect_scene_stats()


def collect_scene_stats() -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh_count = 0
    tris = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        mesh_count += 1
        eval_obj = obj.evaluated_get(depsgraph)
        mesh = eval_obj.to_mesh()
        tris += sum(max(0, len(poly.vertices) - 2) for poly in mesh.polygons)
        eval_obj.to_mesh_clear()
    return {
        "meshCount": mesh_count,
        "triangles": tris,
        "materials": len([m for m in bpy.data.materials if m.users]),
        "images": len([i for i in bpy.data.images if i.users]),
    }


def export_scene(path: Path) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_lights=True,
        export_image_format="JPEG",
        export_jpeg_quality=68,
        export_copyright="Generated from user-provided local 3D_Assets via Blender.",
    )


def write_meta(desktop_stats: dict, lod_stats: dict) -> None:
    meta = {
        "assetVersion": 3,
        "buildingId": "medical-library",
        "roomKind": "library",
        "model": "scene.glb",
        "lodModel": "scene.lod.glb",
        "units": "meters",
        "qualityProfile": "medium-high-real-assets",
        "sourceAssets": [
            "WoodenTable_03_2k",
            "modern_arm_chair_01_2k",
            "wooden_bookshelf_worn_1k",
            "decorative_book_set_01_2k",
            "book_encyclopedia_set_01_2k",
            "large_iron_gate_1k",
            "peeling_painted_wall_1k",
            "tool_cart_2k",
            "old_bed_frame_2k",
            "wall_clock_1k",
            "chinese_chandelier_2k",
            "small_plastic_torch_2k",
            "diagonal_parquet_2k",
        ],
        "assetStats": {
            "desktop": {**desktop_stats, "bytes": (OUT_DIR / "scene.glb").stat().st_size},
            "lod": {**lod_stats, "bytes": (OUT_DIR / "scene.lod.glb").stat().st_size},
        },
        "spawn": {"x": -3.85, "y": 1.6, "z": -2.35, "yaw": -0.96},
        "bounds": {"minX": -6.45, "maxX": 6.45, "minZ": -8.7, "maxZ": 8.7},
        "redLights": [
            {"x": 5.0, "y": 1.35, "z": 3.35, "color": 11145233, "intensity": 3.8, "distance": 7.0}
        ],
        "pickupVisuals": {"flashlight": ["pickup_flashlight_visual"]},
        "pickupSpots": {"flashlight": FLASHLIGHT_SPOTS},
        "flickerLights": [
            {"name": "flashlight_red_guide", "followPickupId": "flashlight", "y": 0.9, "color": 16718353, "intensity": 1.35, "distance": 3.2, "speed": 3.1, "phase": 0.4},
            {"name": "tool_cart_red_flicker", "x": -1.15, "y": 1.55, "z": 5.65, "color": 16718353, "intensity": 1.8, "distance": 4.2, "speed": 4.2, "phase": 1.8},
            {"name": "bed_frame_red_flicker", "x": -4.45, "y": 1.72, "z": 2.75, "color": 16718353, "intensity": 1.9, "distance": 4.4, "speed": 3.7, "phase": 2.6}
        ],
        "phaseVisuals": [
            {"names": ["library_intro_gate_visual"], "activeSceneIds": ["library_intro"]}
        ],
        "storySpots": {
            "library_intro": {"x": 2.25, "y": 0.7, "z": -2.05, "radius": 0.85},
            "library_sound": {"x": 5.0, "y": 0.7, "z": 3.35, "radius": 1.2},
            "library_exit": {"x": 0.0, "y": 0.7, "z": 7.84, "radius": 1.2},
        },
        "notes": [
            "Static visuals use real local Blender assets and PBR textures from 3D_Assets.",
            "Gameplay colliders, story triggers, NPC reveal, and fallback remain authoritative in TypeScript.",
            "ATISS/AnyHome/Text2Room/Holodeck are reference-only and not production asset dependencies.",
        ],
    }
    (OUT_DIR / "scene.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main() -> None:
    desktop_stats = build_real_asset_scene(detail=1)
    export_scene(OUT_DIR / "scene.glb")
    lod_stats = build_real_asset_scene(detail=0)
    export_scene(OUT_DIR / "scene.lod.glb")
    write_meta(desktop_stats, lod_stats)
    print(
        "medical-library real-asset exports complete:",
        json.dumps({"desktop": desktop_stats, "lod": lod_stats}, ensure_ascii=False),
    )


if __name__ == "__main__":
    main()
