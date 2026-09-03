"""Build the lightweight runtime props used by the medical garage sequence.

Run with:
  D:\blender.exe --background --python tools/build_medical_garage_gameplay.py

The source Ghost.blend references textures from the original asset author's
machine and the candle OBJ ships without its MTL.  Runtime materials are
therefore deliberately re-authored here instead of relying on missing files.
"""

from pathlib import Path
import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "3D_Assets"
OUTPUT = ROOT / "public" / "models" / "interiors" / "medical-school" / "medical-garage-props.glb"
SCARE_OUTPUT = ROOT / "public" / "images" / "jumpscares" / "medical-garage-ghost.png"


def material(name, color, roughness=0.85, metallic=0.0, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def assign(obj, mat):
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def parent_keep_world(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


bpy.ops.wm.read_factory_settings(use_empty=True)

ghost_root = bpy.data.objects.new("medical_garage_ghost", None)
bpy.context.collection.objects.link(ghost_root)

with bpy.data.libraries.load(str(ASSETS / "Ghost.blend"), link=False) as (source, target):
    target.objects = [name for name in source.objects if name in {"Ghost", "Web"}]

ghost_objects = [obj for obj in target.objects if obj is not None]
for obj in ghost_objects:
    bpy.context.collection.objects.link(obj)
    parent_keep_world(obj, ghost_root)

if not ghost_objects:
    raise RuntimeError("Ghost.blend did not contain Ghost/Web mesh objects")

ghost_box_min = Vector((1e9, 1e9, 1e9))
ghost_box_max = Vector((-1e9, -1e9, -1e9))
for obj in ghost_objects:
    for corner in obj.bound_box:
        point = obj.matrix_world @ Vector(corner)
        ghost_box_min.x = min(ghost_box_min.x, point.x)
        ghost_box_min.y = min(ghost_box_min.y, point.y)
        ghost_box_min.z = min(ghost_box_min.z, point.z)
        ghost_box_max.x = max(ghost_box_max.x, point.x)
        ghost_box_max.y = max(ghost_box_max.y, point.y)
        ghost_box_max.z = max(ghost_box_max.z, point.z)

ghost_height = max(0.001, ghost_box_max.z - ghost_box_min.z)
ghost_scale = 1.92 / ghost_height
ghost_root.scale = (ghost_scale, ghost_scale, ghost_scale)
ghost_root.location.z = -ghost_box_min.z * ghost_scale

cloth = material("garage_ghost_dirty_gauze", (0.105, 0.11, 0.115), roughness=0.98)
web = material("garage_ghost_web", (0.22, 0.23, 0.24), roughness=1.0)
for obj in ghost_objects:
    assign(obj, web if obj.name.startswith("Web") else cloth)

# The source eye sockets were texture-only.  Rebuild them as geometry so the
# red internal light can reliably read through the face on every GPU.
black = material("garage_ghost_eye_void", (0.002, 0.002, 0.002), roughness=1.0)
red = material("garage_ghost_eye_red", (0.08, 0.0, 0.0), roughness=0.55,
               emission=(1.0, 0.0, 0.01), emission_strength=5.5)
for side, x in (("left", -0.095), ("right", 0.095)):
    # These are local to the normalized ghost root.  Its vertical translation
    # brings z=0.50 to roughly eye height (1.43 m) in the exported model.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, location=(x, 0.43, 0.50))
    socket = bpy.context.object
    socket.name = f"medical_garage_ghost_eye_void_{side}"
    socket.scale = (0.052, 0.018, 0.074)
    assign(socket, black)
    socket.parent = ghost_root

    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=(x, 0.45, 0.50))
    pupil = bpy.context.object
    pupil.name = f"medical_garage_ghost_eye_glow_{side}"
    pupil.scale = (0.016, 0.009, 0.024)
    assign(pupil, red)
    pupil.parent = ghost_root


candle_root = bpy.data.objects.new("medical_garage_candle", None)
bpy.context.collection.objects.link(candle_root)
before = set(bpy.data.objects)
bpy.ops.wm.obj_import(filepath=str(ASSETS / "woskowa+świeca.obj"))
candle_objects = [obj for obj in bpy.data.objects if obj not in before]
if not candle_objects:
    raise RuntimeError("Candle OBJ did not produce any objects")

candle_min = Vector((1e9, 1e9, 1e9))
candle_max = Vector((-1e9, -1e9, -1e9))
for obj in candle_objects:
    for corner in obj.bound_box:
        point = obj.matrix_world @ Vector(corner)
        candle_min.x = min(candle_min.x, point.x)
        candle_min.y = min(candle_min.y, point.y)
        candle_min.z = min(candle_min.z, point.z)
        candle_max.x = max(candle_max.x, point.x)
        candle_max.y = max(candle_max.y, point.y)
        candle_max.z = max(candle_max.z, point.z)

candle_height = max(0.001, candle_max.z - candle_min.z)
candle_scale = 0.22 / candle_height
candle_center = (candle_min + candle_max) * 0.5
wax = material("garage_candle_wax", (0.23, 0.035, 0.025), roughness=0.92)
for obj in candle_objects:
    assign(obj, wax)
    parent_keep_world(obj, candle_root)
candle_root.scale = (candle_scale, candle_scale, candle_scale)
candle_root.location = (-candle_center.x * candle_scale, -candle_center.y * candle_scale, -candle_min.z * candle_scale)

# Reconstructed wick and flame remain tiny and emissive; the soft red spill is
# supplied by one cheap non-shadow-casting Three.js point light at runtime.
wick = material("garage_candle_wick", (0.01, 0.006, 0.004), roughness=1.0)
bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.006, depth=0.055, location=(0, 0, 0.236))
wick_obj = bpy.context.object
wick_obj.name = "medical_garage_candle_wick"
assign(wick_obj, wick)
wick_obj.parent = candle_root

