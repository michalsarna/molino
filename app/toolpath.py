"""
Raster tool-path planner.

Each depth pass is planned as a walk over *segments* — runs of pixels on a row
that still have material to remove. From the end of a segment the tool prefers
to roll straight into an overlapping segment on the row above or below (this is
what follows a stroke or serpentines a solid area); only when nothing is
reachable does it retract and hop to the nearest unvisited segment anywhere.

Moves over material finished in an earlier pass are "link" moves: the tool runs
along the groove it already cut, removing nothing, so they go at rapid rate. That
makes staying down always cheaper than retract → rapid → plunge, so a row is only
split where the tool would have to skim across a never-cut (white) stretch longer
than SKIM_MAX_MM.
"""
import math
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

import numpy as np

from app.params import CarveParams

Z_STEP       = 0.01   # mm — CNC step resolution; depths are quantised to this grid
SKIM_MAX_MM  = 2.0    # longest never-cut (white) stretch to skim over at Z0 instead of retracting
_EPS         = 1e-9


@dataclass
class Plan:
    # ("pass", k, n, prev_max, pass_max) | ("hop", x, y, z) | ("cut", pts[N,3], link[N])
    # Coordinates are stock mm (origin bottom-left); link[i] marks the move *into* pts[i].
    ops: list = field(default_factory=list)
    cut_mm:    float = 0.0
    link_mm:   float = 0.0
    rapid_mm:  float = 0.0
    plunge_mm: float = 0.0
    passes:    int   = 0

    def minutes(self, p: CarveParams) -> float:
        return (self.cut_mm / p.feed_rate
                + (self.link_mm + self.rapid_mm) / p.rapid_rate
                + self.plunge_mm / p.plunge_rate)


def quantise(depth_mm: np.ndarray) -> np.ndarray:
    """Snap depths (mm) to the Z_STEP grid."""
    return np.round(depth_mm / Z_STEP) * Z_STEP


def origin_offset(p: CarveParams) -> tuple[float, float]:
    """Translation that puts the chosen stock point at X0 Y0."""
    oy, ox = p.origin.split("-")
    x_off = {"left": 0.0, "center": -p.width_mm / 2, "right": -p.width_mm}[ox]
    y_off = {"bottom": 0.0, "middle": -p.height_mm / 2, "top": -p.height_mm}[oy]
    return x_off, y_off


