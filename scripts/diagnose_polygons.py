import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'VerifiKar-BE'))

from app.db.session import AsyncSessionFactory
from sqlalchemy import text

async def diagnose():
    async with AsyncSessionFactory() as db:
        # Check what's in planet_osm_polygon
        print("\n=== POLYGONS IN DATABASE ===")
        result = await db.execute(text("""
            SELECT id, osm_id, name, 
                   ST_AsText(way) as polygon_boundary,
                   ST_XMin(way) as x_min, ST_XMax(way) as x_max,
                   ST_YMin(way) as y_min, ST_YMax(way) as y_max
            FROM planet_osm_polygon 
            WHERE osm_id <= 100
            ORDER BY name
        """))
        polygons = result.fetchall()
        for poly in polygons:
            poly_id, osm_id, name, boundary, x_min, x_max, y_min, y_max = poly
            print(f"\n{name}:")
            print(f"  Bounds: X[{x_min:.0f} to {x_max:.0f}] Y[{y_min:.0f} to {y_max:.0f}]")
            print(f"  Polygon: {boundary[:80]}...")
        
        # Check cluster vs polygon overlap
        print("\n\n=== CLUSTER vs POLYGON CONTAINMENT ===")
        result = await db.execute(text("""
            SELECT 
                c.id,
                c.area_name,
                ST_X(ST_Transform(c.avg_location::geometry, 3857)) as c_x_3857,
                ST_Y(ST_Transform(c.avg_location::geometry, 3857)) as c_y_3857,
                p.name as polygon_name,
                ST_Contains(p.way, ST_Transform(c.avg_location::geometry, 3857)) as is_contained
            FROM clusters c
            CROSS JOIN planet_osm_polygon p
            WHERE c.status = 'active'::clusterstatusenum
            ORDER BY c.area_name, p.name
        """))
        overlaps = result.fetchall()
        for cluster_id, area_name, c_x, c_y, poly_name, is_contained in overlaps:
            status = "✅ INSIDE" if is_contained else "❌ OUTSIDE"
            print(f"Cluster ({area_name}) {status} Polygon ({poly_name})")
            print(f"  Cluster: x_3857={c_x:.0f}, y_3857={c_y:.0f}")

asyncio.run(diagnose())
