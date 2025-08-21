import { Client, GatewayIntentBits, SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, AutocompleteInteraction, PermissionFlagsBits, TextChannel } from 'discord.js';
import { config } from 'dotenv';
import { Database, OfficialSeries, TrackCarCombo, LapTimeRecord } from './database';
import { iRacingClient, Series, BestLapTime } from './iracing-client';

config();

class iRacingBot {
    private client: Client;
    private db: Database;
    private iracing: iRacingClient;
    private seriesUpdateInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        this.db = new Database();
        this.iracing = new iRacingClient();
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.registerSlashCommands();
            await this.updateOfficialSeries();
            this.startSeriesUpdateTimer();
            this.startLapTimeUpdateTimer();
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                try {
                    switch (interaction.commandName) {
                        case 'link':
                            await this.handleLinkCommand(interaction);
                            break;
                        case 'unlink':
                            await this.handleUnlinkCommand(interaction);
                            break;
                        case 'track':
                            await this.handleTrackCommand(interaction);
                            break;
                        case 'untrack':
                            await this.handleUntrackCommand(interaction);
                            break;
                    }
                } catch (error) {
                    console.error('Error handling interaction:', error);
                    try {
                        await interaction.reply({ content: 'An error occurred.', ephemeral: true });
                    } catch (replyError) {
                        console.error('Failed to send error message:', replyError);
                    }
                }
            } else if (interaction.isAutocomplete()) {
                try {
                    if (interaction.commandName === 'track') {
                        await this.handleTrackAutocomplete(interaction);
                    }
                } catch (error) {
                    console.error('Error handling autocomplete:', error);
                }
            }
        });
    }

    private async registerSlashCommands(): Promise<void> {
        const commands = [
            new SlashCommandBuilder()
                .setName('link')
                .setDescription('Link a Discord account to an iRacing account')
                .addIntegerOption(option =>
                    option.setName('customer_id')
                        .setDescription('iRacing Customer ID')
                        .setRequired(true))
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to link (admin only - leave blank to link yourself)')
                        .setRequired(false)),

            new SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink your iRacing account from Discord'),
                
            new SlashCommandBuilder()
                .setName('track')
                .setDescription('Set this channel to display top lap times for an official series')
                .addStringOption(option =>
                    option.setName('series')
                        .setDescription('Select an official iRacing series')
                        .setRequired(true)
                        .setAutocomplete(true)),

            new SlashCommandBuilder()
                .setName('untrack')
                .setDescription('Remove series tracking from this channel')
        ];

        try {
            console.log('Registering slash commands...');
            await this.client.application?.commands.set(commands);
            console.log('Slash commands registered successfully');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    private isServerAdmin(interaction: ChatInputCommandInteraction): boolean {
        if (!interaction.guild || !interaction.member) return false;
        
        const member = interaction.member;
        if ('permissions' in member && member.permissions) {
            // Handle both string and PermissionsBitField types
            if (typeof member.permissions === 'string') {
                return false; // String permissions don't support .has()
            }
            return member.permissions.has(PermissionFlagsBits.Administrator);
        }
        
        return false;
    }

    private async handleLinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const customerId = interaction.options.getInteger('customer_id', true);
        const targetUser = interaction.options.getUser('user');
        
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            
            // Check admin permissions if linking another user
            if (targetUser && targetUser.id !== interaction.user.id) {
                if (!this.isServerAdmin(interaction)) {
                    await interaction.editReply({ content: '❌ Only server administrators can link other users.' });
                    return;
                }
            }
            
            // Determine which user to link
            const userToLink = targetUser || interaction.user;
            
            // Get member info from iRacing API
            const memberInfo = await this.iracing.getMemberSummary(customerId);
            
            console.log('Member info response:', memberInfo);
            
            if (!memberInfo) {
                await interaction.editReply({ content: `❌ Could not find iRacing member with Customer ID: ${customerId}` });
                return;
            }

            // Use display_name or fall back to a default
            const displayName = memberInfo.display_name || `User ${customerId}`;
            
            // Save to database
            await this.db.linkUser(userToLink.id, displayName, customerId);
            
            // Create success response
            const isLinkingOther = targetUser && targetUser.id !== interaction.user.id;
            const response = isLinkingOther 
                ? `✅ Linked <@${userToLink.id}> to **${displayName}** (Customer ID: ${customerId})`
                : `✅ Linked <@${userToLink.id}> to **${displayName}** (Customer ID: ${customerId})`;
            
            await interaction.editReply({ content: response });
        } catch (error) {
            console.error('Error linking account:', error);
            await interaction.editReply({ content: '❌ An error occurred while linking the account.' });
        }
    }

    private async handleUnlinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const wasLinked = await this.db.unlinkUser(interaction.user.id);
            
            if (wasLinked) {
                await interaction.reply({ content: '✅ Successfully unlinked your account.', flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: '❌ No linked account found.', flags: [MessageFlags.Ephemeral] });
            }
        } catch (error) {
            console.error('Error unlinking account:', error);
            await interaction.reply({ content: '❌ An error occurred while unlinking the account.', flags: [MessageFlags.Ephemeral] });
        }
    }

    private async handleUntrackCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await interaction.deferReply();
            
            if (!interaction.channel) {
                await interaction.editReply({ content: '❌ This command must be used in a channel.' });
                return;
            }
            
            // Check if channel is currently being tracked
            const channelTrack = await this.db.getChannelTrack(interaction.channel.id);
            
            if (!channelTrack) {
                await interaction.editReply({ content: '❌ This channel is not currently tracking any series.' });
                return;
            }
            
            // Remove the channel tracking
            const wasRemoved = await this.db.removeChannelTrack(interaction.channel.id);
            
            if (wasRemoved) {
                // Clear all existing messages in the channel
                if (interaction.channel instanceof TextChannel) {
                    try {
                        console.log(`Clearing messages in channel ${interaction.channel.name} after untracking`);
                        const messages = await interaction.channel.messages.fetch({ limit: 100 });
                        const messagesToDelete = messages.filter(msg => !msg.pinned && msg.id !== interaction.id);
                        
                        if (messagesToDelete.size > 0) {
                            await interaction.channel.bulkDelete(messagesToDelete, true);
                            console.log(`Deleted ${messagesToDelete.size} messages from untracked channel`);
                        }
                    } catch (error) {
                        console.error('Error clearing channel messages:', error);
                    }
                }
                
                await interaction.editReply({ 
                    content: `✅ Removed series tracking from this channel.\n\n**${channelTrack.series_name}** is no longer being tracked here. All leaderboard messages have been cleared.` 
                });
            } else {
                await interaction.editReply({ content: '❌ Failed to remove channel tracking.' });
            }
        } catch (error) {
            console.error('Error removing channel track:', error);
            await interaction.editReply({ content: '❌ An error occurred while removing channel tracking.' });
        }
    }

    async start(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }

        await this.client.login(token);
    }

    private async updateOfficialSeries(): Promise<void> {
        try {
            console.log('Updating official series data...');
            const officialSeries = await this.iracing.getOfficialSeries();
            
            if (officialSeries && officialSeries.length > 0) {
                const seriesData: OfficialSeries[] = officialSeries.map(series => ({
                    series_id: series.series_id,
                    series_name: series.series_name,
                    series_short_name: series.series_short_name,
                    category: series.category,
                    category_id: series.category_id,
                    last_updated: new Date().toISOString()
                }));
                
                await this.db.updateOfficialSeries(seriesData);
                console.log(`Updated ${seriesData.length} official series`);
            }
        } catch (error) {
            console.error('Error updating official series:', error);
        }
    }
    
    private startSeriesUpdateTimer(): void {
        this.seriesUpdateInterval = setInterval(async () => {
            await this.updateOfficialSeries();
        }, 24 * 60 * 60 * 1000); // Update every 24 hours
    }
    
    private startLapTimeUpdateTimer(): void {
        // Update lap times every hour
        setInterval(async () => {
            await this.updateChannelLapTimes();
        }, 60 * 60 * 1000);
        
        // Initial update after 30 seconds
        setTimeout(async () => {
            await this.updateChannelLapTimes();
        }, 30000);
    }
    
    private async handleTrackAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const allSeries = await this.db.getOfficialSeries();
        
        const filtered = allSeries
            .filter(series => 
                series.series_name.toLowerCase().includes(focusedValue) ||
                series.series_short_name.toLowerCase().includes(focusedValue) ||
                series.category.toLowerCase().includes(focusedValue)
            )
            .slice(0, 25)
            .map(series => ({
                name: `${series.series_name} (${series.category})`,
                value: series.series_id.toString()
            }));
        
        await interaction.respond(filtered);
    }
    
    private async handleTrackCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const seriesId = parseInt(interaction.options.getString('series', true));
        
        try {
            await interaction.deferReply();
            
            const allSeries = await this.db.getOfficialSeries();
            const selectedSeries = allSeries.find(s => s.series_id === seriesId);
            
            if (!selectedSeries) {
                await interaction.editReply({ content: '❌ Invalid series selected. Please use the autocomplete to select a valid series.' });
                return;
            }
            
            if (!interaction.channel) {
                await interaction.editReply({ content: '❌ This command must be used in a channel.' });
                return;
            }
            
            await this.db.setChannelTrack(
                interaction.channel.id,
                interaction.guildId!,
                selectedSeries.series_id,
                selectedSeries.series_name
            );
            
            const response = `✅ This channel is now tracking **${selectedSeries.series_name}** lap times.\n\nChannel messages will be cleared and lap time leaderboards will appear here for tracked events.`;
            
            await interaction.editReply({ content: response });
            
            // Clear all existing messages in the channel after replying
            if (interaction.channel instanceof TextChannel) {
                try {
                    console.log(`Clearing messages in channel ${interaction.channel.name} for series tracking`);
                    // Wait a moment to ensure the reply is sent
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const messages = await interaction.channel.messages.fetch({ limit: 100 });
                    const messagesToDelete = messages.filter(msg => !msg.pinned);
                    
                    if (messagesToDelete.size > 0) {
                        await interaction.channel.bulkDelete(messagesToDelete, true);
                        console.log(`Deleted ${messagesToDelete.size} messages from tracked channel`);
                    }
                } catch (error) {
                    console.error('Error clearing channel messages:', error);
                }
            }
        } catch (error) {
            console.error('Error setting channel track:', error);
            await interaction.editReply({ content: '❌ An error occurred while setting up channel tracking.' });
        }
    }

    private async updateChannelLapTimes(): Promise<void> {
        console.log('Starting lap time update cycle...');
        
        try {
            const trackedChannels = await this.db.getAllChannelTracks();
            
            for (const channelTrack of trackedChannels) {
                console.log(`Updating lap times for channel ${channelTrack.channel_id}, series: ${channelTrack.series_name}`);
                
                // Use simplified approach with common track/car combos
                await this.updateChannelWithCommonCombos(channelTrack);
            }
            
            console.log('Lap time update cycle completed');
        } catch (error) {
            console.error('Error during lap time update cycle:', error);
        }
    }
    
    private async updateChannelWithCommonCombos(channelTrack: any): Promise<void> {
        try {
            console.log(`Processing series ${channelTrack.series_id} (${channelTrack.series_name})`);
            
            // First, try to get existing track/car combinations from the database for this series
            const existingCombos = await this.db.getTrackCarCombosBySeriesId(channelTrack.series_id);
            
            if (existingCombos && existingCombos.length > 0) {
                console.log(`Found ${existingCombos.length} existing track/car combinations for series ${channelTrack.series_id}`);
                
                const leaderboards = [];
                
                // Process existing combinations
                for (const combo of existingCombos) {
                    await this.updateLapTimesForCombo(combo.id!, combo);
                    
                    // Get leaderboard for this combo
                    const topTimes = await this.db.getTopLapTimesForCombo(combo.id!, 10);
                    if (topTimes.length > 0) {
                        leaderboards.push({
                            combo: combo,
                            times: topTimes
                        });
                    }
                }
                
                // Update Discord channel with leaderboards
                if (leaderboards.length > 0) {
                    await this.updateChannelMessages(channelTrack.channel_id, leaderboards);
                    console.log(`Posted ${leaderboards.length} leaderboards for series ${channelTrack.series_name}`);
                } else {
                    console.log(`No lap time data available for existing combinations in series ${channelTrack.series_name}`);
                }
                
                return;
            }
            
            // If no existing combinations, post a message indicating the series is being tracked
            console.log(`No existing combinations found for series ${channelTrack.series_id}, posting tracking message`);
            
            await this.postTrackingMessage(channelTrack.channel_id, channelTrack.series_name);
            
        } catch (error) {
            console.error(`Error updating channel with combos for ${channelTrack.series_name}:`, error);
        }
    }
    
    private async updateChannelMessages(channelId: string, leaderboards: any[]): Promise<void> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel || !(channel instanceof TextChannel)) return;
            
            console.log(`Updating messages in channel ${channel.name}`);
            
            // Clear all existing messages (except pinned)
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesToDelete = messages.filter(msg => !msg.pinned);
            if (messagesToDelete.size > 0) {
                await channel.bulkDelete(messagesToDelete, true);
                console.log(`Deleted ${messagesToDelete.size} old messages`);
            }
            
            // Send new leaderboard messages
            for (const leaderboard of leaderboards) {
                const messageContent = this.formatLeaderboard(leaderboard.combo, leaderboard.times);
                await channel.send(messageContent);
                console.log(`Posted leaderboard for ${leaderboard.combo.track_name} - ${leaderboard.combo.car_name}`);
            }
            
        } catch (error) {
            console.error(`Error updating messages in channel ${channelId}:`, error);
        }
    }
    
    private async updateLapTimesForCombo(comboId: number, combo: TrackCarCombo): Promise<void> {
        const guildUsers = await this.db.getAllLinkedUsers();
        
        for (const user of guildUsers) {
            if (user.iracing_customer_id) {
                try {
                    const bestTimes = await this.iracing.getMemberBestForTrack(
                        user.iracing_customer_id,
                        combo.track_id,
                        combo.car_id
                    );
                    
                    if (bestTimes.length > 0) {
                        const bestTime = bestTimes[0]; // Get the fastest lap
                        
                        if (bestTime) {
                            const record: LapTimeRecord = {
                                combo_id: comboId,
                                discord_id: user.discord_id,
                                iracing_customer_id: user.iracing_customer_id,
                                iracing_username: user.iracing_username,
                                lap_time_microseconds: bestTime.best_lap_time,
                                subsession_id: bestTime.subsession_id,
                                event_type: bestTime.event_type,
                                recorded_at: bestTime.end_time,
                                last_updated: new Date().toISOString()
                            };
                            
                            await this.db.upsertLapTimeRecord(record);
                        }
                    }
                } catch (error) {
                    console.error(`Error updating lap times for user ${user.iracing_username}:`, error);
                }
            }
        }
    }
    
    
    private async postTrackingMessage(channelId: string, seriesName: string): Promise<void> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel || !(channel instanceof TextChannel)) return;
            
            console.log(`Posting tracking message in channel ${channel.name}`);
            
            // Clear all existing messages (except pinned)
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesToDelete = messages.filter(msg => !msg.pinned);
            if (messagesToDelete.size > 0) {
                await channel.bulkDelete(messagesToDelete, true);
                console.log(`Deleted ${messagesToDelete.size} old messages`);
            }
            
            // Use Discord timestamp formatting for relative time display
            const timestamp = Math.floor(Date.now() / 1000);
            const trackingMessage = `**🏁 ${seriesName}**\n\n📊 This channel is now tracking lap times for this series.\n\nLeaderboards will appear here once lap time data becomes available.\n\n*Last updated: <t:${timestamp}:R>*`;
            
            await channel.send(trackingMessage);
            console.log(`Posted tracking message for series ${seriesName}`);
            
        } catch (error) {
            console.error(`Error posting tracking message in channel ${channelId}:`, error);
        }
    }
    
    private formatLeaderboard(combo: TrackCarCombo, lapTimes: LapTimeRecord[]): string {
        let leaderboard = `**🏁 ${combo.track_name}** (${combo.config_name})\n`;
        leaderboard += `**🏎️ ${combo.car_name}**\n\n`;
        
        lapTimes.forEach((record, index) => {
            const position = index + 1;
            const emoji = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : '🏁';
            const lapTime = this.iracing.formatLapTime(record.lap_time_microseconds);
            
            leaderboard += `${emoji} **${position}.** <@${record.discord_id}> - \`${lapTime}\`\n`;
        });
        
        // Use Discord timestamp formatting for relative time display
        const timestamp = Math.floor(Date.now() / 1000);
        leaderboard += `\n*Last updated: <t:${timestamp}:R>*`;
        
        return leaderboard;
    }

    async stop(): Promise<void> {
        if (this.seriesUpdateInterval) {
            clearInterval(this.seriesUpdateInterval);
        }
        this.db.close();
        await this.client.destroy();
    }
}

// Start the bot
const bot = new iRacingBot();

bot.start().catch(error => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});
