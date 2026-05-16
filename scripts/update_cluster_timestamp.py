import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'VerifiKar-BE'))

from app.db.session import AsyncSessionFactory
from sqlalchemy import text

async def fix():
    async with AsyncSessionFactory() as db:
        await db.execute(text("UPDATE clusters SET last_report_at = NOW() WHERE area_name = 'Saddar'"))
        await db.commit()
        print('✅ Updated Saddar last_report_at to NOW')

asyncio.run(fix())
