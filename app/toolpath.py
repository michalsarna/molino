"""
Raster tool-path planner.

Instead of dragging the tool across every full row, each pass only visits
pixels that still have material to remove. Runs on a row are merged across
gaps when skimming is cheaper than retract → rapid → plunge; runs on adjacent
rows are grouped into islands, and each island is carved with its own
serpentine before moving to the nearest remaining one.
"""
import math
from dataclasses import dataclass, field

import numpy as np

from app.params import CarveParams

Z_STEP       = 0.01   # mm — CNC step resolution; depths are quantised to this grid
SKIM_MAX_MM  = 2.0    # longest never-cut (white) gap to skim over at Z0 instead of retracting
_EPS         = 1e-9


@dataclass
class Plan:
    # ("pass", k, n, prev_max, pass_max) | ("hop", x, y, z) | ("cut", pts[N,3])  — stock mm coords
    ops: list = field(default_factory=list)
    cut_mm:    float = 0.0
    rapid_mm:  float = 0.0
    plunge_mm: float = 0.0
    passes:    int   = 0

    def minutes(self, p: CarveParams) -> float:
        return self.cut_mm / p.feed_rate + self.rapid_mm / p.rapid_rate + self.plunge_mm / p.plunge_rate


def quantise(heightmap: np.ndarray, cut_depth: float) -> np.ndarray:
    """Heightmap [0,1] -> depth in mm on the Z_STEP grid."""
    return np.round(heightmap * cut_depth / Z_STEP) * Z_STEP


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
        self.white = q <= _EPS
        self.skim_px = int(SKIM_MAX_MM / x_step)
        self.plan = Plan()
        x_off, y_off = origin_offset(p)
        self.x, self.y, self.z = -x_off, -y_off, p.safe_height   # tool starts at origin, safe height

    # ── cost model ────────────────────────────────────────────────────────
    def _bridge_px(self, depth: float) -> int:
        """Gap length (px) below which skimming at feed beats retract+rapid+plunge."""
        p = self.p
        if p.feed_rate >= p.rapid_rate:
            return self.q.shape[1]
        mm = (p.retract_height + depth) * (1 / p.rapid_rate + 1 / p.plunge_rate) \
             / (1 / p.feed_rate - 1 / p.rapid_rate)
        return int(mm / self.xs)

    def _gap_ok(self, r: int, c_lo: int, c_hi: int, bridge_px: int) -> bool:
        """May the tool travel over non-cutting columns c_lo..c_hi (inclusive) of row r?"""
        n = c_hi - c_lo + 1
        if n <= 0:
            return True
        if self.white[r, c_lo:c_hi + 1].any():
            return n <= self.skim_px
        return n <= bridge_px

    # ── primitive moves (update tool state + distance totals) ─────────────
    def hop(self, x: float, y: float, z: float):
        p = self.plan
        p.rapid_mm  += max(0.0, self.p.retract_height - self.z) + math.hypot(x - self.x, y - self.y)
        p.plunge_mm += max(self.z, self.p.retract_height) - z
        p.ops.append(("hop", x, y, z))
        self.x, self.y, self.z = x, y, z

    def cut(self, pts: np.ndarray):
        if len(pts) == 0:
            return
        prev = np.vstack(([self.x, self.y, self.z], pts[:-1]))
        self.plan.cut_mm += float(np.linalg.norm(pts - prev, axis=1).sum())
        self.plan.ops.append(("cut", pts))
        self.x, self.y, self.z = (float(v) for v in pts[-1])

    def _pts(self, r: int, cols: np.ndarray, zrow: np.ndarray) -> np.ndarray:
        return np.column_stack((cols * self.xs, np.full(len(cols), r * self.ys), -zrow[cols]))

    # ── one depth pass ────────────────────────────────────────────────────
    def plan_pass(self, prev_max: float, pass_max: float):
        need  = self.q > prev_max + _EPS
        zpass = np.minimum(self.q, pass_max)
        bridge_px = self._bridge_px(pass_max)

        segs: dict[int, list[tuple[int, int]]] = {}
        for r in np.flatnonzero(need.any(axis=1)).tolist():
            runs = _runs(need[r])
            merged = [runs[0]]
            for c0, c1 in runs[1:]:
                p0, p1 = merged[-1]
                if self._gap_ok(r, p1 + 1, c0 - 1, bridge_px):
                    merged[-1] = (p0, c1)
                else:
                    merged.append((c0, c1))
            segs[r] = merged

        islands = self._islands(segs, bridge_px)
        while islands:
            rows, from_top, start_col = self._pop_nearest(islands)
            self._walk(rows, zpass, bridge_px, from_top, start_col)

    def _islands(self, segs, bridge_px):
        """
        Union-find over segments. Segments on adjacent rows join one island only if the tool
        can roll from one into the other: they overlap, or the gap between them is short enough
        to skim (≤ SKIM_MAX_MM and allowed by the gap rule). Anything further apart is carved as
        a separate island — alternating between two shapes every row costs a skim or hop per row,
        finishing one first costs a single hop.
        """
        tol  = self.skim_px
        keys = [(r, i) for r in sorted(segs) for i in range(len(segs[r]))]
        idx  = {k: n for n, k in enumerate(keys)}
        parent = list(range(len(keys)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for r in sorted(segs):
            if r + 1 not in segs:
                continue
            below, above, j = segs[r], segs[r + 1], 0
            for i, (a0, a1) in enumerate(below):
                while j < len(above) and above[j][1] + tol < a0:
                    j += 1
                k = j
                while k < len(above) and above[k][0] - tol <= a1:
                    b0, b1 = above[k]
                    if b0 > a1:
                        ok = self._gap_ok(r + 1, a1 + 1, b0 - 1, bridge_px)
                    elif a0 > b1:
                        ok = self._gap_ok(r + 1, b1 + 1, a0 - 1, bridge_px)
                    else:
                        ok = True
                    if ok:
                        ra, rb = find(idx[(r, i)]), find(idx[(r + 1, k)])
                        if ra != rb:
                            parent[rb] = ra
                    k += 1

        groups: dict[int, dict[int, list]] = {}
        for (r, i), n in idx.items():
            groups.setdefault(find(n), {}).setdefault(r, []).append(segs[r][i])
        return list(groups.values())

    def _pop_nearest(self, islands):
        """Pick the island/corner closest to the tool; returns (rows, from_top, start_col)."""
        best = None
        for n, rows in enumerate(islands):
            rb, rt = min(rows), max(rows)
            for r, from_top in ((rb, False), (rt, True)):
                for col in (min(c0 for c0, _ in rows[r]), max(c1 for _, c1 in rows[r])):
                    d = math.hypot(col * self.xs - self.x, r * self.ys - self.y)
                    if best is None or d < best[0]:
                        best = (d, n, from_top, col)
        _, n, from_top, col = best
        return islands.pop(n), from_top, col

    def _walk(self, rows, zpass, bridge_px, from_top, start_col):
        c_cur, first = start_col, True
        for r in sorted(rows, reverse=from_top):
            segs_r = sorted(rows[r])
            left, right = segs_r[0][0], segs_r[-1][1]
            forward = abs(c_cur - left) <= abs(c_cur - right)
            step  = 1 if forward else -1
            order = segs_r if forward else segs_r[::-1]
            zrow  = zpass[r]

            for k, (c0, c1) in enumerate(order):
                near, far = (c0, c1) if forward else (c1, c0)

                if k == 0 and not first:
                    # Try to roll into this row from (c_cur, r-1) without retracting
                    inside = c0 <= c_cur <= c1
                    if inside:
                        ok   = abs(c_cur - near) <= bridge_px           # short stub gets cut twice
                        stub = np.arange(c_cur, near, -step)
                    else:
                        on_near_side = (c_cur < c0) if forward else (c_cur > c1)
                        lo, hi = (c_cur, near - 1) if forward else (near + 1, c_cur)
                        ok   = on_near_side and self._gap_ok(r, lo, hi, bridge_px)
                        stub = np.arange(c_cur, near, step)
                    if ok:
                        cols = np.concatenate((stub, np.arange(near, far + step, step)))
                        self.cut(self._pts(r, cols, zrow))
                        c_cur = far
                        continue

                self.hop(near * self.xs, r * self.ys, -float(zrow[near]))
                self.cut(self._pts(r, np.arange(near + step, far + step, step), zrow))
                c_cur = far
            first = False


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
