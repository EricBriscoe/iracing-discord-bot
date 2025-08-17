import aiosqlite
import asyncio
from typing import Optional, List, Tuple

class Database:
    def __init__(self, db_path: str = "data/users.db"):
        self.db_path = db_path
    
    async def init_db(self):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    discord_id INTEGER PRIMARY KEY,
                    iracing_username TEXT NOT NULL,
                    iracing_customer_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.commit()
    
    async def add_user(self, discord_id: int, iracing_username: str, iracing_customer_id: Optional[int] = None):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR REPLACE INTO users (discord_id, iracing_username, iracing_customer_id) VALUES (?, ?, ?)",
                (discord_id, iracing_username, iracing_customer_id)
            )
            await db.commit()
    
    async def get_user(self, discord_id: int) -> Optional[Tuple[str, Optional[int]]]:
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT iracing_username, iracing_customer_id FROM users WHERE discord_id = ?",
                (discord_id,)
            )
            result = await cursor.fetchone()
            return result if result else None
    
    async def get_all_users(self) -> List[Tuple[int, str, Optional[int]]]:
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute("SELECT discord_id, iracing_username, iracing_customer_id FROM users")
            return await cursor.fetchall()
    
    async def remove_user(self, discord_id: int):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM users WHERE discord_id = ?", (discord_id,))
            await db.commit()