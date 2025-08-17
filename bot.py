import os
import asyncio
import logging
import discord
from discord.ext import commands, tasks
from dotenv import load_dotenv
from database import Database
from iracing_client import iRacingClient

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class iRacingBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix='!', intents=intents)
        
        self.db = Database()
        self.iracing = iRacingClient()
        self.leaderboard_channel_id = os.getenv('LEADERBOARD_CHANNEL_ID')
        self.leaderboard_message_id = None
    
    async def setup_hook(self):
        await self.db.init_db()
        await self.tree.sync()
        logger.info("Slash commands synced")
        
        if self.leaderboard_channel_id:
            self.update_leaderboard.start()
    
    async def on_ready(self):
        logger.info(f'{self.user} has connected to Discord!')

bot = iRacingBot()

@bot.tree.command(name="link", description="Link your iRacing account to your Discord account")
@discord.app_commands.describe(iracing_username="Your iRacing username")
async def link_iracing(interaction: discord.Interaction, iracing_username: str):
    await interaction.response.defer()
    
    try:
        customer_id = await bot.iracing.search_member(iracing_username)
        
        if not customer_id:
            await interaction.followup.send(f"❌ Could not find iRacing user: {iracing_username}")
            return
        
        member_data = await bot.iracing.get_member_summary(customer_id)
        if not member_data:
            await interaction.followup.send(f"❌ Could not retrieve data for iRacing user: {iracing_username}")
            return
        
        await bot.db.add_user(interaction.user.id, iracing_username, customer_id)
        
        embed = discord.Embed(
            title="✅ Account Linked Successfully",
            color=discord.Color.green()
        )
        embed.add_field(name="Discord User", value=interaction.user.mention, inline=True)
        embed.add_field(name="iRacing User", value=iracing_username, inline=True)
        embed.add_field(name="Customer ID", value=str(customer_id), inline=True)
        
        if member_data:
            licenses = member_data.get('licenses', [])
            if licenses:
                road_license = next((l for l in licenses if l.get('category_id') == 2), None)
                oval_license = next((l for l in licenses if l.get('category_id') == 1), None)
                
                if road_license:
                    embed.add_field(
                        name="Road License", 
                        value=f"{road_license.get('license_level', 'N/A')} {road_license.get('safety_rating', 0):.2f}",
                        inline=True
                    )
                if oval_license:
                    embed.add_field(
                        name="Oval License",
                        value=f"{oval_license.get('license_level', 'N/A')} {oval_license.get('safety_rating', 0):.2f}",
                        inline=True
                    )
        
        await interaction.followup.send(embed=embed)
        
    except Exception as e:
        logger.error(f"Error linking account: {e}")
        await interaction.followup.send("❌ An error occurred while linking your account. Please try again later.")

@bot.tree.command(name="unlink", description="Unlink your iRacing account from Discord")
async def unlink_iracing(interaction: discord.Interaction):
    await interaction.response.defer()
    
    try:
        user_data = await bot.db.get_user(interaction.user.id)
        if not user_data:
            await interaction.followup.send("❌ No iRacing account linked to your Discord account.")
            return
        
        await bot.db.remove_user(interaction.user.id)
        await interaction.followup.send("✅ Successfully unlinked your iRacing account.")
        
    except Exception as e:
        logger.error(f"Error unlinking account: {e}")
        await interaction.followup.send("❌ An error occurred while unlinking your account.")

@tasks.loop(minutes=30)
async def update_leaderboard():
    if not bot.leaderboard_channel_id:
        return
    
    try:
        channel = bot.get_channel(int(bot.leaderboard_channel_id))
        if not channel:
            logger.error(f"Could not find leaderboard channel: {bot.leaderboard_channel_id}")
            return
        
        users = await bot.db.get_all_users()
        if not users:
            return
        
        leaderboard_data = []
        
        for discord_id, iracing_username, customer_id in users:
            if customer_id:
                member_data = await bot.iracing.get_member_summary(customer_id)
                if member_data:
                    licenses = member_data.get('licenses', [])
                    road_license = next((l for l in licenses if l.get('category_id') == 2), None)
                    
                    if road_license:
                        irating = road_license.get('irating', 0)
                        safety_rating = road_license.get('safety_rating', 0.0)
                        license_level = road_license.get('license_level', 0)
                        
                        leaderboard_data.append({
                            'discord_id': discord_id,
                            'iracing_username': iracing_username,
                            'irating': irating,
                            'safety_rating': safety_rating,
                            'license_level': license_level
                        })
        
        leaderboard_data.sort(key=lambda x: x['irating'], reverse=True)
        
        embed = discord.Embed(
            title="🏁 iRacing Leaderboard (Road)",
            color=discord.Color.blue(),
            timestamp=discord.utils.utcnow()
        )
        
        if leaderboard_data:
            leaderboard_text = ""
            for i, data in enumerate(leaderboard_data[:10], 1):
                user = bot.get_user(data['discord_id'])
                display_name = user.display_name if user else data['iracing_username']
                
                leaderboard_text += f"{i}. **{display_name}** ({data['iracing_username']})\n"
                leaderboard_text += f"   iRating: {data['irating']} | SR: {data['safety_rating']:.2f} | License: {data['license_level']}\n\n"
            
            embed.description = leaderboard_text
        else:
            embed.description = "No linked accounts found. Use `/link` to add your iRacing account!"
        
        embed.set_footer(text="Updates every 30 minutes")
        
        if bot.leaderboard_message_id:
            try:
                message = await channel.fetch_message(bot.leaderboard_message_id)
                await message.edit(embed=embed)
                return
            except discord.NotFound:
                bot.leaderboard_message_id = None
        
        async for message in channel.history(limit=100):
            if message.author == bot.user:
                await message.delete()
        
        new_message = await channel.send(embed=embed)
        bot.leaderboard_message_id = new_message.id
        
    except Exception as e:
        logger.error(f"Error updating leaderboard: {e}")

bot.update_leaderboard = update_leaderboard

if __name__ == "__main__":
    token = os.getenv('DISCORD_TOKEN')
    if not token:
        logger.error("DISCORD_TOKEN environment variable not set")
        exit(1)
    
    bot.run(token)