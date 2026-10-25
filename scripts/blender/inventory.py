"""List every object in the Z-Anatomy template with its evaluated geometry size, world bounds and collections.
Run with Blender in background mode, with scripts embedded in the .blend disabled:
  blender -b -Y Startup.blend --python-exit-code 1 --python scripts/blender/inventory.py -- inventory.json
"""
import bpy, sys, json, re
import numpy as np

out = sys.argv[sys.argv.index('--') + 1]
scene = bpy.context.scene
# Evaluate objects in collections that are excluded or hidden too.
def include_all(layer_collection):
    layer_collection.exclude = False
    layer_collection.hide_viewport = False
    for child in layer_collection.children:
        include_all(child)
include_all(bpy.context.view_layer.layer_collection)
for ob in bpy.data.objects:
    ob.hide_viewport = False
    ob.hide_set(False)
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()

primary = {}
for coll in bpy.data.collections:
    m = re.match(r'^(\d): (.+)$', coll.name)
    if m:
        for ob in coll.all_objects:
            primary.setdefault(ob.name, coll.name)

def color_of(ob):
    for slot in ob.material_slots:
        mat = slot.material
        if not mat:
            continue
        if mat.use_nodes and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED':
                    c = node.inputs['Base Color'].default_value
                    return [round(c[0], 4), round(c[1], 4), round(c[2], 4)], mat.name
        c = mat.diffuse_color
        return [round(c[0], 4), round(c[1], 4), round(c[2], 4)], mat.name
    return None, None

records = []
for ob in bpy.data.objects:
    rec = {'name': ob.name, 'type': ob.type, 'primary': primary.get(ob.name),
           'collections': [c.name for c in ob.users_collection], 'parent': ob.parent.name if ob.parent else None,
           'modifiers': [m.type for m in getattr(ob, 'modifiers', [])], 'data': ob.data.name if ob.data else None}
    rec['color'], rec['material'] = color_of(ob)
    if ob.type in ('MESH', 'CURVE'):
        ev = ob.evaluated_get(depsgraph)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            me = None
        if me is not None:
            n = len(me.vertices)
            rec['verts'] = n
            me.calc_loop_triangles()
            rec['tris'] = len(me.loop_triangles)
            if n:
                co = np.empty(n * 3, dtype=np.float64)
                me.vertices.foreach_get('co', co)
                co = co.reshape(-1, 3)
                mw = np.array(ev.matrix_world)
                world = co @ mw[:3, :3].T + mw[:3, 3]
                rec['bounds'] = [world.min(0).round(5).tolist(), world.max(0).round(5).tolist()]
            ev.to_mesh_clear()
        if ob.type == 'CURVE':
            rec['bevel'] = round(ob.data.bevel_depth, 5)
    records.append(rec)

with open(out, 'w', encoding='utf8') as f:
    json.dump({'blender': bpy.app.version_string, 'file': bpy.data.filepath, 'unit_scale': scene.unit_settings.scale_length,
               'objects': records}, f, ensure_ascii=False)
print(f'INVENTORY {len(records)} objects written to {out}')
