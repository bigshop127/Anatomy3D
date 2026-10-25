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
    """The app's BodyParts3D parts as dumped by scripts/dump-atlas-geometry.mjs."""
    def __init__(self, raw_dir):
        self.parts = json.load(open(raw_dir + '/parts.json', encoding='utf8'))['parts']
        self.blob = open(raw_dir + '/geometry.bin', 'rb').read()
        self.by_name = {p['name'].lower(): p for p in self.parts}
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


def app_bone_name(z_name):
    """Z-Anatomy bone name ('Femur.r', 'Vertebra L4', 'Distal phalanx of first finger of foot.l') → BodyParts3D name, lowercase."""
    side, n = '', z_name
    m = SIDE.search(n)
    if m:
        side, n = {'r': 'right ', 'l': 'left '}[m.group(1)], n[:m.start()]
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
    return (side + n).lower()


def bone_pairs(app):
    pairs = []
    for ob in bpy.data.collections['1: Skeletal system'].all_objects:
        if ob.type == 'MESH' and not ANCHOR.search(ob.name):
            p = app.by_name.get(app_bone_name(ob.name))
            if p and p['system'] == 'skeletal':
                pairs.append((ob, p))
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


def fit_bone(z, bvh, iterations=40):
    """Rigid ICP of Z-Anatomy bone vertices onto a BodyParts3D bone; returns rotation, translation and RMS residual."""
    r, t, cur = np.eye(3), np.zeros(3), z.copy()
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
        src, dst = [], []
        for ob, p in pairs:
            z, _ = evaluated(ob, depsgraph)
            if len(z) < 10:
                continue
            z = z[np.linspace(0, len(z) - 1, min(len(z), samples)).astype(int)]
            bvh = app.bvh(p)
            r, t, rms = fit_bone(z, bvh)
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
    """App bones for inside/outside tests and pushing warped soft tissue back out of bone."""
    def __init__(self, app):
        self.items = [(np.array(p['bounds']), app.bvh(p)) for p in app.parts if p['system'] == 'skeletal']

    def _nearest(self, pt):
        best = (math.inf, None, None)
        for bounds, bvh in self.items:
            if np.any(pt < bounds[0] - 0.02) or np.any(pt > bounds[1] + 0.02):
                continue
            loc, nrm, idx, d = bvh.find_nearest(Vector(pt), 0.02)
            if loc is not None and d < best[0]:
                best = (d, bvh, np.array(loc))
        return best

    @staticmethod
    def _inside(bvh, pt):
        hits, origin, direction = 0, Vector(pt), Vector((0.31, 0.83, 0.47)).normalized()
        while hits < 64:
            loc, nrm, idx, d = bvh.ray_cast(origin, direction)
            if loc is None:
                break
            hits += 1
            origin = loc + direction * 1e-5
        return hits % 2 == 1

    def signed_distance(self, pts):
        out = np.full(len(pts), 0.02)
        for n, pt in enumerate(pts):
            d, bvh, q = self._nearest(pt)
            if bvh is not None:
                out[n] = -d if self._inside(bvh, pt) else d
        return out

    def push_out(self, pts, depth=0.001, gap=0.0003):
        """Moves vertices more than `depth` inside a bone to just outside its surface; returns how many moved."""
        moved = 0
        for n, pt in enumerate(pts):
            d, bvh, q = self._nearest(pt)
            if bvh is None or d <= depth or not self._inside(bvh, pt):
                continue
            pts[n] = q + (q - pt) / d * gap
            moved += 1
        return moved
