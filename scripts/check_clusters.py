import asyncio
import os
import sys

# Add the backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'VerifiKar-BE'))

from app.db.session import AsyncSessionFactory
from sqlalchemy import text

async def check_clusters():
    async with AsyncSessionFactory() as db:
        result = await db.execute(text("""
            SELECT id, area_name, status, 
                   ST_X(ST_Transform(avg_location::geometry, 3857)) as x_3857,
                   ST_Y(ST_Transform(avg_location::geometry, 3857)) as y_3857
            FROM clusters 
            WHERE status = 'active'::clusterstatusenum
            ORDER BY area_name
        """))
        rows = result.fetchall()
        print(f"\n{'ID':<40} {'AREA_NAME':<30} {'STATUS':<10} {'X_3857':<12} {'Y_3857':<12}")
        print("-" * 110)
        for row in rows:
            cluster_id, area_name, status, x, y = row
            print(f"{str(cluster_id):<40} {str(area_name):<30} {str(status):<10} {x:<12.0f} {y:<12.0f}")
        print(f"\nTotal active clusters: {len(rows)}")

asyncio.run(check_clusters())