def _runs(mask_row: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) column pairs of True runs."""
    idx = np.flatnonzero(mask_row)
    if idx.size == 0:
        return []
    brk = np.flatnonzero(np.diff(idx) > 1)
    starts = np.concatenate(([idx[0]], idx[brk + 1]))
    ends   = np.concatenate((idx[brk], [idx[-1]]))
    return list(zip(starts.tolist(), ends.tolist()))


class _Planner:
    def __init__(self, q: np.ndarray, p: CarveParams, x_step: float, y_step: float):
        self.q, self.p, self.xs, self.ys = q, p, x_step, y_step
        self.plan = Plan()
        self.white = q <= _EPS
        self.skim_px = int(SKIM_MAX_MM / x_step)
        x_off, y_off = origin_offset(p)
        self.x, self.y, self.z = -x_off, -y_off, p.safe_height   # tool starts at origin, safe height

    # ── cost model ────────────────────────────────────────────────────────
    def _stub_px(self, depth: float) -> int:
        """Longest stub worth cutting twice (to enter a row mid-segment) instead of hopping."""
        p = self.p
        hop_min = (p.retract_height + depth) * (1 / p.rapid_rate + 1 / p.plunge_rate)
        return int(hop_min * p.feed_rate / 2 / self.xs)

    def _gap_ok(self, r: int, lo: int, hi: int) -> bool:
        """
        May the tool stay down while crossing columns lo..hi (inclusive) of row r?
        Finished material is always fine (link move along the groove); never-cut white is
        only skimmed if no consecutive white stretch inside the gap exceeds SKIM_MAX_MM.
        """
        if lo > hi:
            return True
        w = self.white[r, lo:hi + 1]
        if not w.any():
            return True
        edges = np.flatnonzero(np.diff(np.concatenate(([0], w.astype(np.int8), [0]))))
        return int((edges[1::2] - edges[::2]).max()) <= self.skim_px

    # ── primitive moves (update tool state + distance totals) ─────────────
    def hop(self, x: float, y: float, z: float):
        pl = self.plan
        pl.rapid_mm  += max(0.0, self.p.retract_height - self.z) + math.hypot(x - self.x, y - self.y)
        pl.plunge_mm += max(self.z, self.p.retract_height) - z
        pl.ops.append(("hop", x, y, z))
        self.x, self.y, self.z = x, y, z

    def cut(self, pts: np.ndarray, link: np.ndarray):
        if len(pts) == 0:
            return
        prev = np.vstack(([self.x, self.y, self.z], pts[:-1]))
        d = np.linalg.norm(pts - prev, axis=1)
        self.plan.cut_mm  += float(d[~link].sum())
        self.plan.link_mm += float(d[link].sum())
        self.plan.ops.append(("cut", pts, link))
        self.x, self.y, self.z = (float(v) for v in pts[-1])

    def _path(self, r: int, cols: np.ndarray, zrow: np.ndarray, need_row: np.ndarray):
        pts = np.column_stack((cols * self.xs, np.full(len(cols), r * self.ys), -zrow[cols]))
        # A move is a link only when it leaves and arrives on pixels finished in an earlier
        # pass (cut, but nothing left to remove). White skims stay at cutting feed. The tool
        # always starts a path on a pixel it is cutting, so the first move is never a link.
        fin  = ~need_row[cols] & ~self.white[r, cols]
        link = fin & np.concatenate(([False], fin[:-1]))
        return pts, link

    # ── one depth pass ────────────────────────────────────────────────────
    def plan_pass(self, prev_max: float, pass_max: float):
        need  = self.q > prev_max + _EPS
        zpass = np.minimum(self.q, pass_max)
        stub_px = self._stub_px(pass_max)

        # Segments: runs of pixels to cut, merged across gaps the tool may cross while down
        seg_r, seg_c0, seg_c1 = [], [], []
        row_segs: dict[int, list[int]] = {}
        for r in np.flatnonzero(need.any(axis=1)).tolist():
            runs = _runs(need[r])
            merged = [runs[0]]
            for c0, c1 in runs[1:]:
                p0, p1 = merged[-1]
                if self._gap_ok(r, p1 + 1, c0 - 1):
                    merged[-1] = (p0, c1)
                else:
                    merged.append((c0, c1))
            row_segs[r] = list(range(len(seg_r), len(seg_r) + len(merged)))
            for c0, c1 in merged:
                seg_r.append(r)
                seg_c0.append(c0)
                seg_c1.append(c1)
        if not seg_r:
            return

        visited   = [False] * len(seg_r)
        remaining = {r: len(ids) for r, ids in row_segs.items()}
        rows_left = sorted(row_segs)
        row_c0    = {r: [seg_c0[s] for s in ids] for r, ids in row_segs.items()}

        def finish(s):
            visited[s] = True
            r = seg_r[s]
            remaining[r] -= 1
            if remaining[r] == 0:
                rows_left.remove(r)

        def roll_in(r, c, dir_y):
            """Best unvisited segment on row r±1 the tool can enter from column c without retracting."""
            best = None
            for rr in (r + dir_y, r - dir_y):
                if remaining.get(rr, 0) == 0:
                    continue
                k = bisect_right(row_c0[rr], c) - 1
                for kk in (k, k + 1):
                    if not 0 <= kk < len(row_segs[rr]):
                        continue
                    s = row_segs[rr][kk]
                    if visited[s]:
                        continue
                    c0, c1 = seg_c0[s], seg_c1[s]
                    if c0 <= c <= c1:                                   # enter mid-segment via a stub
                        near, far = (c0, c1) if c - c0 <= c1 - c else (c1, c0)
                        pen = abs(c - near)
                        if pen > stub_px:
                            continue
                    elif c < c0:
                        if not self._gap_ok(rr, c, c0 - 1):
                            continue
                        near, far, pen = c0, c1, c0 - c
                    else:
                        if not self._gap_ok(rr, c1 + 1, c):
                            continue
                        near, far, pen = c1, c0, c - c1
                    if best is None or pen < best[0]:
                        best = (pen, s, rr, near, far)
            return best

        # Entering a chain of segments in the middle forces one extra hop later; charge that
        # hop's time, expressed as an equivalent rapid distance, when ranking hop targets.
        p = self.p
        mid_chain_penalty = (p.retract_height + pass_max) * (1 / p.rapid_rate + 1 / p.plunge_rate) * p.rapid_rate
        skim_px = self.skim_px

        def has_neighbour(s, rr):
            """Any unvisited segment on row rr the tool could roll into from segment s?"""
            if remaining.get(rr, 0) == 0:
                return False
            c0, c1 = seg_c0[s] - skim_px, seg_c1[s] + skim_px
            k = bisect_right(row_c0[rr], c1)
            while k > 0:
                k -= 1
                t = row_segs[rr][k]
                if seg_c1[t] < c0:
                    return False
                if not visited[t]:
                    return True
            return False

        def nearest():
            """Cheapest unvisited segment end to hop to, searching rows outward from the tool's Y."""
            ry = self.y / self.ys
            hi = bisect_left(rows_left, ry)
            lo = hi - 1
            best = None
            while lo >= 0 or hi < len(rows_left):
                d_lo = (ry - rows_left[lo]) * self.ys if lo >= 0 else math.inf
                d_hi = (rows_left[hi] - ry) * self.ys if hi < len(rows_left) else math.inf
                if best is not None and min(d_lo, d_hi) >= best[0]:
                    break
                if d_lo <= d_hi:
                    r, lo = rows_left[lo], lo - 1
                else:
                    r, hi = rows_left[hi], hi + 1
                dy = r * self.ys - self.y
                for s in row_segs[r]:
                    if visited[s]:
                        continue
                    pen = mid_chain_penalty if has_neighbour(s, r + 1) and has_neighbour(s, r - 1) else 0.0
                    for near, far in ((seg_c0[s], seg_c1[s]), (seg_c1[s], seg_c0[s])):
                        d = math.hypot(near * self.xs - self.x, dy) + pen
                        if best is None or d < best[0]:
                            best = (d, s, r, near, far)
            return best

        cur_r = cur_c = None
        dir_y = 1
        left = len(seg_r)
        while left:
            hit = roll_in(cur_r, cur_c, dir_y) if cur_r is not None else None
            if hit is not None:
                _, s, r, near, far = hit
                stub = np.arange(cur_c, near, 1 if near > cur_c else -1)
                step = 1 if far >= near else -1
                cols = np.concatenate((stub, np.arange(near, far + step, step)))
                dir_y = r - cur_r
            else:
                _, s, r, near, far = nearest()
                self.hop(near * self.xs, r * self.ys, -float(zpass[r, near]))
                step = 1 if far >= near else -1
                cols = np.arange(near + step, far + step, step)
            self.cut(*self._path(r, cols, zpass[r], need[r]))
            finish(s)
            cur_r, cur_c = r, far
            left -= 1


