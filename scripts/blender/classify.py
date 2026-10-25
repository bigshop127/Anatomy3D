"""Sort the Z-Anatomy structures into 'already in the app' and 'missing', after warping them onto the app's bones.
  blender -b -Y work/zanatomy/source/Startup.blend --python-exit-code 1 --python scripts/blender/classify.py -- work/atlas-raw work/zanatomy
Writes work/zanatomy/candidates.json with each structure's warped bounds. A structure counts as already present when most of it
lies on app parts of the same kind that in turn lie on it (two-way coverage within 3 mm); everything else is a candidate to add.
scripts/zanatomy-select.mjs makes the final choice, by name first.
"""
import sys, os, re, json
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(__file__))
import zanatomy_lib as z

raw_dir, work = sys.argv[sys.argv.index('--') + 1:][:2]
depsgraph = z.include_everything()
app = z.AppAtlas(raw_dir)
warp = z.Warp.load(work + '/warp.npy')
paths = z.collection_paths()
bone_names = {ob.name for ob, p in z.bone_pairs(app)}
NEAR, SAMPLES = 0.003, 160


def kind_of(ob, prim, trail):
    """Which app system a Z-Anatomy object would join, or None when it is out of scope."""
    name = ob.name.lower()
    if prim == '2: Muscular insertions':
        return 'attachment'
    if prim == '1: Skeletal system':
        return None if ob.name in bone_names or 'sinus of' in name or 'cells of ethmoid' in name else 'skeletal'
    if prim == '3: Joints':
        return 'connective'
    if prim == '4: Muscular system':
        if re.search(r'fascia|aponeurosis|bursa|sheath|retinacul|septum|tract|ligament|linea alba|tendinous arch|tendinous ring|raphe|trochlea|tarsus|calcaneal tendon|tendon of', name):
            return 'connective'
        return 'muscular'
    if prim == '7: Nervous system & Sense organs':
        # Peripheral nerves and the spinal cord. The brain (partly from other sources) and the sense organs (the inner ear is
        # non-commercial) stay out.
        if 'Sense organs' in trail or 'internal ear' in name or 'cochlea' in name:
            return None
        if 'Peripheral nervous system' in trail or re.search(r'spinal cord|cauda equina|conus medullaris|filum terminale|spinal dura|spinal nerve|denticulate', name):
            return 'nervous'
    return None


SAME = {'muscular': {'muscular'}, 'connective': {'connective', 'skeletal', 'muscular'}, 'skeletal': {'skeletal', 'connective'}, 'nervous': {'nervous'}}
app_bounds = np.array([p['bounds'] for p in app.parts])
app_samples = {}
def samples_of(p):
    s = app_samples.get(p['id'])
    if s is None:
        v, _ = app.mesh(p)
        s = app_samples[p['id']] = v[np.linspace(0, len(v) - 1, min(len(v), SAMPLES)).astype(int)]
    return s
def near_mask(bvh, pts):
    return np.array([bvh.find_nearest(Vector(pt), NEAR)[0] is not None for pt in pts])

out = []
for ob in sorted(bpy.data.objects, key=lambda o: o.name):
    if ob.type not in ('MESH', 'CURVE') or z.ANCHOR.search(ob.name):
        continue
    prim = z.primary_collection(ob)
    trail = paths.get(ob.name, [])
    kind = kind_of(ob, prim, trail)
    if kind is None:
        continue
    v, tri = z.evaluated(ob, depsgraph)
    if len(tri) < 4:
        continue
    rec = {'name': ob.name, 'kind': kind, 'primary': prim, 'verts': len(v), 'tris': len(tri),
           'groups': [t for t in trail if not re.match(r'^\d: ', t) and t not in ('Bonus collection', 'Scene Collection')][:8]}
    if kind != 'attachment':
        wv = warp(v)
        pts = wv[np.linspace(0, len(v) - 1, min(len(v), SAMPLES)).astype(int)]
        zbvh = BVHTree.FromPolygons([tuple(x) for x in wv], [tuple(int(k) for k in f) for f in tri])
        lo, hi = pts.min(0) - 0.006, pts.max(0) + 0.006
        hit_all, hit_counter, counterparts = np.zeros(len(pts), bool), np.zeros(len(pts), bool), []
        for p, b in zip(app.parts, app_bounds):
            if p['system'] not in SAME[kind] or np.any(b[0] > hi) or np.any(b[1] < lo):
                continue
            close = near_mask(app.bvh(p), pts)
            if not close.any():
                continue
            hit_all |= close
            back = float(near_mask(zbvh, samples_of(p)).mean())
            if back >= 0.3:
                hit_counter |= close
                counterparts.append([p['name'], round(float(close.mean()), 2), round(back, 2)])
        rec['bounds'] = [wv.min(0).round(4).tolist(), wv.max(0).round(4).tolist()]
        rec.update({'coverAll': round(float(hit_all.mean()), 2), 'coverCounterparts': round(float(hit_counter.mean()), 2),
                    'counterparts': sorted(counterparts, key=lambda c: -c[1])[:4]})
        rec['present'] = rec['coverCounterparts'] >= 0.6
    out.append(rec)
    if len(out) % 200 == 0:
        print('classified', len(out), flush=True)
json.dump(out, open(work + '/candidates.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print('CLASSIFY', len(out), 'objects;', sum(1 for r in out if r.get('present')), 'already in the app')
