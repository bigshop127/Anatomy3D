"""Export the Z-Anatomy structures and attachment patches listed in scripts/zanatomy-parts.json, warped onto the app's bones.
  blender -b -Y work/zanatomy/source/Startup.blend --python-exit-code 1 --python scripts/blender/export.py -- work/atlas-raw work/zanatomy scripts/zanatomy-parts.json
Writes work/zanatomy/export/{parts.json,geometry.bin} in the format of work/atlas-raw (float32 positions in the app frame and
uint32 triangles; parts.json lists the Z-Anatomy object name of each) for scripts/build-atlas.mjs --zanatomy, and
work/zanatomy/export/report.json: how much of each pushed-out structure lay more than 1 mm inside bone before and after.
Structures marked pushOut (ligaments, capsules, discs and the like) have vertices left inside bone by the warp moved back to
the bone surface. Fasciae are pushed out of the BodyParts3D muscles too, which Z-Anatomy's sheets would otherwise cut through,
since the two sets of muscles differ by a few millimetres. Attachment patches are drawn on the bone surface, so they are moved
onto it wherever they are within 4 mm.
"""
import sys, os, json, time
import numpy as np
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import zanatomy_lib as z

raw_dir, work, manifest_file = sys.argv[sys.argv.index('--') + 1:][:3]
out_dir = work + '/export'
os.makedirs(out_dir, exist_ok=True)
manifest = json.load(open(manifest_file, encoding='utf8'))
depsgraph = z.include_everything()
app = z.AppAtlas(raw_dir)
warp = z.Warp.load(work + '/warp.npy')
bones = z.BoneSurfaces(app)
muscles = z.BoneSurfaces(app, 'muscular')
INSIDE, SNAP, GAP, FASCIA_GAP = 0.001, 0.004, 0.0003, 0.0012


def inside_share(pts, items):
    d = bones.signed_distance(pts, items)
    return round(float((d < -INSIDE).mean()), 3)


def snap_to_bone(pts, items):
    """Moves each vertex within SNAP of a bone onto that bone's surface, GAP outside it."""
    moved = 0
    for n, pt in enumerate(pts):
        d, bvh, q = bones.nearest(pt, items, SNAP)
        if bvh is None or d < 1e-7:
            continue
        outward = (q - pt) / d if z.BoneSurfaces.inside(bvh, pt) else (pt - q) / d
        pts[n] = q + outward * GAP
        moved += 1
    return moved


records, blobs, report, offset, started = [], [], [], 0, time.time()
items = [(p, False) for p in manifest['parts']] + [(a, True) for a in manifest['attachments']]
for k, (item, patch) in enumerate(items):
    ob = bpy.data.objects[item['z']]
    v, tri = z.evaluated(ob, depsgraph)
    w = warp(v)
    near = bones.near(w.min(0), w.max(0), SNAP)
    if patch:
        snap_to_bone(w, near)
    elif item.get('pushOut'):
        before = inside_share(w, near)
        moved = bones.push_out(w, INSIDE, GAP, near)
        report.append({'z': item['z'], 'insideBefore': before, 'insideAfter': inside_share(w, near), 'moved': moved, 'vertices': len(w)})
    elif item.get('overMuscles') is not None:
        # A Z-Anatomy muscle that lies over BodyParts3D muscles (the latissimus dorsi): their bellies are a little fatter and
        # would poke through it, so it is pushed out of them, except those it really goes under.
        around = muscles.near_except(w.min(0), w.max(0), item['overMuscles'] or '$^', SNAP)
        share = lambda: round(sum(muscles.containing(pt, around, INSIDE) is not None for pt in w) / len(w), 3)
        before = share()
        moved = muscles.push_out_all(w, 0.0002, FASCIA_GAP, around) + bones.push_out(w, INSIDE, GAP, near)
        report.append({'z': item['z'], 'insideMusclesBefore': before, 'insideMusclesAfter': share(), 'moved': moved, 'vertices': len(w)})
    elif item['system'] == 'fascia':
        around = muscles.near(w.min(0), w.max(0), SNAP)
        share = lambda: round(sum(muscles.containing(pt, around, INSIDE) is not None for pt in w) / len(w), 3)
        before = share()
        moved = muscles.push_out_all(w, 0.0002, FASCIA_GAP, around) + bones.push_out(w, INSIDE, GAP, near)
        report.append({'z': item['z'], 'insideMusclesBefore': before, 'insideMusclesAfter': share(), 'moved': moved, 'vertices': len(w)})
    positions = w.astype(np.float32).tobytes()
    indices = tri.astype(np.uint32).tobytes()
    records.append({'z': item['z'], 'positions': offset, 'vertexCount': len(w), 'indices': offset + len(positions), 'indexCount': tri.size,
                    'bounds': [w.min(0).round(5).tolist(), w.max(0).round(5).tolist()]})
    blobs += [positions, indices]
    offset += len(positions) + len(indices)
    if (k + 1) % 100 == 0:
        print(f'exported {k + 1}/{len(items)} ({time.time() - started:.0f} s)', flush=True)

with open(out_dir + '/geometry.bin', 'wb') as f:
    for b in blobs:
        f.write(b)
json.dump({'parts': records}, open(out_dir + '/parts.json', 'w', encoding='utf8'), ensure_ascii=False)
json.dump(report, open(out_dir + '/report.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print(f'EXPORT {len(records)} objects ({offset / 1e6:.1f} MB) in {time.time() - started:.0f} s')
