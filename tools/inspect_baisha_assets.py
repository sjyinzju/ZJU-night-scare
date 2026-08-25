from __future__ import annotations

import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]


def inspect_scene(label: str) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    for obj in bpy.context.scene.objects:
        if obj.type not in {"MESH", "EMPTY", "LIGHT", "CAMERA"}:
            continue
        corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box] if obj.type == "MESH" else []
        rows.append({
            "name": obj.name,
            "parent": obj.parent.name if obj.parent else None,
            "type": obj.type,
            "location": [round(value, 4) for value in obj.matrix_world.translation],
            "dimensions": [round(value, 4) for value in obj.dimensions],
            "bboxMin": [round(min(value[index] for value in corners), 4) for index in range(3)] if corners else None,
            "bboxMax": [round(max(value[index] for value in corners), 4) for index in range(3)] if corners else None,
            "materials": [slot.material.name if slot.material else "" for slot in obj.material_slots],
        })
    return {
        "label": label,
        "objects": rows,
        "materials": [{
            "name": material.name,
            "useNodes": material.use_nodes,
            "images": sorted({
                node.image.name
                for node in material.node_tree.nodes
                if material.use_nodes and node.type == "TEX_IMAGE" and node.image
            }),
        } for material in bpy.data.materials],
        "images": [{"name": image.name, "filepath": image.filepath} for image in bpy.data.images],
    }


def main() -> None:
    target = sys.argv[sys.argv.index("--") + 1]
    output = Path(sys.argv[sys.argv.index("--") + 2]).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = Path(target).resolve()
    if source.suffix.lower() == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(source))
    else:
        bpy.ops.import_scene.gltf(filepath=str(source))
    bpy.context.view_layer.update()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(inspect_scene(source.name), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote inspection to {output}")


if __name__ == "__main__":
    main()
