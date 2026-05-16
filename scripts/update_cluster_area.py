import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'VerifiKar-BE'))

from app.db.session import AsyncSessionFactory
from sqlalchemy import text

async def update():
    async with AsyncSessionFactory() as db:
        await db.execute(text("UPDATE clusters SET area_name = 'Saddar' WHERE area_name IS NULL"))
        await db.commit()
        print('✅ Updated cluster area_name to Saddar')

asyncio.run(update())
