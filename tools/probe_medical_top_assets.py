"""Print object names and world bounds for the medical top source rooms."""

from pathlib import Path
import bpy


ROOT = Path(__file__).resolve().parents[1]


def world_bounds(obj):
    points = [obj.matrix_world @ __import__("mathutils").Vector(corner) for corner in obj.bound_box]
    mins = [min(point[index] for point in points) for index in range(3)]
    maxs = [max(point[index] for point in points) for index in range(3)]
    return tuple(round(maxs[index] - mins[index], 3) for index in range(3)), tuple(
        round((maxs[index] + mins[index]) * 0.5, 3) for index in range(3)
    )


for filename in ("601.blend", "603.blend", "605.blend"):
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / "3D_Assets" / filename))
    print(f"\nROOM {filename}")
    rows = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        size, center = world_bounds(obj)
        volume = size[0] * size[1] * size[2]
        rows.append((volume, obj.name, size, center))
    for volume, name, size, center in sorted(rows, reverse=True):
        print(f"{name!r} size={size} center={center} volume={volume:.3f}")
