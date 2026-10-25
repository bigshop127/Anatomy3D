"""Shared helpers for bringing Z-Anatomy structures into the app (run inside Blender's Python).

Z-Anatomy's skeleton is posed and proportioned differently from the BodyParts3D skeleton the app uses (up to about 3 cm at the
pelvis and hands), so its soft tissues cannot be copied across as they are. Each Z-Anatomy bone is matched to its BodyParts3D
counterpart, fitted rigidly, and the small remaining shape difference is taken from the nearest surface. Those bone surface
samples form a displacement field; warping a soft tissue moves each of its vertices with the inverse-distance blend of the
nearest samples, so ligaments and muscles follow the app's bones where they attach.
"""
import json, re, math
import numpy as np
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
DIGITS = {'hand': ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger'],
          'foot': ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe']}
# Label anchors and group handles in the template are tiny meshes named with these suffixes.
ANCHOR = re.compile(r'\.(j|i|g|t|s)\d*$')
SIDE = re.compile(r'\.(r|l)$')


def to_app(world):
    """Blender (metres, Z up, front -Y) to the app frame (metres, Y up, front +Z); patient's left stays +X."""
    return np.stack([world[:, 0], world[:, 2], -world[:, 1]], 1)


def evaluated(ob, depsgraph):
    """World-space triangles of an object after its modifiers (curves become their bevelled tubes)."""
    ev = ob.evaluated_get(depsgraph)
    me = ev.to_mesh()
    try:
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get('vertices', tri)
        mw = np.array(ev.matrix_world)
        world = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
        return to_app(world), tri.reshape(-1, 3)
    finally:
        ev.to_mesh_clear()


def include_everything():
    """Collections in the template are partly excluded or hidden; evaluate all of them."""
    def walk(layer):
        layer.exclude = False
        layer.hide_viewport = False
        for child in layer.children:
            walk(child)
    walk(bpy.context.view_layer.layer_collection)
    for ob in bpy.data.objects:
        ob.hide_viewport = False
    bpy.context.view_layer.update()
    return bpy.context.evaluated_depsgraph_get()


def primary_collection(ob):
    for coll in bpy.data.collections:
        if re.match(r'^\d: ', coll.name) and ob.name in coll.all_objects:
            return coll.name
    return None


def collection_paths():
    """Object name → every collection that contains it, directly or through child collections."""
    paths = {}
    def walk(coll, trail):
        trail = trail + [coll.name]
        for ob in coll.objects:
            paths.setdefault(ob.name, set()).update(trail)
        for child in coll.children:
            walk(child, trail)
    for coll in bpy.data.collections:
        walk(coll, [])
    return {k: sorted(v) for k, v in paths.items()}


class AppAtlas:
    """The app's BodyParts3D parts as dumped by scripts/dump-atlas-geometry.mjs (parts already taken from Z-Anatomy, whose
    ids start with Z, are left out)."""
    def __init__(self, raw_dir):
        self.parts = [p for p in json.load(open(raw_dir + '/parts.json', encoding='utf8'))['parts'] if not p['id'].startswith('Z')]
        self.blob = open(raw_dir + '/geometry.bin', 'rb').read()
        self.by_key = {app_key(p['name']): p for p in self.parts}
        self._bvh = {}

    def mesh(self, p):
        v = np.frombuffer(self.blob, dtype=np.float32, count=p['vertexCount'] * 3, offset=p['positions']).reshape(-1, 3).astype(np.float64)
        i = np.frombuffer(self.blob, dtype=np.uint32, count=p['indexCount'], offset=p['indices']).reshape(-1, 3)
        return v, i

    def bvh(self, p):
        b = self._bvh.get(p['id'])
        if b is None:
            v, i = self.mesh(p)
            b = BVHTree.FromPolygons([tuple(x) for x in v], [tuple(int(k) for k in f) for f in i])
            self._bvh[p['id']] = b
        return b


def app_key(name):
    """BodyParts3D name → (side, name without the side), lowercase. The side can sit anywhere ('Distal phalanx of left big toe')."""
    n = name.lower()
    m = re.search(r'\b(left|right)\b', n)
    return (m.group(1) if m else ''), re.sub(r'\s+', ' ', re.sub(r'\b(left|right) ', '', n)).strip()


def app_bone_name(z_name):
    """Z-Anatomy bone name ('Femur.r', 'Vertebra L4', 'Distal phalanx of first finger of foot.l') → BodyParts3D key (see app_key)."""
    side, n = '', z_name
    m = SIDE.search(n)
    if m:
        side, n = {'r': 'right', 'l': 'left'}[m.group(1)], n[:m.start()]
    m = re.match(r'^Vertebra ([CTL])(\d+)$', n)
    if m:
        n = f"{ORD[int(m.group(2)) - 1]} {dict(C='cervical', T='thoracic', L='lumbar')[m.group(1)]} vertebra"
    n = {'Atlas (C1)': 'atlas', 'Axis (C2)': 'axis', 'Manubrium of sternum': 'manubrium', 'Ethmoid bone': 'ethmoid',
         'Triquetrum bone': 'triquetral', 'Navicular bone': 'navicular bone of foot', 'Sesamoid bones of foot': 'sesamoid bone of foot'}.get(n, n)
    m = re.match(r'^Costal cartilage of (\w+) rib$', n)
    if m:
        n = f'{m.group(1)} costal cartilage'
    m = re.match(r'^(Proximal|Middle|Distal) phalanx of (\w+) finger of (hand|foot)$', n)
    if m:
        n = f"{m.group(1).lower()} phalanx of {DIGITS[m.group(3)][ORD.index(m.group(2))]}"
    n = re.sub(r'^(Capitate|Hamate|Lunate|Pisiform|Scaphoid|Trapezium|Trapezoid) bone$', lambda x: x.group(1), n)
    return side, n.lower()


# Z-Anatomy draws the foot's sesamoids as one mesh that does not match the BodyParts3D pair (fits turned about 70 degrees),
# so they do not steer the warp; the metatarsals and phalanges around them do.
UNPAIRED = re.compile(r'^Sesamoid bones of foot')


def bone_pairs(app, unmatched=None):
    pairs = []
    for ob in bpy.data.collections['1: Skeletal system'].all_objects:
        if ob.type == 'MESH' and not ANCHOR.search(ob.name) and not UNPAIRED.match(ob.name):
            p = app.by_key.get(app_bone_name(ob.name))
            if p and p['system'] == 'skeletal':
                pairs.append((ob, p))
            elif unmatched is not None:
                unmatched.append(ob.name)
    return pairs


def kabsch(src, dst):
    cs, cd = src.mean(0), dst.mean(0)
    u, s, vt = np.linalg.svd((src - cs).T @ (dst - cd))
    d = np.sign(np.linalg.det(vt.T @ u.T))
    r = vt.T @ np.diag([1, 1, d]) @ u.T
    return r, cd - r @ cs


def nearest_points(bvh, pts, limit=1.0):
    out, dist = np.empty_like(pts), np.full(len(pts), np.inf)
    for n, pt in enumerate(pts):
        loc, nrm, idx, d = bvh.find_nearest(Vector(pt), limit)
        if loc is not None:
            out[n], dist[n] = loc, d
    return out, dist


def fit_bone(z, bvh, init=None, iterations=40):
    """Rigid ICP of Z-Anatomy bone vertices onto a BodyParts3D bone, starting from init (rotation, translation) or the identity;
    returns rotation, translation and RMS residual."""
    r, t = init if init is not None else (np.eye(3), np.zeros(3))
    cur = z @ r.T + t
    for _ in range(iterations):
        q, d = nearest_points(bvh, cur)
        ok = np.isfinite(d)
        try:
            r2, t2 = kabsch(cur[ok], q[ok])
        except np.linalg.LinAlgError:
            break
        cur = cur @ r2.T + t2
        r, t = r2 @ r, r2 @ t + t2
    q, d = nearest_points(bvh, cur)
    return r, t, float(np.sqrt(np.mean(d[np.isfinite(d)] ** 2)))


class Warp:
    """Inverse-distance blend of bone surface displacements (Z-Anatomy position → app position)."""
    def __init__(self, src, dst):
        self.src, self.disp = src, dst - src
        self.tree = KDTree(len(src))
        for k, pt in enumerate(src):
            self.tree.insert(Vector(pt), k)
        self.tree.balance()

    def __call__(self, pts, k=16):
        out = np.empty_like(pts)
        for n, pt in enumerate(pts):
            near = self.tree.find_n(Vector(pt), k)
            d = np.array([x[2] for x in near])
            idx = [x[1] for x in near]
            w = 1.0 / (d ** 2 + 1e-6)
            out[n] = pt + (self.disp[idx] * w[:, None]).sum(0) / w.sum()
        return out

    @staticmethod
    def build(pairs, app, depsgraph, samples=600, report=None):
        """Bones are fitted largest first. A smaller bone is also fitted starting from the fit of the nearest bone already fitted: phalanges and
        sesamoids are smaller than the 2-3 cm offset between the skeletons, and started from where they are, ICP can lock onto
        a neighbour or turn them end over end. The closer of the two fits is kept."""
        src, dst, fitted = [], [], []
        bones = []
        for ob, p in pairs:
            z, _ = evaluated(ob, depsgraph)
            if len(z) >= 10:
                bones.append((ob, p, z))
        bones.sort(key=lambda b: -float(np.prod(b[2].max(0) - b[2].min(0))))
        for ob, p, z in bones:
            z = z[np.linspace(0, len(z) - 1, min(len(z), samples)).astype(int)]
            bvh = app.bvh(p)
            centre = z.mean(0)
            r, t, rms = fit_bone(z, bvh)
            if fitted:
                near = fit_bone(z, bvh, min(fitted, key=lambda f: np.linalg.norm(f[0] - centre))[1])
                if near[2] < rms:
                    r, t, rms = near
            fitted.append((centre, (r, t)))
            y = z @ r.T + t
            # Remaining shape difference: towards the nearest app bone surface, smoothed over the bone and capped at 12 mm.
            q, d = nearest_points(bvh, y, 0.012)
            res = np.where(np.isfinite(d)[:, None], q - y, 0.0)
            kd = KDTree(len(y))
            for k, pt in enumerate(y):
                kd.insert(Vector(pt), k)
            kd.balance()
            smooth = np.array([res[[j for (_, j, _) in kd.find_n(Vector(pt), 12)]].mean(0) for pt in y])
            src.append(z)
            dst.append(y + smooth)
            if report is not None:
                angle = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(r) - 1) / 2))))
                report.append({'z': ob.name, 'app': p['name'], 'rigid_rms_mm': round(rms * 1000, 2), 'angle_deg': round(angle, 1),
                               'mean_shift_mm': round(float(np.linalg.norm(y + smooth - z, axis=1).mean()) * 1000, 1)})
        return Warp(np.concatenate(src), np.concatenate(dst))

    def save(self, path):
        np.save(path, np.concatenate([self.src, self.src + self.disp], 1))

    @staticmethod
    def load(path):
        a = np.load(path)
        return Warp(a[:, :3], a[:, 3:])


