import os
import asyncio
from typing import Optional, List, Dict, Any
from iracingdataapi.client import irDataClient
import logging

logger = logging.getLogger(__name__)

class iRacingClient:
    def __init__(self):
        self.username = os.getenv('IRACING_USERNAME')
        self.password = os.getenv('IRACING_PASSWORD')
        self._client = None
        self._lock = asyncio.Lock()
    
    async def _get_client(self):
        if not self._client:
            if not self.username or not self.password:
                raise ValueError("iRacing credentials not configured")
            self._client = irDataClient(username=self.username, password=self.password)
        return self._client
    
    async def get_member_summary(self, customer_id: int) -> Optional[Dict[str, Any]]:
        async with self._lock:
            try:
                client = await self._get_client()
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, client.stats_member_summary, customer_id)
                return result
            except Exception as e:
                logger.error(f"Error fetching member summary for {customer_id}: {e}")
                return None
    
    async def search_member(self, username: str) -> Optional[int]:
        async with self._lock:
            try:
                client = await self._get_client()
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, lambda: client.lookup_drivers(search_term=username))
                
                if result and len(result) > 0:
                    for member in result:
                        if member.get('display_name', '').lower() == username.lower():
                            return member.get('cust_id')
                    return result[0].get('cust_id')
                return None
            except Exception as e:
                logger.error(f"Error searching for member {username}: {e}")
                return None
    
    async def get_member_recent_races(self, customer_id: int) -> Optional[List[Dict[str, Any]]]:
        async with self._lock:
            try:
                client = await self._get_client()
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, client.stats_member_recent_races, customer_id)
                return result
            except Exception as e:
                logger.error(f"Error fetching recent races for {customer_id}: {e}")
                return None
