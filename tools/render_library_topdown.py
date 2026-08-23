import bpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "models" / "interiors" / "library" / "library.glb"
PROPS = ROOT / "public" / "models" / "interiors" / "library" / "library-scene01-props.glb"
OUT = ROOT / "tmp" / "library-scene01-diagnostic-topdown.png"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
bpy.ops.import_scene.gltf(filepath=str(PROPS))

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "BOTH"
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUT)

# Put the camera below the authored ceiling, so the diagnostic render shows
# the desks/props instead of the roof shell.
bpy.ops.object.camera_add(location=(3.0, -7.5, 2.55))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = 20.0
camera.rotation_euler = (0.0, 0.0, 0.0)
camera.rotation_euler[0] = 0.0
camera.rotation_euler[1] = 0.0
camera.rotation_euler[2] = 0.0
# Camera looks down local -Z by default.
scene.camera = camera

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"Rendered {OUT}")
