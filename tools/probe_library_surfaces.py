from __future__ import annotations

import bpy
from pathlib import Path
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "public" / "models" / "interiors" / "library" / "library.glb"
TARGETS = {
    "notebook_table": (7.05, -4.5038),
    "flashlight_spawn_table_a": (9.45, -8.35),
    "flashlight_spawn_table_b": (9.45, -9.25),
    "flashlight_spawn_table_c": (9.45, -10.15),
    "receipt_cubicle": (-3.62, -10.63),
    "talisman_outer_table": (-4.88, -8.18),
}


def bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))),
        Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points))),
    )


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(LIBRARY))

for label, (x, y) in TARGETS.items():
    hits = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        lo, hi = bounds(obj)
        if lo.x - 0.08 <= x <= hi.x + 0.08 and lo.y - 0.08 <= y <= hi.y + 0.08:
            hits.append((hi.z, lo.z, obj.name, tuple(round(v, 4) for v in obj.dimensions)))
    hits.sort(reverse=True)
    print(f"PROBE {label} xy=({x:.4f},{y:.4f})")
    for top, bottom, name, dims in hits[:12]:
        print(f"  top={top:.4f} bottom={bottom:.4f} name={name!r} dims={dims}")

print("BLEND_VERSIONS")
for asset in [
    ROOT / "3D_Assets" / "small_plastic_torch_2k.blend" / "small_plastic_torch_2k.blend",
    ROOT / "3D_Assets" / "笔记本（用于第一个剧情点）" / "binder_notebook_2k.blend",
    ROOT / "3D_Assets" / "便签（用于借阅小票）" / "office_notepads_2k.blend",
]:
    with asset.open("rb") as stream:
        header = stream.read(12)
    print(f"  {asset.name}: header={header!r} bytes={asset.stat().st_size}")

print("SCENE01_PROP_BOUNDS")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(
    filepath=str(ROOT / "public" / "models" / "interiors" / "library" / "library-scene01-props.glb")
)
for root_name in [
    "pickup_flashlight_visual",
    "story_notebook_visual",
    "pickup_receipt_visual",
    "pickup_talisman_visual",
    "library_exit_door",
]:
    root = bpy.data.objects.get(root_name)
    if root is None:
        print(f"  {root_name}: MISSING")
        continue
    meshes = [obj for obj in [root, *root.children_recursive] if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (lo + hi) * 0.5
    print(
        f"  {root_name}: center={tuple(round(v, 4) for v in center)} "
        f"size={tuple(round(v, 4) for v in (hi - lo))}"
    )
