"""Fit every Z-Anatomy bone to its BodyParts3D counterpart and save the bone-driven warp field.
  blender -b -Y work/zanatomy/source/Startup.blend --python-exit-code 1 --python scripts/blender/align.py -- work/atlas-raw work/zanatomy
Writes work/zanatomy/warp.npy (control points) and work/zanatomy/bones.json (per-bone fit report, and the Z-Anatomy bones
without a BodyParts3D counterpart).
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
import zanatomy_lib as z

raw_dir, out_dir = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(out_dir, exist_ok=True)
depsgraph = z.include_everything()
app = z.AppAtlas(raw_dir)
unmatched = []
pairs = z.bone_pairs(app, unmatched)
report = []
warp = z.Warp.build(pairs, app, depsgraph, report=report)
warp.save(out_dir + '/warp.npy')
json.dump({'pairs': len(pairs), 'controlPoints': len(warp.src), 'bones': report, 'unmatched': sorted(unmatched)},
          open(out_dir + '/bones.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'ALIGN {len(pairs)} bone pairs, {len(warp.src)} control points; {len(unmatched)} Z-Anatomy bones without a counterpart')
