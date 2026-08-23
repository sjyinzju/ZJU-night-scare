import bpy
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "models" / "interiors" / "library" / "library.glb"
OUT = ROOT / "tmp" / "library-inspection.json"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
bpy.context.view_layer.update()

rows = []
for obj in bpy.context.scene.objects:
    if obj.type not in {"MESH", "EMPTY", "LIGHT", "CAMERA"}:
        continue
    corners = [obj.matrix_world @ Vector(obj.bound_box[i]) for i in range(8)] if obj.type == "MESH" else []
    rows.append({
        "name": obj.name,
        "parent": obj.parent.name if obj.parent else None,
        "type": obj.type,
        "location": [round(v, 4) for v in obj.matrix_world.translation],
        "dimensions": [round(v, 4) for v in obj.dimensions],
        "bboxMin": [round(min(v[i] for v in corners), 4) for i in range(3)] if corners else None,
        "bboxMax": [round(max(v[i] for v in corners), 4) for i in range(3)] if corners else None,
        "materials": [slot.material.name if slot.material else "" for slot in obj.material_slots],
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {len(rows)} objects to {OUT}")