flame = material("garage_candle_flame", (0.38, 0.005, 0.0), roughness=0.35,
                 emission=(1.0, 0.015, 0.0), emission_strength=7.0)
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=(0, 0, 0.29))
flame_obj = bpy.context.object
flame_obj.name = "medical_garage_candle_flame"
flame_obj.scale = (0.025, 0.025, 0.065)
assign(flame_obj, flame)
flame_obj.parent = candle_root

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.context.view_layer.objects.active = ghost_root
for obj in bpy.context.scene.objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
print(f"Wrote {OUTPUT}")

# Also render the same authored ghost for the unified jumpscare pipeline.  The
# PNG is warmed with all other scare sprites before gameplay begins.
candle_root.hide_render = True
for obj in bpy.data.objects:
    if obj.name.startswith("medical_garage_ghost_eye_"):
        obj.hide_render = True
bpy.ops.object.camera_add(location=(0, 2.65, 1.12))
camera = bpy.context.object
camera.name = "medical_garage_jumpscare_camera"
camera.data.lens = 54
camera.rotation_euler = ((Vector((0, 0, 1.05)) - camera.location).to_track_quat("-Z", "Y")).to_euler()
bpy.context.scene.camera = camera

# The exported pupils inherit the scaled ghost root and sit correctly in the
# runtime model, but that hierarchy makes their tiny depth easy to lose in the
# square orthographic-like scare render.  Add camera-facing render-only sockets
# after export so the preloaded jumpscare sprite always has a readable face.
for side, x in (("left", -0.085), ("right", 0.085)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(x, 0.64, 1.46))
    render_socket = bpy.context.object
    render_socket.name = f"medical_garage_jumpscare_eye_void_{side}"
    render_socket.scale = (0.035, 0.012, 0.076)
    assign(render_socket, black)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, location=(x, 0.67, 1.46))
    render_pupil = bpy.context.object
    render_pupil.name = f"medical_garage_jumpscare_eye_glow_{side}"
    render_pupil.scale = (0.008, 0.007, 0.016)
    assign(render_pupil, red)

bpy.ops.object.light_add(type="AREA", location=(-0.7, 1.45, 1.65))
key = bpy.context.object
key.data.energy = 105
key.data.color = (0.38, 0.42, 0.48)
key.data.shape = "DISK"
key.data.size = 2.1
key.rotation_euler = ((Vector((0, 0, 1.0)) - key.location).to_track_quat("-Z", "Y")).to_euler()
bpy.ops.object.light_add(type="POINT", location=(0, 0.05, 1.38))
inside = bpy.context.object
inside.data.energy = 85
inside.data.color = (1.0, 0.0, 0.015)
inside.data.shadow_soft_size = 0.18

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.render.filepath = str(SCARE_OUTPUT)
scene.view_settings.look = "AgX - Medium High Contrast"
SCARE_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"Wrote {SCARE_OUTPUT}")
