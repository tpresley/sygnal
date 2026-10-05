"""Geometry of the Sygnal mark ("Square Duo").

Two chevrons on a 2:1 slope: an upper "<" and a lower ">" (the "<" rotated
180deg). Their middle arms run side by side, each tucked into the other's
opening, separated by thin perpendicular slits.

All values are in a 200-unit grid; screen coordinates (y grows downward).
"""
import math

from shapely import affinity
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

BIG = 2000


def band(slope, y0, t, x0=-BIG, x1=BIG):
    """Region between y = y0 + slope*x and that line + t (vertical thickness)."""
    return Polygon([(x0, y0 + slope * x0), (x1, y0 + slope * x1),
                    (x1, y0 + slope * x1 + t), (x0, y0 + slope * x0 + t)])


def rot(geom, cx, cy):
    return affinity.rotate(geom, 180, origin=(cx, cy))


def mbuf(geom, d):
    return geom.buffer(d, join_style="mitre", mitre_limit=10)


def polys(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    return [p for p in geom.geoms if isinstance(p, Polygon) and p.area > 0.5]


def path_d(geom):
    d = ""
    for p in polys(geom):
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)[:-1]
            d += "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in c) + "Z"
    return d


def mark(k=0.5, Wt=200, tl=38, tm=38, g=9, gm=None, aspect=1.0):
    """Return (upper, lower) chevron polygons.

    k:      slope (0.5 = 2:1, 26.57deg)
    Wt:     width of the grid
    tl:     leg thickness (vertical)
    tm:     middle-arm thickness, trimmed on its inner side so the outline
            stays the same
    g:      slit where a middle arm meets the other chevron's leg
    gm:     slit between the two middle arms (defaults to g)
    aspect: height / width of the frame that cuts the flat leg ends
    """
    gm = g if gm is None else gm
    sq = math.sqrt(1 + k * k)
    d = tl - tm
    cx = Wt / 2
    cy = k * cx + d - gm * sq / 2
    H = Wt * aspect
    top_leg = band(-k, 0, tl, 0, Wt).intersection(box(-BIG, cy - H / 2, BIG, BIG))
    middle = band(k, d, tm, 0, Wt)
    bottom_leg = rot(top_leg, cx, cy)
    # the middle arm stops one slit short of the other chevron's leg; keep only
    # the piece attached to the vertex
    middle = middle.difference(mbuf(bottom_leg, g * 0.999))
    middle = max(polys(middle), key=lambda p: -p.distance(Point(0, tl - 1)) * 1e6 + p.area)
    upper = unary_union([top_leg, middle])
    return upper, rot(upper, cx, cy)
