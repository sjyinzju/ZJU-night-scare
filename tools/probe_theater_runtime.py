"""Print large horizontal surfaces and scene bounds from the authored theater GLB."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((min(point.x for point in corners), min(point.y for point in corners), min(point.z for point in corners))),
        Vector((max(point.x for point in corners), max(point.y for point in corners), max(point.z for point in corners))),
    )


def main() -> None:
    glb = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    all_bounds = [world_bounds(obj) for obj in meshes]
    low = Vector(tuple(min(bounds[0][axis] for bounds in all_bounds) for axis in range(3)))
    high = Vector(tuple(max(bounds[1][axis] for bounds in all_bounds) for axis in range(3)))
    print(f"SCENE blender_min={tuple(round(v, 3) for v in low)} blender_max={tuple(round(v, 3) for v in high)}")
    print(f"SCENE runtime_min=({low.x:.3f}, {low.z:.3f}, {-high.y:.3f}) runtime_max=({high.x:.3f}, {high.z:.3f}, {-low.y:.3f})")

    candidates: list[tuple[float, bpy.types.Object, Vector, Vector]] = []
    for obj in meshes:
        obj_low, obj_high = world_bounds(obj)
        dims = obj_high - obj_low
        area = dims.x * dims.y
        if area >= 2.0 and dims.z <= 0.45:
            candidates.append((area, obj, obj_low, obj_high))

    for area, obj, obj_low, obj_high in sorted(candidates, key=lambda item: item[0], reverse=True)[:80]:
        print(
            f"SURFACE {obj.name!r} area={area:.2f} "
            f"runtime_x=({obj_low.x:.3f},{obj_high.x:.3f}) "
            f"runtime_y=({obj_low.z:.3f},{obj_high.z:.3f}) "
            f"runtime_z=({-obj_high.y:.3f},{-obj_low.y:.3f})"
        )

    print("FOYER_SURFACES")
    foyer_candidates: list[tuple[float, bpy.types.Object, Vector, Vector]] = []
    for obj in meshes:
        obj_low, obj_high = world_bounds(obj)
        dims = obj_high - obj_low
        runtime_min_z = -obj_high.y
        runtime_max_z = -obj_low.y
        area = dims.x * dims.y
        if runtime_min_z < -13.5 and dims.z <= 0.6 and area >= 0.12:
            foyer_candidates.append((area, obj, obj_low, obj_high))
    for area, obj, obj_low, obj_high in sorted(foyer_candidates, key=lambda item: item[0], reverse=True)[:120]:
        print(
            f"FOYER {obj.name!r} area={area:.2f} "
            f"runtime_x=({obj_low.x:.3f},{obj_high.x:.3f}) "
            f"runtime_y=({obj_low.z:.3f},{obj_high.z:.3f}) "
            f"runtime_z=({-obj_high.y:.3f},{-obj_low.y:.3f})"
        )

    print("DOOR_REGION")
    for obj in meshes:
        obj_low, obj_high = world_bounds(obj)
        runtime_min_z = -obj_high.y
        runtime_max_z = -obj_low.y
        if (
            obj_high.x >= 12.6 and obj_low.x <= 17.4
            and runtime_max_z >= -14.25 and runtime_min_z <= -13.25
            and obj_high.z >= 1.45
        ):
            print(
                f"DOOR {obj.name!r} parent={obj.parent.name if obj.parent else '-'} "
                f"runtime_x=({obj_low.x:.3f},{obj_high.x:.3f}) "
                f"runtime_y=({obj_low.z:.3f},{obj_high.z:.3f}) "
                f"runtime_z=({runtime_min_z:.3f},{runtime_max_z:.3f})"
            )

    chair_rows: dict[float, list[tuple[bpy.types.Object, Vector, Vector]]] = {}
    for obj in meshes:
        obj_low, obj_high = world_bounds(obj)
        runtime_min_z = -obj_high.y
        runtime_max_z = -obj_low.y
        dims = obj_high - obj_low
        runtime_y_min = obj_low.z
        runtime_y_max = obj_high.z
        center_z = (runtime_min_z + runtime_max_z) * 0.5
        if (
            7.8 <= obj_low.x <= 22.8 and obj_high.x <= 23.0
            and -13.4 <= center_z <= 1.8
            and runtime_y_min >= -0.2 and runtime_y_max <= 2.8
            and 0.15 <= dims.x <= 1.4 and 0.15 <= dims.y <= 1.6 and 0.2 <= dims.z <= 1.8
        ):
            row = round(center_z, 1)
            chair_rows.setdefault(row, []).append((obj, obj_low, obj_high))
    print("CHAIR_ROWS")
    for row, objects in sorted(chair_rows.items()):
        names = ",".join(obj.name for obj, _low, _high in objects[:8])
        min_x = min(low.x for _obj, low, _high in objects)
        max_x = max(high.x for _obj, _low, high in objects)
        print(f"CHAIRS z={row:.1f} count={len(objects)} x=({min_x:.3f},{max_x:.3f}) names={names}")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    for runtime_x, runtime_z in [
        (15.0, -21.2),
        (10.0, -20.5),
        (15.0, -16.0),
        (15.0, -15.2),
        (15.0, -14.5),
        (15.0, -13.0),
        (15.0, -12.5),
        (15.0, -6.1),
        (15.0, 0.0),
        (24.0, -3.2),
        (24.0, 3.15),
    ]:
        origin = Vector((runtime_x, -runtime_z, 9.0))
        heights: list[tuple[float, str]] = []
        for _ in range(24):
            hit, location, _normal, _index, obj, _matrix = bpy.context.scene.ray_cast(
                depsgraph, origin, Vector((0.0, 0.0, -1.0)), distance=20.0
            )
            if not hit:
                break
            heights.append((location.z, obj.name if obj else "?"))
            origin.z = location.z - 0.002
        print(
            f"RAY runtime=({runtime_x:.2f},{runtime_z:.2f}) "
            + " hits="
            + ",".join(f"{height:.3f}:{name}" for height, name in heights)
        )


if __name__ == "__main__":
    main()