class BoneSurfaces:
    """App bones (or other closed parts: system) for inside/outside tests and pushing warped soft tissue back out of them.
    Methods take the parts to consider, usually near(...) of the structure at hand, since testing them all for every vertex is slow."""
    def __init__(self, app, system='skeletal'):
        self.items = [(np.array(p['bounds']), app.bvh(p)) for p in app.parts if p['system'] == system]

    def near(self, lo, hi, pad=0.02):
        return [(b, bvh) for b, bvh in self.items if np.all(b[0] <= hi + pad) and np.all(b[1] >= lo - pad)]

    def nearest(self, pt, items=None, limit=0.02):
        best = (math.inf, None, None)
        for bounds, bvh in self.items if items is None else items:
            if np.any(pt < bounds[0] - limit) or np.any(pt > bounds[1] + limit):
                continue
            loc, nrm, idx, d = bvh.find_nearest(Vector(pt), limit)
            if loc is not None and d < best[0]:
                best = (d, bvh, np.array(loc))
        return best

    @staticmethod
    def inside(bvh, pt):
        hits, origin, direction = 0, Vector(pt), Vector((0.31, 0.83, 0.47)).normalized()
        while hits < 64:
            loc, nrm, idx, d = bvh.ray_cast(origin, direction)
            if loc is None:
                break
            hits += 1
            origin = loc + direction * 1e-5
        return hits % 2 == 1

    def signed_distance(self, pts, items=None):
        out = np.full(len(pts), 0.02)
        for n, pt in enumerate(pts):
            d, bvh, q = self.nearest(pt, items)
            if bvh is not None:
                out[n] = -d if self.inside(bvh, pt) else d
        return out

    def push_out(self, pts, depth=0.001, gap=0.0003, items=None):
        """Moves vertices more than `depth` inside a bone to just outside its surface; returns how many moved."""
        moved = 0
        for n, pt in enumerate(pts):
            d, bvh, q = self.nearest(pt, items)
            if bvh is None or d <= depth or not self.inside(bvh, pt):
                continue
            pts[n] = q + (q - pt) / d * gap
            moved += 1
        return moved

    def containing(self, pt, items, depth):
        """The first of the parts that holds pt more than depth inside, with the nearest point on its surface."""
        for bounds, bvh in items:
            if np.any(pt < bounds[0]) or np.any(pt > bounds[1]) or not self.inside(bvh, pt):
                continue
            loc, nrm, idx, d = bvh.find_nearest(Vector(pt))
            if loc is not None and d > depth:
                return np.array(loc), d
        return None

    def push_out_all(self, pts, depth, gap, items, passes=2):
        """Moves vertices lying inside any of the parts to just outside it. Parts can touch, so it runs again for vertices
        pushed into a neighbour; returns how many moves were made."""
        moved = 0
        for _ in range(passes):
            for n, pt in enumerate(pts):
                hit = self.containing(pt, items, depth)
                if hit:
                    q, d = hit
                    pts[n] = q + (q - pt) / d * gap
                    moved += 1
        return moved

