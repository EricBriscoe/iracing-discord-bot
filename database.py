import aiosqlite
import asyncio
from typing import Optional, List, Tuple, Dict

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
            await db.execute("""
                CREATE TABLE IF NOT EXISTS guild_configs (
                    guild_id INTEGER PRIMARY KEY,
                    stats_channel_id INTEGER,
                    stats_message_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    
    async def set_stats_channel(self, guild_id: int, channel_id: int):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT OR REPLACE INTO guild_configs (guild_id, stats_channel_id, updated_at) 
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (guild_id, channel_id))
            await db.commit()
    
    async def get_stats_channel(self, guild_id: int) -> Optional[Tuple[int, Optional[int]]]:
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT stats_channel_id, stats_message_id FROM guild_configs WHERE guild_id = ?",
                (guild_id,)
            )
            result = await cursor.fetchone()
            return result if result else None
    
    async def update_stats_message_id(self, guild_id: int, message_id: int):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE guild_configs SET stats_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?",
                (message_id, guild_id)
            )
            await db.commit()
    
    async def remove_stats_channel(self, guild_id: int):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM guild_configs WHERE guild_id = ?", (guild_id,))
            await db.commit()
    
    async def get_all_guild_configs(self) -> List[Tuple[int, int, Optional[int]]]:
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute("SELECT guild_id, stats_channel_id, stats_message_id FROM guild_configs WHERE stats_channel_id IS NOT NULL")
            return await cursor.fetchall()