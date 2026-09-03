from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "public" / "models" / "interiors" / "medical-school" / "medical-basement-props.glb"


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MODEL))
    for root_name in ("medical_basement_owl_feathers", "medical_basement_notebook"):
        root = bpy.data.objects.get(root_name)
        if root is None:
            raise RuntimeError(f"Missing runtime prop root: {root_name}")
        points = [
            obj.matrix_world @ Vector(corner)
            for obj in root.children_recursive
            if obj.type == "MESH"
            for corner in obj.bound_box
        ]
        low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        print(
            "PROP_BOUNDS",
            root_name,
            tuple(round(value, 4) for value in low),
            tuple(round(value, 4) for value in high),
            tuple(round(value, 4) for value in high - low),
        )


if __name__ == "__main__":
    main()
