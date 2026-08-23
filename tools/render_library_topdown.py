import bpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "models" / "interiors" / "library" / "library.glb"
OUT = ROOT / "tmp" / "library-topdown.png"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "BOTH"
scene.render.resolution_x = 1000
scene.render.resolution_y = 1600
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUT)

bpy.ops.object.camera_add(location=(5.0, -27.0, 80.0))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = 72.0
camera.rotation_euler = (0.0, 0.0, 0.0)
camera.rotation_euler[0] = 0.0
camera.rotation_euler[1] = 0.0
camera.rotation_euler[2] = 0.0
# Camera looks down local -Z by default.
scene.camera = camera

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"Rendered {OUT}")
