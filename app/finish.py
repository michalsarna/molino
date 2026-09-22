"""
Surface-finish relations between raster spacing and the ridge (scallop) a tool
leaves between adjacent parallel passes. This is where tool geometry shapes the
plan on smooth surfaces: the tool-offset path is identical for any tool whose
flank is steeper than the surface, but the ridge it leaves is not.
"""
import math

from app.params import CarveParams

MIN_STEP_MM = 0.02


def ridge_height(p: CarveParams, step: float, max_slope: float = 0.0) -> float:
    """Ridge left between passes `step` mm apart. Flat end mills only leave one on slopes."""
    if p.bit_type == "vbit":
        return (step / 2) / math.tan(math.radians(p.tip_angle / 2))
    if p.bit_type == "ballnose":
        R = p.bit_diameter / 2
        return R - math.sqrt(R * R - (step / 2) ** 2) if step < 2 * R else R
    return step * max_slope


def auto_step_over(p: CarveParams, max_slope: float = 0.0) -> float:
    """Largest spacing whose ridge stays within p.max_ridge."""
    h = p.max_ridge
    if p.bit_type == "vbit":
        s, cap = 2 * h * math.tan(math.radians(p.tip_angle / 2)), 5.0
    elif p.bit_type == "ballnose":
        R = p.bit_diameter / 2
        h = min(h, R)
        s, cap = 2 * math.sqrt(max(2 * R * h - h * h, 0.0)), 0.8 * p.bit_diameter
    else:
        s, cap = (h / max_slope if max_slope > 1e-6 else math.inf), 0.8 * p.bit_diameter
    return max(MIN_STEP_MM, min(s, cap))
