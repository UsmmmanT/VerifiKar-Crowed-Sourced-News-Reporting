import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'VerifiKar-BE'))

from app.db.session import AsyncSessionFactory
from sqlalchemy import text
from datetime import datetime, timezone

async def check():
    async with AsyncSessionFactory() as db:
        result = await db.execute(text("""
            SELECT id, area_name, status, last_report_at, created_at
            FROM clusters 
            WHERE status = 'active'::clusterstatusenum
        """))
        clusters = result.fetchall()
        
        now = datetime.now(timezone.utc)
        for cluster_id, area_name, status, last_report_at, created_at in clusters:
            age_hours = (now - last_report_at.replace(tzinfo=timezone.utc)).total_seconds() / 3600 if last_report_at else None
            print(f"\nCluster: {area_name}")
            print(f"  Created: {created_at}")
            print(f"  Last Report: {last_report_at}")
            print(f"  Age: {age_hours:.1f} hours ago")
            print(f"  Within 24h? {'✅ YES' if age_hours and age_hours < 24 else '❌ NO'}")

asyncio.run(check())
