from __future__ import annotations

import bpy
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "3D_Assets" / "相框.blend"
OUTPUT = ROOT / "public" / "models" / "interiors" / "baisha" / "baisha-dorm-props.glb"


def remove_photo_texture() -> None:
    material = bpy.data.materials.get("Frame_Photo")
    if not material:
        raise RuntimeError("相框中缺少 Frame_Photo 材质")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    for node in list(nodes):
        if node.type == "TEX_IMAGE":
            nodes.remove(node)
    principled = nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = (0.035, 0.025, 0.022, 1.0)
        principled.inputs["Roughness"].default_value = 0.62
        principled.inputs["Metallic"].default_value = 0.0


def build_runtime_prop() -> bpy.types.Object:
    frame_parts = [bpy.data.objects.get("Frame"), bpy.data.objects.get("Frame_Foot")]
    if any(part is None for part in frame_parts):
        raise RuntimeError("相框源文件缺少 Frame 或 Frame_Foot")
    for obj in bpy.context.scene.objects:
        obj.select_set(False)

    root = bpy.data.objects.new("baisha_photo_frame", None)
    bpy.context.collection.objects.link(root)
    root.location = (31.58, 6.22, 0.99)
    # The source faces away from the playable side of desk 2. Rotate the
    # authored prop at export time so its photo face points into the room.
    root.rotation_euler[2] = math.pi
    root.scale = (0.18, 0.18, 0.18)
    for part in frame_parts:
        part.parent = root
        part.select_set(True)
    root.select_set(True)
    return root


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    remove_photo_texture()
    # Persist the user's requested texture removal in the authored source.
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))

    root = build_runtime_prop()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    print(f"BAISHA_DORM_PROPS_OK output={OUTPUT}")


if __name__ == "__main__":
    main()
