import { Client, GatewayIntentBits, SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, AutocompleteInteraction, PermissionFlagsBits, TextChannel, AttachmentBuilder } from 'discord.js';
import { config } from 'dotenv';
import { Database, OfficialSeries, TrackCarCombo, LapTimeRecord } from './database';
import { iRacingClient, Series, BestLapTime } from './iracing-client';
import { LeaderboardEmbedBuilder, LeaderboardEmbedOptions } from './leaderboard-embed-builder';
import axios from 'axios';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

config();

class iRacingBot {
    private client: Client;
    private db: Database;
    private iracing: iRacingClient;
    private seriesUpdateInterval: NodeJS.Timeout | null = null;
    private channelMessageMap: Map<string, string> = new Map();
    private embedBuilder: LeaderboardEmbedBuilder;
    private imageCacheDir: string;
    private memoryImageCache: Map<string, Buffer> = new Map();

    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        this.db = new Database();
        this.iracing = new iRacingClient();
        this.embedBuilder = new LeaderboardEmbedBuilder();
        this.imageCacheDir = path.resolve('data/cache/images');
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.ensureImageCacheDir();
            await this.registerSlashCommands();
            await this.updateOfficialSeries();
            // Prepare tracked channels: clear messages and post base message
            await this.prepareTrackedChannelsOnStartup();
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
                .setDescription('Unlink your iRacing account from Discord')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to unlink (admin only - leave blank to unlink yourself)')
                        .setRequired(false)
                ),
                
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
            const targetUser = interaction.options.getUser('user');

            // If unlinking someone else, require admin
            if (targetUser && targetUser.id !== interaction.user.id) {
                if (!this.isServerAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Only server administrators can unlink other users.', flags: [MessageFlags.Ephemeral] });
                    return;
                }
            }

            const userToUnlink = targetUser || interaction.user;

            const wasLinked = await this.db.unlinkUser(userToUnlink.id);

            if (wasLinked) {
                const response = (targetUser && targetUser.id !== interaction.user.id)
                    ? `✅ Successfully unlinked <@${userToUnlink.id}>.`
                    : '✅ Successfully unlinked your account.';
                await interaction.reply({ content: response, flags: [MessageFlags.Ephemeral] });
            } else {
                const response = (targetUser && targetUser.id !== interaction.user.id)
                    ? `❌ No linked account found for <@${userToUnlink.id}>.`
                    : '❌ No linked account found.';
                await interaction.reply({ content: response, flags: [MessageFlags.Ephemeral] });
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

    private async prepareTrackedChannelsOnStartup(): Promise<void> {
        try {
            const trackedChannels = await this.db.getAllChannelTracks();
            for (const channelTrack of trackedChannels) {
                const channel = await this.client.channels.fetch(channelTrack.channel_id);
                if (!channel || !(channel instanceof TextChannel)) continue;

                try {
                    const messages = await channel.messages.fetch({ limit: 100 });
                    const messagesToDelete = messages.filter(m => !m.pinned);
                    if (messagesToDelete.size > 0) {
                        await channel.bulkDelete(messagesToDelete, true);
                        console.log(`Startup: deleted ${messagesToDelete.size} messages in #${channel.name}`);
                    }
                } catch (err) {
                    console.error('Error clearing channel on startup:', err);
                }

                // Post base tracking message and store its ID (embed)
                const baseEmbeds = this.embedBuilder.build(channelTrack.series_name, []);
                const msg = await channel.send({ embeds: baseEmbeds.slice(0, 10) });
                this.channelMessageMap.set(channel.id, msg.id);
            }
        } catch (error) {
            console.error('Error preparing tracked channels on startup:', error);
        }
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
                    // Post the base tracking message and store it
                    await this.postTrackingMessage(interaction.channel.id, selectedSeries.series_name);
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
                
                // Determine current/next active track for this series, and filter combos to that track only
                const currentTrack = await this.iracing.getCurrentOrNextEventForSeries(channelTrack.series_id);
                let combosToProcess = existingCombos;
                if (currentTrack?.track_id) {
                    combosToProcess = existingCombos.filter(c => c.track_id === currentTrack.track_id && (!currentTrack.config_name || c.config_name === currentTrack.config_name));
                    console.log(`Filtered to ${combosToProcess.length} combos for current track_id=${currentTrack.track_id}`);
                } else {
                    console.log('No current track found for series; ignoring old combos');
                    combosToProcess = [];
                }

                const leaderboards: { combo: TrackCarCombo; times: LapTimeRecord[] }[] = [];
                
                // Process filtered combinations
                for (const combo of combosToProcess) {
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
                
                // Resolve images for current track + first car (if any)
                let embedOptions: LeaderboardEmbedOptions = await this.resolveEmbedImagesForCurrent(combosToProcess);
                if (currentTrack?.track_id && combosToProcess.length === 0) {
                    // If we filtered to none (e.g., no data yet), still try to show track image for current week
                    try {
                        const [trackUrl, mapActiveUrl] = await Promise.all([
                            this.iracing.getTrackImageUrl(currentTrack.track_id),
                            this.iracing.getTrackMapActiveUrl(currentTrack.track_id)
                        ]);
                        if (trackUrl) embedOptions.trackImageUrl = trackUrl;
                        if (mapActiveUrl) embedOptions.trackMapActiveUrl = mapActiveUrl;
                    } catch {}
                }
                // Update Discord channel with a single consolidated message (edit in place)
                await this.updateChannelSingleMessage(channelTrack.channel_id, channelTrack.series_name, leaderboards, embedOptions);
                console.log(`Updated consolidated message for series ${channelTrack.series_name}`);
                
                return;
            }
            
            // If no existing combinations, post a message indicating the series is being tracked
            console.log(`No existing combinations found for series ${channelTrack.series_id}, posting tracking message`);
            
            await this.postTrackingMessage(channelTrack.channel_id, channelTrack.series_name);
            
        } catch (error) {
            console.error(`Error updating channel with combos for ${channelTrack.series_name}:`, error);
        }
    }
    
    private async updateChannelSingleMessage(channelId: string, seriesName: string, leaderboards: any[], options?: LeaderboardEmbedOptions): Promise<void> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel || !(channel instanceof TextChannel)) return;
            let files: AttachmentBuilder[] | undefined;
            let embedOptions = options;
            // If we have a trackMapActiveUrl that is a remote URL, rasterize to PNG and attach
            if (options?.trackMapActiveUrl && !options.trackMapActiveUrl.startsWith('attachment://')) {
                try {
                    const png = await this.getRasterizedPng(options.trackMapActiveUrl);
                    const attachmentName = 'track-map.png';
                    files = [new AttachmentBuilder(png, { name: attachmentName })];
                    embedOptions = { ...options, trackMapActiveUrl: `attachment://${attachmentName}` };
                } catch (e) {
                    console.warn('Failed to rasterize SVG, falling back to remote URL:', e);
                }
            }
            const embeds = this.embedBuilder.build(seriesName, leaderboards, embedOptions);

            const messageId = this.channelMessageMap.get(channelId);
            if (messageId) {
                try {
                    const msg = await channel.messages.fetch(messageId);
                    await msg.edit({ embeds: embeds.slice(0, 10), files });
                    return;
                } catch (e) {
                    console.warn(`Failed to fetch/edit existing message ${messageId} in ${channelId}, sending new one.`, e);
                    this.channelMessageMap.delete(channelId);
                }
            }

            // If no message tracked or editing failed, send a new one (no wiping here)
            const newMsg = await channel.send({ embeds: embeds.slice(0, 10), files });
            this.channelMessageMap.set(channelId, newMsg.id);
        } catch (error) {
            console.error(`Error updating consolidated message in channel ${channelId}:`, error);
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
        // Post or edit the base message without clearing; startup handles wiping
        // Try to attach current track/car images when possible
        const embedOptions: LeaderboardEmbedOptions = await this.resolveEmbedImagesForCurrent([]);
        await this.updateChannelSingleMessage(channelId, seriesName, [], embedOptions);
        console.log(`Ensured base tracking message for series ${seriesName}`);
    }

    private async resolveEmbedImagesForCurrent(combos: TrackCarCombo[]): Promise<LeaderboardEmbedOptions> {
        const opts: LeaderboardEmbedOptions = {};
        try {
            // Track image from the first combo's track if available
            if (combos.length > 0) {
                const first = combos[0]!;
                const tId = first.track_id;
                const [trackUrl, mapActiveUrl] = await Promise.all([
                    this.iracing.getTrackImageUrl(tId),
                    this.iracing.getTrackMapActiveUrl(tId)
                ]);
                if (trackUrl) opts.trackImageUrl = trackUrl;
                if (mapActiveUrl) opts.trackMapActiveUrl = mapActiveUrl;
                const cId = first.car_id;
                const carUrl = await this.iracing.getCarImageUrl(cId);
                if (carUrl) opts.carImageUrl = carUrl;
            } else {
                // If no combos provided, try to determine series from a tracked channel and use series schedule
                // No-op here; we keep opts empty to avoid extra calls without context
            }
        } catch (e) {
            console.warn('Failed to resolve embed images:', e);
        }
        return opts;
    }

    private async ensureImageCacheDir(): Promise<void> {
        try {
            await fs.mkdir(this.imageCacheDir, { recursive: true });
        } catch {}
    }

    private hashUrl(url: string): string {
        return createHash('sha256').update(url).digest('hex');
    }

    private async getRasterizedPng(svgUrl: string): Promise<Buffer> {
        const key = this.hashUrl(svgUrl);
        // In-memory cache
        const inMem = this.memoryImageCache.get(key);
        if (inMem) return inMem;

        await this.ensureImageCacheDir();
        const filePath = path.join(this.imageCacheDir, `${key}.png`);
        try {
            const onDisk = await fs.readFile(filePath);
            this.memoryImageCache.set(key, onDisk);
            return onDisk;
        } catch {}

        // Fetch and rasterize
        const res = await axios.get(svgUrl, { responseType: 'arraybuffer' });
        const input = Buffer.from(res.data);
        const png = await sharp(input, { density: 300 })
            .png({ compressionLevel: 9 })
            .resize({ width: 1280, withoutEnlargement: true })
            .toBuffer();
        // Save to disk and memory
        try { await fs.writeFile(filePath, png); } catch {}
        this.memoryImageCache.set(key, png);
        return png;
    }
    
    // Plain text builders removed in favor of rich embeds

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