def plan_toolpath(q: np.ndarray, p: CarveParams, x_step: float, y_step: float) -> Plan:
    pl = _Planner(q, p, x_step, y_step)
    dpp = p.depth_per_pass if p.depth_per_pass < p.cut_depth else p.cut_depth
    n = math.ceil(p.cut_depth / dpp)
    pl.plan.passes = n
    for k in range(1, n + 1):
        prev_max, pass_max = (k - 1) * dpp, min(k * dpp, p.cut_depth)
        pl.plan.ops.append(("pass", k, n, prev_max, pass_max))
        pl.plan_pass(prev_max, pass_max)
    return pl.plan


def preview_paths(plan: Plan) -> dict:
    """
    Compact XY polylines for the 3D preview. cuts/links: [pass_max, x0, y0, x1, y1, ...]
    with vertices only where the row changes; hops: [x0, y0, x1, y1].
    """
    cuts, links, hops = [], [], []
    pmax, px, py = 0.0, None, None
    for op in plan.ops:
        if op[0] == "pass":
            pmax = op[4]
        elif op[0] == "hop":
            _, x, y, _z = op
            if px is not None:
                hops.append([round(px, 3), round(py, 3), round(x, 3), round(y, 3)])
            px, py = x, y
        else:
            pts, link = op[1], op[2]
            start = 0
            while start < len(pts):
                end = start
                while end + 1 < len(pts) and link[end + 1] == link[start]:
                    end += 1
                seg = pts[start:end + 1, :2]
                keep = np.concatenate(([True], seg[1:, 1] != seg[:-1, 1]))
                keep[-1] = True
                verts = [pmax, px, py] + np.round(seg[keep], 3).ravel().tolist()
                (links if link[start] else cuts).append(verts)
                px, py = float(seg[-1, 0]), float(seg[-1, 1])
                start = end + 1
    return {"cuts": cuts, "links": links, "hops": hops}
