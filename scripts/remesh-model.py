"""Rebuilds a model at a triangle budget and bakes its look onto fresh UVs.

    blender -b --python scripts/remesh-model.py -- <in.glb> <out.glb> <triangles> [texture px]

Why this exists: an edge-collapse simplifier cannot get far with a model assembled from separate
closed shells - a pile of boulders, a lattice - because there are no shared edges to collapse, and
the sloppy simplifier that ignores topology smears the texture across the UV seams it does not know
about. Rebuilding the surface and then baking the original's colour onto a fresh unwrap is the way
to have both: the low-poly shape and the look it had.

The bake is Cycles' DIFFUSE colour pass only, so no light is baked in and the game lights it.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
source, target_path, budget = argv[0], argv[1], int(argv[2])
texture_size = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit(f'{source}: no meshes')

# One object to bake from: the bake is "selected to active", and several sources would need several
# passes into the same image.
bpy.ops.object.select_all(action='DESELECT')
for mesh in meshes:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
high = bpy.context.view_layer.objects.active
high.name = 'source'

faces = len(high.data.polygons)
print(f'source: {faces} faces')

bpy.ops.object.select_all(action='DESELECT')
high.select_set(True)
bpy.context.view_layer.objects.active = high
bpy.ops.object.duplicate()
low = bpy.context.view_layer.objects.active
low.name = 'remeshed'

# Collapse first - it keeps the shape honest - and only then ignore topology, which is what gets
# past the shells the collapse cannot touch.
decimate = low.modifiers.new('collapse', 'DECIMATE')
decimate.ratio = max(0.02, min(1.0, budget / max(1, faces)))
bpy.ops.object.modifier_apply(modifier=decimate.name)
print(f'after collapse: {len(low.data.polygons)} faces')

rebuilt = len(low.data.polygons) > budget * 1.2
if rebuilt:
    remesh = low.modifiers.new('remesh', 'REMESH')
    remesh.mode = 'VOXEL'
    size = max(low.dimensions)
    remesh.voxel_size = size / max(8.0, (budget ** 0.5) * 1.6)
    remesh.adaptivity = 0
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    again = low.modifiers.new('collapse2', 'DECIMATE')
    again.ratio = max(0.02, min(1.0, budget / max(1, len(low.data.polygons))))
    bpy.ops.object.modifier_apply(modifier=again.name)
    print(f'after remesh: {len(low.data.polygons)} faces')

# A collapse keeps the original UVs and with them the original texture, which is both sharper and
# smaller than anything baked; only a rebuilt surface has to be unwrapped and baked.
if not rebuilt:
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.data.objects.remove(high, do_unlink=True)
    bpy.ops.export_scene.gltf(filepath=target_path, export_format='GLB', use_selection=True)
    print(f'{target_path}: {len(low.data.polygons)} faces, original UVs kept')
    raise SystemExit(0)

# Fresh unwrap: the rebuilt surface has no UVs worth keeping.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
bpy.ops.object.mode_set(mode='OBJECT')

image = bpy.data.images.new('baked', texture_size, texture_size)
material = bpy.data.materials.new('baked')
material.use_nodes = True
nodes = material.node_tree.nodes
texture_node = nodes.new('ShaderNodeTexImage')
texture_node.image = image
texture_node.select = True
nodes.active = texture_node
principled = nodes['Principled BSDF']
material.node_tree.links.new(texture_node.outputs['Color'], principled.inputs['Base Color'])
principled.inputs['Roughness'].default_value = 0.95
low.data.materials.clear()
low.data.materials.append(material)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 4
scene.cycles.device = 'CPU'
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = max(low.dimensions) * 0.06
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
scene.render.bake.margin = 8

bpy.ops.object.select_all(action='DESELECT')
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='DIFFUSE')

image.pack()
bpy.data.objects.remove(high, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
low.select_set(True)
bpy.ops.export_scene.gltf(filepath=target_path, export_format='GLB', use_selection=True)
print(f'{target_path}: {len(low.data.polygons)} faces, {texture_size}px bake')
