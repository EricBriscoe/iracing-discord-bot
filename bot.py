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

def is_server_owner():
    """Check if user is the server owner"""
    def predicate(interaction: discord.Interaction) -> bool:
        return interaction.guild and interaction.user.id == interaction.guild.owner_id
    return discord.app_commands.check(predicate)

class iRacingBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix='!', intents=intents)
        
        self.db = Database()
        self.iracing = iRacingClient()
    
    async def setup_hook(self):
        await self.db.init_db()
        await self.tree.sync()
        logger.info("Slash commands synced")
        
        self.update_leaderboard.start()
    
    async def on_ready(self):
        logger.info(f'{self.user} has connected to Discord!')

bot = iRacingBot()

@bot.tree.command(name="link", description="Link an iRacing account to a Discord account")
@discord.app_commands.describe(
    iracing_username="The iRacing username to link",
    discord_user="[ADMIN ONLY] The Discord user to link (leave empty to link yourself)"
)
async def link_iracing(interaction: discord.Interaction, iracing_username: str, discord_user: discord.User = None):
    await interaction.response.defer()
    
    target_user = discord_user if discord_user else interaction.user
    is_admin_action = discord_user is not None
    
    if is_admin_action and not (interaction.guild and interaction.user.id == interaction.guild.owner_id):
        await interaction.followup.send("❌ Only server owners can link accounts for other users.")
        return
    
    try:
        customer_id = await bot.iracing.search_member(iracing_username)
        
        if not customer_id:
            await interaction.followup.send(f"❌ Could not find iRacing user: {iracing_username}")
            return
        
        member_data = await bot.iracing.get_member_summary(customer_id)
        if not member_data:
            await interaction.followup.send(f"❌ Could not retrieve data for iRacing user: {iracing_username}")
            return
        
        await bot.db.add_user(target_user.id, iracing_username, customer_id)
        
        embed = discord.Embed(
            title=f"✅ Account Linked Successfully{' (Admin)' if is_admin_action else ''}",
            color=discord.Color.orange() if is_admin_action else discord.Color.green()
        )
        embed.add_field(name="Discord User", value=target_user.mention, inline=True)
        embed.add_field(name="iRacing User", value=iracing_username, inline=True)
        embed.add_field(name="Customer ID", value=str(customer_id), inline=True)
        
        if is_admin_action:
            embed.add_field(name="Linked by", value=interaction.user.mention, inline=True)
        
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
        await interaction.followup.send("❌ An error occurred while linking the account. Please try again later.")

@bot.tree.command(name="unlink", description="Unlink an iRacing account from Discord")
@discord.app_commands.describe(
    discord_user="[ADMIN ONLY] The Discord user to unlink (leave empty to unlink yourself)"
)
async def unlink_iracing(interaction: discord.Interaction, discord_user: discord.User = None):
    await interaction.response.defer()
    
    target_user = discord_user if discord_user else interaction.user
    is_admin_action = discord_user is not None
    
    if is_admin_action and not (interaction.guild and interaction.user.id == interaction.guild.owner_id):
        await interaction.followup.send("❌ Only server owners can unlink accounts for other users.")
        return
    
    try:
        user_data = await bot.db.get_user(target_user.id)
        if not user_data:
            if is_admin_action:
                await interaction.followup.send(f"❌ No iRacing account linked to {target_user.mention}.")
            else:
                await interaction.followup.send("❌ No iRacing account linked to your Discord account.")
            return
        
        await bot.db.remove_user(target_user.id)
        
        if is_admin_action:
            embed = discord.Embed(
                title="✅ Account Unlinked Successfully (Admin)",
                color=discord.Color.orange()
            )
            embed.add_field(name="Discord User", value=target_user.mention, inline=True)
            embed.add_field(name="Previous iRacing User", value=user_data[0], inline=True)
            embed.add_field(name="Unlinked by", value=interaction.user.mention, inline=True)
            await interaction.followup.send(embed=embed)
        else:
            await interaction.followup.send("✅ Successfully unlinked your iRacing account.")
        
    except Exception as e:
        logger.error(f"Error unlinking account: {e}")
        await interaction.followup.send("❌ An error occurred while unlinking the account.")

@bot.tree.command(name="list-links", description="[ADMIN] List all linked accounts")
@is_server_owner()
async def list_links_admin(interaction: discord.Interaction):
    await interaction.response.defer()
    
    try:
        users = await bot.db.get_all_users()
        
        if not users:
            await interaction.followup.send("❌ No linked accounts found.")
            return
        
        embed = discord.Embed(
            title="📋 Linked Accounts",
            color=discord.Color.blue()
        )
        
        links_text = ""
        for discord_id, iracing_username, customer_id in users:
            discord_user = bot.get_user(discord_id)
            user_display = discord_user.mention if discord_user else f"Unknown User ({discord_id})"
            links_text += f"{user_display} → **{iracing_username}** (ID: {customer_id})\n"
        
        embed.description = links_text
        embed.set_footer(text=f"Total: {len(users)} linked accounts")
        
        await interaction.followup.send(embed=embed)
        
    except Exception as e:
        logger.error(f"Error listing links: {e}")
        await interaction.followup.send("❌ An error occurred while listing linked accounts.")

@bot.tree.command(name="toggle-stats-channel", description="[ADMIN] Toggle iRacing leaderboard updates for a channel")
@discord.app_commands.describe(channel="The channel to toggle for leaderboard updates (leave empty to disable)")
@is_server_owner()
async def toggle_stats_channel(interaction: discord.Interaction, channel: discord.TextChannel = None):
    await interaction.response.defer()
    
    try:
        current_config = await bot.db.get_stats_channel(interaction.guild.id)
        
        if channel is None:
            # Disable stats channel
            if not current_config:
                await interaction.followup.send("❌ No stats channel is currently configured for this server.")
                return
            
            await bot.db.remove_stats_channel(interaction.guild.id)
            
            embed = discord.Embed(
                title="✅ Stats Channel Disabled",
                color=discord.Color.orange()
            )
            embed.add_field(name="Guild", value=interaction.guild.name, inline=True)
            embed.add_field(name="Disabled by", value=interaction.user.mention, inline=True)
            embed.description = "Leaderboard updates have been disabled for this server."
            
            await interaction.followup.send(embed=embed)
            
        else:
            # Set/change stats channel
            await bot.db.set_stats_channel(interaction.guild.id, channel.id)
            
            action = "Updated" if current_config else "Configured"
            embed = discord.Embed(
                title=f"✅ Stats Channel {action}",
                color=discord.Color.green()
            )
            embed.add_field(name="Channel", value=channel.mention, inline=True)
            embed.add_field(name="Guild", value=interaction.guild.name, inline=True)
            embed.add_field(name=f"{action} by", value=interaction.user.mention, inline=True)
            embed.description = f"The leaderboard will now be automatically updated in {channel.mention} every 30 minutes."
            
            await interaction.followup.send(embed=embed)
            
            # Trigger an immediate leaderboard update for this guild
            asyncio.create_task(update_guild_leaderboard(interaction.guild.id))
        
    except Exception as e:
        logger.error(f"Error toggling stats channel: {e}")
        await interaction.followup.send("❌ An error occurred while configuring the stats channel.")

async def update_guild_leaderboard(guild_id: int):
    """Update leaderboard for a specific guild"""
    try:
        config = await bot.db.get_stats_channel(guild_id)
        if not config:
            return
        
        channel_id, message_id = config
        channel = bot.get_channel(channel_id)
        if not channel:
            logger.error(f"Could not find stats channel {channel_id} for guild {guild_id}")
            return
        
        guild = bot.get_guild(guild_id)
        if not guild:
            logger.error(f"Could not find guild {guild_id}")
            return
        
        # Get all users and filter for this guild
        all_users = await bot.db.get_all_users()
        guild_users = []
        
        for discord_id, iracing_username, customer_id in all_users:
            member = guild.get_member(discord_id)
            if member and customer_id:  # Only include users who are in this guild
                guild_users.append((discord_id, iracing_username, customer_id))
        
        if not guild_users:
            # No users in this guild, create empty leaderboard
            embed = discord.Embed(
                title=f"🏁 {guild.name} iRacing Leaderboard (Road)",
                color=discord.Color.blue(),
                timestamp=discord.utils.utcnow()
            )
            embed.description = "No linked accounts found. Use `/link` to add your iRacing account!"
            embed.set_footer(text="Updates every 30 minutes")
        else:
            leaderboard_data = []
            
            for discord_id, iracing_username, customer_id in guild_users:
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
                title=f"🏁 {guild.name} iRacing Leaderboard (Road)",
                color=discord.Color.blue(),
                timestamp=discord.utils.utcnow()
            )
            
            if leaderboard_data:
                leaderboard_text = ""
                for i, data in enumerate(leaderboard_data[:10], 1):
                    member = guild.get_member(data['discord_id'])
                    display_name = member.display_name if member else data['iracing_username']
                    
                    leaderboard_text += f"{i}. **{display_name}** ({data['iracing_username']})\n"
                    leaderboard_text += f"   iRating: {data['irating']} | SR: {data['safety_rating']:.2f} | License: {data['license_level']}\n\n"
                
                embed.description = leaderboard_text
            else:
                embed.description = "No linked accounts found. Use `/link` to add your iRacing account!"
            
            embed.set_footer(text="Updates every 30 minutes")
        
        # Try to update existing message first
        if message_id:
            try:
                message = await channel.fetch_message(message_id)
                await message.edit(embed=embed)
                return
            except discord.NotFound:
                # Message was deleted, clear the message_id
                await bot.db.update_stats_message_id(guild_id, None)
        
        # Clear channel of bot messages and post new one
        async for message in channel.history(limit=100):
            if message.author == bot.user:
                await message.delete()
        
        new_message = await channel.send(embed=embed)
        await bot.db.update_stats_message_id(guild_id, new_message.id)
        
    except Exception as e:
        logger.error(f"Error updating leaderboard for guild {guild_id}: {e}")

@tasks.loop(minutes=30)
async def update_leaderboard():
    """Update leaderboards for all configured guilds"""
    try:
        guild_configs = await bot.db.get_all_guild_configs()
        for guild_id, channel_id, message_id in guild_configs:
            await update_guild_leaderboard(guild_id)
    except Exception as e:
        logger.error(f"Error in leaderboard update loop: {e}")

bot.update_leaderboard = update_leaderboard

if __name__ == "__main__":
    token = os.getenv('DISCORD_TOKEN')
    if not token:
        logger.error("DISCORD_TOKEN environment variable not set")
        exit(1)
    
    bot.run(token)