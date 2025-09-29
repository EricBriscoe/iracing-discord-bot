import { Client, GatewayIntentBits, SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, TextChannel, EmbedBuilder, AttachmentBuilder, Message, Collection, ButtonBuilder, ButtonStyle, ActionRowBuilder, ButtonInteraction } from 'discord.js';
import axios from 'axios';
import sharp from 'sharp';
import { config } from 'dotenv';
import { Database, OfficialSeries, RaceResult, RaceLogChannel } from './database';
import { iRacingClient, Series } from './iracing-client';

config();

class iRacingBot {
    private client: Client;
    private db: Database;
    private iracing: iRacingClient;
    private seriesUpdateInterval: NodeJS.Timeout | null = null;
    private raceResultUpdateInterval: NodeJS.Timeout | null = null;

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
            await this.rebuildRaceLogsOnStartup();
            this.startRaceResultUpdateTimer();
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
                        case 'race-log':
                            await this.handleRaceLogCommand(interaction);
                            break;
                        case 'history':
                            await this.handleHistoryCommand(interaction);
                            break;
                        case 'prompt':
                            await this.handlePromptCommand(interaction);
                            break;
                        case 'cleanprompt':
                            await this.handleCleanPromptCommand(interaction);
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
            } else if (interaction.isButton()) {
                try {
                    await this.handleHistoryButton(interaction);
                } catch (error) {
                    console.error('Error handling button interaction:', error);
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
                .setName('race-log')
                .setDescription('Set this channel to receive race result notifications for tracked members')
            ,
            new SlashCommandBuilder()
                .setName('history')
                .setDescription('Show your % over WR history for all cars on a track, with range & track navigation')
            ,
            new SlashCommandBuilder()
                .setName('prompt')
                .setDescription('Add a server-specific prompt line prepended to AI race summaries')
                .addStringOption(option =>
                    option.setName('text')
                        .setDescription('Prompt line to add (recommended under 300 chars)')
                        .setRequired(true)
                ),
            new SlashCommandBuilder()
                .setName('cleanprompt')
                .setDescription('Delete all server-specific prompt additions (admin only)')
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
            if (typeof member.permissions === 'string') {
                return false;
            }
            return member.permissions.has(PermissionFlagsBits.Administrator);
        }
        
        return false;
    }

    private async handlePromptCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: [MessageFlags.Ephemeral] });
            return;
        }
        const text = (interaction.options.getString('text', true) || '').trim();
        if (!text || text.length < 2) {
            await interaction.reply({ content: 'Please provide a non-empty prompt.', flags: [MessageFlags.Ephemeral] });
            return;
        }
        const content = text.length > 1000 ? text.slice(0, 1000) : text;
        try {
            await this.db.addGuildPrompt(interaction.guildId, content);
            const all = await this.db.getGuildPrompts(interaction.guildId);
            await interaction.reply({ content: `✅ Added. This server now has ${all.length} prompt line(s) that will be prepended to AI summaries.`, flags: [MessageFlags.Ephemeral] });
        } catch (e) {
            console.error('prompt add failed:', e);
            await interaction.reply({ content: '❌ Failed to add prompt.', flags: [MessageFlags.Ephemeral] });
        }
    }

    private async handleCleanPromptCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: [MessageFlags.Ephemeral] });
            return;
        }
        if (!this.isServerAdmin(interaction)) {
            await interaction.reply({ content: '❌ Only server administrators can clean prompts.', flags: [MessageFlags.Ephemeral] });
            return;
        }
        try {
            const removed = await this.db.clearGuildPrompts(interaction.guildId);
            await interaction.reply({ content: `🧹 Cleared ${removed} prompt line(s) for this server.`, flags: [MessageFlags.Ephemeral] });
        } catch (e) {
            console.error('cleanprompt failed:', e);
            await interaction.reply({ content: '❌ Failed to clear prompts.', flags: [MessageFlags.Ephemeral] });
        }
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

    private async handleRaceLogCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await interaction.deferReply();
            
            if (!interaction.channel) {
                await interaction.editReply({ content: '❌ This command must be used in a channel.' });
                return;
            }

            // Check admin permissions
            if (!this.isServerAdmin(interaction)) {
                await interaction.editReply({ content: '❌ Only server administrators can set race log channels.' });
                return;
            }
            
            // Check if channel is already set as race log
            const existingRaceLogChannel = await this.db.getRaceLogChannel(interaction.channel.id);
            
            if (existingRaceLogChannel) {
                await interaction.editReply({ content: '❌ This channel is already configured as a race log channel.' });
                return;
            }
            
            // Set the channel as race log channel
            await this.db.setRaceLogChannel(interaction.channel.id, interaction.guildId!);
            
            const embed = new EmbedBuilder()
                .setTitle('🏁 Race Log Channel Configured')
                .setDescription('This channel will now receive race result notifications for all tracked guild members.')
                .setColor(0x00AE86)
                .addFields(
                    { name: 'What happens next?', value: 'New race results for linked members will be posted here automatically.' },
                    { name: 'How to link members?', value: 'Use `/link` command to link Discord accounts to iRacing accounts.' }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error setting race log channel:', error);
            await interaction.editReply({ content: '❌ An error occurred while setting up the race log channel.' });
        }
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

    private startRaceResultUpdateTimer(): void {
        // Check for new race results every 10 minutes
        this.raceResultUpdateInterval = setInterval(async () => {
            await this.checkForNewRaceResults();
        }, 10 * 60 * 1000);
        
        // Initial check after 30 seconds
        setTimeout(async () => {
            await this.checkForNewRaceResults();
        }, 30000);
    }

    private async checkForNewRaceResults(): Promise<void> {
        console.log('Checking for new race results...');
        
        try {
            const linkedUsers = await this.db.getAllLinkedUsers();
            
            for (const user of linkedUsers) {
                if (user.iracing_customer_id) {
                    await this.updateRaceResultsForUser(user);
                }
            }
            
            console.log('Race result check completed');
        } catch (error) {
            console.error('Error during race result check:', error);
        }
    }

    private async updateRaceResultsForUser(user: any): Promise<void> {
        try {
            // Use member_recent_races which already filters to actual races
            const recentRaces = await this.iracing.getMemberRecentRaces(user.iracing_customer_id);

            if (recentRaces && recentRaces.length > 0) {
                for (const race of recentRaces) {
                    // Check if we already have this result
                    const exists = await this.db.getRaceResultExists(race.subsession_id, user.discord_id);
                    if (!exists) {
                        await this.processNewRaceResult(race, user);
                    }
                }
            }
        } catch (error) {
            console.error(`Error updating race results for user ${user.iracing_username}:`, error);
        }
    }

    private async processNewRaceResult(raceData: any, user: any): Promise<void> {
        try {
            // Get proper car name from the API
            let carName = raceData.car_name;
            if (!carName && raceData.car_id) {
                carName = await this.iracing.getCarName(raceData.car_id);
            }
            if (!carName) {
                carName = 'Unknown Car';
            }

            // Prefer authoritative positions from subsession detail (finish appears 0-based; start appears 1-based). Normalize to 1-based for storage/display.
            let finalFinishPos: number | undefined = undefined;
            let finalStartPos: number | undefined = undefined;
            try {
                const subsession = await this.iracing.getSubsessionResult(raceData.subsession_id);
                const getType = (sr: any) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
                const raceSession = Array.isArray(subsession?.session_results)
                    ? subsession!.session_results.find((sr: any) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr)))
                    : null;
                const userRow = raceSession?.results?.find((r: any) => r.cust_id === user.iracing_customer_id);
                if (typeof userRow?.finish_position === 'number') finalFinishPos = userRow.finish_position; // likely 0-based
                if (typeof userRow?.starting_position === 'number') finalStartPos = userRow.starting_position; // likely 1-based
            } catch {}

            // Normalize member_recent_races values as well
            const mrFinish = (typeof raceData.finish_position === 'number') ? raceData.finish_position : undefined;
            const mrStart = (typeof raceData.start_position === 'number') ? raceData.start_position : undefined;
            // Finish is 0-based in many list endpoints; adjust to 1-based. Start should be 1-based; nudge 0 to 1.
            const humanFinish = (typeof finalFinishPos === 'number')
                ? (finalFinishPos + 1)
                : (typeof mrFinish === 'number' ? (mrFinish + 1) : undefined);
            const humanStart = (typeof finalStartPos === 'number')
                ? (finalStartPos === 0 ? 1 : finalStartPos)
                : (typeof mrStart === 'number' ? (mrStart === 0 ? 1 : mrStart) : undefined);

            // Create race result record
            const raceResult: RaceResult = {
                subsession_id: raceData.subsession_id,
                discord_id: user.discord_id,
                iracing_customer_id: user.iracing_customer_id,
                iracing_username: user.iracing_username,
                series_id: raceData.series_id,
                series_name: raceData.series_name,
                track_id: raceData.track.track_id,
                track_name: raceData.track.track_name,
                config_name: raceData.track.config_name || '',
                car_id: raceData.car_id,
                car_name: carName,
                start_time: raceData.session_start_time,
                finish_position: (humanFinish as number),
                starting_position: (humanStart as number),
                incidents: raceData.incidents,
                irating_before: raceData.oldi_rating,
                irating_after: raceData.newi_rating,
                license_level_before: raceData.old_sub_level,
                license_level_after: raceData.new_sub_level,
                event_type: 'Race', // member_recent_races only returns actual races
                official_session: true, // member_recent_races only returns official races
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString()
            };

            // Save to database
            await this.db.upsertRaceResult(raceResult);
            
            // Post to race log channels with enhanced data
            await this.postRaceResultToChannels(raceResult, raceData);
            
            console.log(`Processed new race result for ${user.iracing_username}: ${raceResult.series_name} - P${raceResult.finish_position}`);
        } catch (error) {
            console.error(`Error processing race result for ${user.iracing_username}:`, error);
        }
    }

    private getEventTypeName(eventType: number): string {
        const eventTypes: { [key: number]: string } = {
            2: 'Practice',
            3: 'Qualifying',
            4: 'Time Trial',
            5: 'Race'
        };
        return eventTypes[eventType] || 'Unknown';
    }

    private async postRaceResultToChannels(raceResult: RaceResult, raceData: any): Promise<void> {
        try {
            const raceLogChannels = await this.db.getAllRaceLogChannels();
            
            for (const logChannel of raceLogChannels) {
                const channel = await this.client.channels.fetch(logChannel.channel_id);
                if (channel && channel instanceof TextChannel) {
                    const { embed, attachment } = await this.createRaceResultEmbed(raceResult, raceData, logChannel.guild_id);
                    const messageOptions: any = { embeds: [embed], allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } };
                    if (attachment) {
                        messageOptions.files = [attachment];
                    }
                    await channel.send(messageOptions);
                }
            }
        } catch (error) {
            console.error('Error posting race result to channels:', error);
        }
    }

    private async clearRaceLogChannel(channel: TextChannel): Promise<void> {
        try {
            console.log(`Clearing channel ${channel.id} (${channel.name})...`);
            let lastId: string | undefined = undefined;
            const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
            while (true) {
                const batch: Collection<string, Message<boolean>> = await channel.messages.fetch({ limit: 100, before: lastId });
                if (batch.size === 0) break;
                const now = Date.now();
                const nonPinned = batch.filter((m: Message) => !m.pinned);
                const younger = nonPinned.filter((m: Message) => now - m.createdTimestamp < fourteenDaysMs);
                const older = nonPinned.filter((m: Message) => now - m.createdTimestamp >= fourteenDaysMs);
                if (younger.size > 0) {
                    try {
                        await channel.bulkDelete(younger, true);
                    } catch (e) {
                        // Fallback: delete younger individually if bulkDelete fails
                        for (const msg of younger.values()) {
                            try { await msg.delete(); } catch {}
                        }
                    }
                }
                for (const msg of older.values()) {
                    try { await msg.delete(); } catch {}
                }
                lastId = batch.last()?.id;
                if (!lastId || batch.size < 100) break;
            }
            console.log(`Channel ${channel.id} cleared.`);
        } catch (err) {
            console.error(`Failed to clear channel ${channel.id}:`, err);
        }
    }

    private async repostAllFromDatabaseOldestFirst(): Promise<void> {
        try {
            console.log('Reposting all race results from database (oldest → newest)...');
            const results = await this.db.getAllRaceResultsAsc();
            let count = 0;
            for (const result of results) {
                // Build raceData, enriched with subsession details for laps and SoF
                let raceData: any = { car_id: result.car_id, start_position: result.starting_position };
                try {
                    const subsession = await this.iracing.getSubsessionResult(result.subsession_id);
                    if (subsession) {
                        raceData.event_laps_complete = subsession.event_laps_complete;
                        raceData.event_strength_of_field = subsession.event_strength_of_field;
                        // Fallback to user's laps_complete if available
                        const getType = (sr: any) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
                        const raceSession = Array.isArray(subsession.session_results) ? subsession.session_results.find((sr: any) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr))) : null;
                        const userRow = raceSession?.results?.find((r: any) => r.cust_id === result.iracing_customer_id);
                        if (userRow && typeof userRow.laps_complete === 'number') {
                            raceData.laps = userRow.laps_complete;
                        }
                    }
                } catch {}
                await this.postRaceResultToChannels(result, raceData);
                count++;
            }
            console.log(`Reposted ${count} results from database.`);
        } catch (err) {
            console.error('Error while reposting from database:', err);
        }
    }

    private async backfillRecentFromApiOldestFirst(): Promise<void> {
        try {
            console.log('Backfilling recent results from API (oldest → newest)...');
            const linkedUsers = await this.db.getAllLinkedUsers();
            for (const user of linkedUsers) {
                if (!user.iracing_customer_id) continue;
                try {
                    const recent = await this.iracing.getMemberRecentRaces(user.iracing_customer_id);
                    if (!recent || recent.length === 0) continue;
                    // Filter to only races not in DB, then oldest-first
                    const toProcess: any[] = [];
                    for (const race of recent) {
                        const exists = await this.db.getRaceResultExists(race.subsession_id, user.discord_id);
                        if (!exists) toProcess.push(race);
                    }
                    toProcess.sort((a, b) => new Date(a.session_start_time).getTime() - new Date(b.session_start_time).getTime());
                    for (const race of toProcess) {
                        await this.processNewRaceResult(race, user);
                    }
                } catch (e) {
                    console.error(`Backfill error for user ${user.iracing_username}:`, e);
                }
            }
            console.log('API backfill completed.');
        } catch (err) {
            console.error('Error during API backfill:', err);
        }
    }

    private async rebuildRaceLogsOnStartup(): Promise<void> {
        try {
            const raceLogChannels = await this.db.getAllRaceLogChannels();
            if (raceLogChannels.length === 0) return;
            // Clear channels first
            for (const logChannel of raceLogChannels) {
                const channel = await this.client.channels.fetch(logChannel.channel_id);
                if (channel && channel instanceof TextChannel) {
                    await this.clearRaceLogChannel(channel);
                }
            }
            // Repost from DB oldest → newest
            await this.repostAllFromDatabaseOldestFirst();
            // Fill gaps via API oldest → newest
            await this.backfillRecentFromApiOldestFirst();
        } catch (err) {
            console.error('Error rebuilding race logs on startup:', err);
        }
    }

    private async createRaceResultEmbed(result: RaceResult, raceData: any, guildIdForPrompts?: string): Promise<{ embed: EmbedBuilder; attachment?: AttachmentBuilder }> {
        const embed = new EmbedBuilder()
            .setTitle(`🏁 ${result.series_name}`)
            .setColor(this.getPositionColor(result.finish_position))
            .setTimestamp(new Date(result.start_time));

        let attachment: AttachmentBuilder | undefined;

        // Add track map if available
        try {
            const trackMapPath = await this.iracing.getTrackMapActivePng(result.track_id);
            if (trackMapPath) {
                attachment = new AttachmentBuilder(trackMapPath, { name: 'track-map.png' });
                embed.setImage('attachment://track-map.png');
            }
        } catch (error) {
            console.warn('Could not fetch track map:', error);
        }

        // Add car image as thumbnail if available
        try {
            const carImageUrl = await this.iracing.getCarImageUrl(raceData.car_id);
            if (carImageUrl) {
                embed.setThumbnail(carImageUrl);
            }
        } catch (error) {
            console.warn('Could not fetch car image:', error);
        }

        // Legacy field blocks removed — the AI or fallback description will provide a structured summary.

        // Precompute context values for AI and fallback
        let context: any = {};
        try {
            const http = await this.iracing.getHttpClient();
            const subsession = await this.iracing.getSubsessionResult(result.subsession_id);
            const getType = (sr: any) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
            const raceSession = Array.isArray(subsession?.session_results)
                ? subsession!.session_results.find((sr: any) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr)))
                : null;
            const userRow = raceSession?.results?.find((r: any) => r.cust_id === result.iracing_customer_id);
            const simsessionNumber: number = raceSession?.simsession_number ?? 0;

            // Normalize for display: finishPos 1-based, startPos 1-based
            const startPos = (typeof userRow?.starting_position === 'number')
                ? (userRow.starting_position === 0 ? 1 : userRow.starting_position)
                : ((typeof result.starting_position === 'number') ? result.starting_position : (typeof raceData.start_position === 'number' ? (raceData.start_position === 0 ? 1 : raceData.start_position) : undefined));
            const finishPos = (typeof userRow?.finish_position === 'number')
                ? (userRow.finish_position + 1)
                : ((typeof result.finish_position === 'number') ? result.finish_position : (typeof raceData.finish_position === 'number' ? (raceData.finish_position + 1) : undefined));
            const posChange = (typeof startPos === 'number' && typeof finishPos === 'number') ? (startPos - finishPos) : undefined;
            const lapsComplete = (typeof userRow?.laps_complete === 'number')
                ? userRow.laps_complete
                : (typeof subsession?.event_laps_complete === 'number')
                    ? subsession!.event_laps_complete
                    : (typeof raceData.laps === 'number' ? raceData.laps : undefined);
            const sof = (typeof subsession?.event_strength_of_field === 'number')
                ? subsession!.event_strength_of_field
                : (typeof raceData.event_strength_of_field === 'number' ? raceData.event_strength_of_field : undefined);
            const bestLap = (typeof userRow?.best_lap_time === 'number' && userRow.best_lap_time > 0)
                ? { time: this.iracing.formatLapTime(userRow.best_lap_time), lap: userRow.best_lap_num }
                : null;
            const avgLap = (typeof userRow?.average_lap === 'number' && userRow.average_lap > 0)
                ? this.iracing.formatLapTime(userRow.average_lap)
                : null;
            const champPoints = (typeof userRow?.champ_points === 'number') ? userRow.champ_points : (raceData.points ?? undefined);
            const gapToWinner = (typeof userRow?.interval === 'number' && userRow.interval > 0)
                ? this.iracing.formatLapTime(userRow.interval)
                : undefined;
            const irDelta = (typeof result.irating_before === 'number' && typeof result.irating_after === 'number')
                ? (result.irating_after - result.irating_before)
                : undefined;

            // Qualifying details
            let qual: { time?: string; lap?: number; position?: number } | null = null;
            try {
                const qualSession = Array.isArray(subsession?.session_results)
                    ? subsession!.session_results.find((sr: any) => /qual/i.test((sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString()))
                    : null;
                const qualUser = qualSession?.results?.find((r: any) => r.cust_id === result.iracing_customer_id);
                if (qualUser) {
                    const qTime = (typeof qualUser.best_qual_lap_time === 'number' && qualUser.best_qual_lap_time > 0)
                        ? this.iracing.formatLapTime(qualUser.best_qual_lap_time)
                        : undefined;
                    const qLap = (typeof qualUser.best_qual_lap_num === 'number' && qualUser.best_qual_lap_num > 0) ? qualUser.best_qual_lap_num : undefined;
                    const qPos = typeof qualUser.finish_position === 'number' ? (qualUser.finish_position + 1) : undefined;
                    qual = { time: qTime, lap: qLap, position: qPos };
                }
            } catch {}

            // Field context and race-best lap
            let fieldSize: number | undefined;
            let classPos: number | undefined = (typeof userRow?.finish_position_in_class === 'number') ? (userRow.finish_position_in_class + 1) : undefined;
            let raceBestLapTime: string | undefined;
            let wrDeltaPct: number | undefined;
            try {
                if (Array.isArray(raceSession?.results)) {
                    fieldSize = raceSession!.results.length;
                    // best lap in field
                    let min = Number.MAX_SAFE_INTEGER;
                    for (const r of raceSession!.results) {
                        if (typeof r.best_lap_time === 'number' && r.best_lap_time > 0 && r.best_lap_time < min) min = r.best_lap_time;
                    }
                    if (min !== Number.MAX_SAFE_INTEGER) raceBestLapTime = this.iracing.formatLapTime(min);
                }
                // WR delta
                if (result.car_id && result.track_id) {
                    const wr = await this.iracing.getWorldRecordBestLap(result.car_id, result.track_id);
                    if (wr && typeof userRow?.best_lap_time === 'number' && userRow.best_lap_time > 0) {
                        wrDeltaPct = ((userRow.best_lap_time - wr) / wr) * 100;
                    }
                }
            } catch {}

            // Position-by-lap trend (best-effort) via lap_chart_data
            let posTrend: { start?: number; end?: number; min?: number; max?: number } | undefined;
            try {
                const lc = await http.get('/data/results/lap_chart_data', { params: { subsession_id: result.subsession_id, simsession_number: simsessionNumber } });
                const lcd = lc.data?.link ? (await http.get(lc.data.link)).data : lc.data;
                // Heuristic: search for arrays keyed by driver/customer indicating position per lap
                // We will try a few shapes defensively.
                const extractPositions = (data: any): number[] | null => {
                    try {
                        if (!data) return null;
                        // Case 1: data has chunk_info -> fetch first chunk for { laps: [...] }
                        const ci = data?.chunk_info;
                        if (ci && ci.base_download_url && Array.isArray(ci.chunk_file_names) && ci.chunk_file_names.length > 0) {
                            // Fetch and parse first chunk only
                            // Note: we already have http available in scope
                            // But to keep simple and avoid another round trip, skip chunked here.
                            return null;
                        }
                        // Case 2: data.laps is array with entries containing per-car positions per lap
                        if (Array.isArray(data.laps)) {
                            // Look for objects keyed by cust_id or name
                            for (const lap of data.laps) {
                                // Not enough structure certainty; bail out
                                break;
                            }
                            return null;
                        }
                        return null;
                    } catch { return null; }
                };
                const positions = extractPositions(lcd);
                if (Array.isArray(positions) && positions.length > 0) {
                    const s = positions[0];
                    const e = positions[positions.length - 1];
                    const mn = Math.min(...positions);
                    const mx = Math.max(...positions);
                    posTrend = { start: s, end: e, min: mn, max: mx };
                }
            } catch {}

            // Pit stop and cautions from event_log
            let pitStops: number | undefined;
            let cautions: number | undefined;
            try {
                const ev = await http.get('/data/results/event_log', { params: { subsession_id: result.subsession_id, simsession_number: simsessionNumber } });
                const evd = ev.data?.link ? (await http.get(ev.data.link)).data : ev.data;
                const rows: any[] = Array.isArray(evd) ? evd : (Array.isArray(evd?.events) ? evd.events : []);
                let pit = 0; let cau = 0;
                for (const r of rows) {
                    const t = (r?.type || r?.event || '').toString().toLowerCase();
                    if (t.includes('pit')) {
                        // If event has cust_id, count only matching driver; else count all
                        if (!r?.cust_id || r.cust_id === result.iracing_customer_id) pit++;
                    }
                    if (t.includes('caution')) cau++;
                }
                pitStops = pit || undefined;
                cautions = cau || undefined;
            } catch {}
            // Summarize lap events
            let incidentCount = 0;
            const eventCounts = new Map<string, number>();
            const lapAll: Array<{ lap: number; t: number; incident: boolean; events: string[] }> = [];
            try {
                const lapResp = await http.get('/data/results/lap_data', {
                    params: { subsession_id: result.subsession_id, simsession_number: simsessionNumber, cust_id: result.iracing_customer_id }
                });
                const lapMeta = lapResp.data?.link ? (await http.get(lapResp.data.link)).data : lapResp.data;
                const ci = lapMeta?.chunk_info;
                if (ci && ci.base_download_url && Array.isArray(ci.chunk_file_names)) {
                    const base = String(ci.base_download_url).replace(/\/$/, '/');
                    for (const name of ci.chunk_file_names) {
                        const url = base + name;
                        try {
                            const chunk = await http.get(url);
                            const rows: any[] = Array.isArray(chunk.data) ? chunk.data : [];
                            for (const r of rows) {
                                if (r?.lap_number > 0 && r?.incident) incidentCount++;
                                const evs: string[] = Array.isArray(r?.lap_events) ? r.lap_events : [];
                                for (const e of evs) eventCounts.set(e, (eventCounts.get(e) || 0) + 1);
                                if (typeof r?.lap_number === 'number' && r.lap_number > 0) {
                                    const lt = typeof r?.lap_time === 'number' ? r.lap_time : -1;
                                    lapAll.push({ lap: r.lap_number, t: lt, incident: !!r?.incident, events: evs });
                                }
                            }
                        } catch {}
                    }
                }
            } catch {}
            const eventsSummary = Array.from(eventCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([k, v]) => `${k}×${v}`)
                .join(', ');

            // Build concise lap highlights (best, worst, and up to 3 incident laps)
            let lapHighlights = '';
            try {
                const valids = lapAll.filter(x => typeof x.t === 'number' && x.t > 0);
                const byLap = new Map<number, { lap: number; t: number; incident: boolean; events: string[] }>();
                for (const r of valids) if (!byLap.has(r.lap)) byLap.set(r.lap, r);
                const arr = Array.from(byLap.values());
                if (arr.length > 0) {
                    const best = arr.reduce((a, b) => (a.t <= 0 || (b.t > 0 && b.t < a.t)) ? b : a, arr[0]!);
                    const worst = arr.reduce((a, b) => (b.t > a.t ? b : a), arr[0]!);
                    const incidents = arr.filter(r => r.incident).sort((a, b) => b.t - a.t).slice(0, 3);
                    const picked: Array<{ lap: number; label: string }> = [];
                    if (best && best.t > 0) picked.push({ lap: best.lap, label: `Best L${best.lap} ${this.iracing.formatLapTime(best.t)}` });
                    if (worst && worst.lap !== best?.lap && worst.t > 0) picked.push({ lap: worst.lap, label: `Worst L${worst.lap} ${this.iracing.formatLapTime(worst.t)}` });
                    for (const r of incidents) {
                        if (picked.find(p => p.lap === r.lap)) continue;
                        const ev = r.events && r.events.length ? ` (${r.events.join(', ')})` : '';
                        picked.push({ lap: r.lap, label: `L${r.lap} ${this.iracing.formatLapTime(r.t)}${ev}` });
                        if (picked.length >= 5) break;
                    }
                    lapHighlights = picked.map(p => p.label).join(' • ');
                }
            } catch {}

            const underperformed = (
                (typeof finishPos === 'number' && finishPos > 10) ||
                (typeof posChange === 'number' && posChange < 0) ||
                (typeof result.incidents === 'number' && result.incidents >= 6) ||
                (typeof irDelta === 'number' && irDelta < 0)
            );

            context = {
                startPos, finishPos, posChange, lapsComplete, sof,
                bestLap, avgLap, champPoints, gapToWinner, irDelta,
                incidentCount, eventsSummary, lapHighlights,
                qual,
                fieldSize, classPos,
                raceBestLapTime,
                wrDeltaPct,
                pitStops, cautions,
                posTrend
            };
            (context as any).performance = underperformed ? 'poor' : 'good';
        } catch {}

        // Helper: compact event log digest for prompt context
        const buildEventLogDigest = (ctx: any): string => {
            try {
                const parts: string[] = [];
                if (ctx?.posTrend) {
                    const { start, end, min, max } = ctx.posTrend;
                    parts.push(`Pos ${start ?? '?'}→${end ?? '?'} (min ${min ?? '?'}, max ${max ?? '?'})`);
                }
                if (typeof ctx?.cautions === 'number') parts.push(`Cautions ${ctx.cautions}`);
                if (typeof ctx?.pitStops === 'number') parts.push(`Pits ${ctx.pitStops}`);
                if (typeof ctx?.incidentCount === 'number') parts.push(`Inc ${ctx.incidentCount}`);
                if (ctx?.eventsSummary) parts.push(ctx.eventsSummary);
                if (ctx?.lapHighlights) parts.push(`Laps: ${ctx.lapHighlights}`);
                const line = parts.join(' • ');
                return line.length > 500 ? (line.slice(0, 495) + '…') : line;
            } catch { return ''; }
        };

        // Generate AI-crafted race summary via OpenRouter (optional)
        try {
            const model = process.env.OPENROUTER_MODEL?.trim();
            const apiKey = process.env.OPENROUTER_KEY?.trim();
            if (model && apiKey) {
                const sys = 'You are Robin Miller writing race summaries for Discord embeds. Keep it concise to avoid exceeding discords text length limits.';
                // Build recent history for this user (context for trend/news). Up to 30 prior events.
                let historyBlock = '';
                try {
                    const recent = await this.db.getRecentRaceResults(result.discord_id, 32);
                    if (Array.isArray(recent) && recent.length > 0) {
                        const lines: string[] = [];
                        for (const r of recent) {
                            if (r.subsession_id === result.subsession_id) continue; // skip current
                            const date = new Date(r.start_time).toISOString().slice(0, 10);
                            const cfg = (r.config_name && r.config_name.length) ? ` (${r.config_name})` : '';
                            // Enrich with subsession details where possible
                            let sofStr = '';
                            let lapsStr = '';
                            let bestStr = '';
                            let avgStr = '';
                            let ptsStr = '';
                            try {
                                const ss = await this.iracing.getSubsessionResult(r.subsession_id);
                                const getType2 = (sr: any) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
                                const raceSess = Array.isArray(ss?.session_results) ? ss.session_results.find((sr: any) => /race/i.test(getType2(sr)) && !/qual/i.test(getType2(sr))) : null;
                                const row = raceSess?.results?.find((x: any) => x.cust_id === r.iracing_customer_id);
                                const sof = (typeof ss?.event_strength_of_field === 'number') ? ss.event_strength_of_field : undefined;
                                if (typeof sof === 'number') sofStr = ` • SoF ${sof}`;
                                const laps = (typeof row?.laps_complete === 'number') ? row.laps_complete : (typeof ss?.event_laps_complete === 'number' ? ss.event_laps_complete : undefined);
                                if (typeof laps === 'number') lapsStr = ` • Laps ${laps}`;
                                if (typeof row?.best_lap_time === 'number' && row.best_lap_time > 0) bestStr = ` • Best ${this.iracing.formatLapTime(row.best_lap_time)}`;
                                if (typeof row?.average_lap === 'number' && row.average_lap > 0) avgStr = ` • Avg ${this.iracing.formatLapTime(row.average_lap)}`;
                                if (typeof row?.champ_points === 'number') ptsStr = ` • Pts ${row.champ_points}`;
                            } catch {}
                            const startStr = (typeof r.starting_position === 'number') ? `Start ${r.starting_position} → ` : '';
                            const irDelta = (typeof r.irating_before === 'number' && typeof r.irating_after === 'number') ? (r.irating_after - r.irating_before) : undefined;
                            const deltaStr = (typeof irDelta === 'number') ? ` (${irDelta >= 0 ? '+' : ''}${irDelta})` : '';
                            const irStr = (typeof r.irating_before === 'number' && typeof r.irating_after === 'number') ? ` • iR ${r.irating_before}→${r.irating_after}${deltaStr}` : '';
                            const carStr = r.car_name ? ` • ${r.car_name}` : '';
                            lines.push(`${date}: ${r.series_name} @ ${r.track_name}${cfg}${carStr} • ${startStr}P${r.finish_position} • ${r.incidents}x${lapsStr}${sofStr}${bestStr}${avgStr}${ptsStr}${irStr}`);
                            if (lines.length >= 10) break;
                        }
                        if (lines.length > 0) historyBlock = lines.join('\n');
                    }
                } catch {}

                const ask = [
                    `Driver: ${result.iracing_username}`,
                    `Series: ${result.series_name}`,
                    `Track: ${result.track_name}${result.config_name ? ` (${result.config_name})` : ''}`,
                    `Car: ${result.car_name}`,
                    `Start → Finish: ${context.startPos ?? '?'} → ${context.finishPos ?? '?'}`,
                    typeof context.posChange === 'number' ? `Net: ${context.posChange > 0 ? '+' : ''}${context.posChange}` : '',
                    typeof context.lapsComplete === 'number' ? `Laps: ${context.lapsComplete}` : '',
                    typeof context.sof === 'number' ? `SoF: ${context.sof}` : '',
                    `Incidents: ${result.incidents}`,
                    context.bestLap ? `Best Lap: ${context.bestLap.time} (L${context.bestLap.lap})` : '',
                    context.avgLap ? `Avg Lap: ${context.avgLap}` : '',
                    typeof context.champPoints === 'number' ? `Points: ${context.champPoints}` : '',
                    typeof context.irDelta === 'number' ? `iRating: ${result.irating_before} → ${result.irating_after} (${context.irDelta >= 0 ? '+' : ''}${context.irDelta})` : '',
                    context.gapToWinner ? `Gap to Winner: ${context.gapToWinner}` : '',
                    context.eventsSummary ? `Notable: ${context.eventsSummary}` : '',
                    context.lapHighlights ? `Lap Highlights: ${context.lapHighlights}` : '',
                    context.qual?.time ? `Qual: ${context.qual.time}${context.qual.lap ? ` (L${context.qual.lap})` : ''}${typeof context.qual.position === 'number' ? `, P${context.qual.position}` : ''}` : '',
                    typeof context.fieldSize === 'number' ? `Field: ${context.fieldSize}${typeof context.classPos === 'number' ? `, Class P${context.classPos}` : ''}` : '',
                    context.raceBestLapTime ? `Race Best: ${context.raceBestLapTime}` : '',
                    typeof context.wrDeltaPct === 'number' ? `% over WR: ${context.wrDeltaPct.toFixed(1)}%` : '',
                    typeof context.pitStops === 'number' ? `Pit Stops: ${context.pitStops}` : '',
                    typeof context.cautions === 'number' ? `Cautions: ${context.cautions}` : '',
                    context.posTrend ? `Trend: start ${context.posTrend.start ?? '?'} → end ${context.posTrend.end ?? '?'} (min ${context.posTrend.min ?? '?'}, max ${context.posTrend.max ?? '?'})` : '',
                ].filter(Boolean).join('\n');

                const eventLogBlock = buildEventLogDigest(context);
                // Fetch guild-specific prompt additions (prepended at the very top)
                let guildPromptHeader = '';
                try {
                    if (guildIdForPrompts) {
                        const extras = await this.db.getGuildPrompts(guildIdForPrompts);
                        if (extras.length > 0) {
                            guildPromptHeader = extras.join('\n');
                        }
                    }
                } catch {}
                const promptLines: string[] = [
                    ...(guildPromptHeader ? [guildPromptHeader, ''] : []),
                    'Recent Results (most recent first):',
                    historyBlock,
                    '',
                    'Event Log (latest race):',
                    eventLogBlock || '(none)',
                    '',
                    'Latest race data (primary focus):',
                    ask,
                    '',
                    'Write a quick news report paragraph for a discord embed in the style of Robin Miller—evocative and witty yet precise—summarizing the latest race.',
                    'Explicitly contextualize this performance vs the driver\'s recent results (positions, incidents, iRating trend, lap pace) using the provided history.',
                    "Then add a 'Details' list with short labeled lines (headings with emojis) covering the most relevant numeric details from the latest race and the racers recent trends."
                ];
                const prompt = promptLines.join('\n');

                const baseUrl = process.env.OPENROUTER_BASE?.trim() || 'https://openrouter.ai/api/v1';
                const resp = await axios.post(
                    `${baseUrl}/chat/completions`,
                    {
                        model,
                        messages: [
                            { role: 'system', content: sys },
                            { role: 'user', content: prompt }
                        ]
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                            // Optional OpenRouter headers for attribution
                            'HTTP-Referer': 'https://github.com/ericbriscoe/iracing-discord-bot',
                            'X-Title': 'iRacing Discord Bot'
                        },
                        timeout: 15000
                    }
                );
                const text = resp.data?.choices?.[0]?.message?.content?.toString?.() || '';
                let summary = text.length > 1500 ? (text.slice(0, 1495) + '…') : text;
                if (summary) {
                    // Replace the user's iRacing name with a Discord mention (non-pinging via allowedMentions on send)
                    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    try {
                        // Case-insensitive, capture optional possessive 's or ’s and preserve it after the mention
                        const nameRe = new RegExp(`\\b${esc(result.iracing_username)}((?:'s|’s)?)\\b`, 'gi');
                        summary = summary.replace(nameRe, (_m: string, poss: string) => `<@${result.discord_id}>${poss || ''}`);
                    } catch {}
                    // Prefer description for better width; ensure within limit
                    embed.setDescription(summary);
                }
            }
        } catch (e) {
            // If AI summary fails, we silently skip.
        }

        // Fallback: if no description yet, build a structured, emoji-labeled summary ourselves
        if (!embed.data.description) {
            const lines: string[] = [];
            lines.push(`👤 Driver: <@${result.discord_id}> (${result.iracing_username})`);
            lines.push(`🏁 Series: ${result.series_name}`);
            lines.push(`🗺️ Track: ${result.track_name}${result.config_name ? ` (${result.config_name})` : ''}`);
            lines.push(`🏎️ Car: ${result.car_name}`);
            const sfin = (context.startPos !== undefined || context.finishPos !== undefined)
                ? `Start → Finish: ${context.startPos ?? '?'} → ${context.finishPos ?? '?'}`
                : undefined;
            const net = (typeof context.posChange === 'number') ? `Net: ${context.posChange > 0 ? '+' : ''}${context.posChange}` : undefined;
            if (sfin || net) lines.push(`🚦 ${[sfin, net].filter(Boolean).join(' • ')}`);
            const raceBits: string[] = [];
            if (typeof context.lapsComplete === 'number') raceBits.push(`${context.lapsComplete} laps`);
            if (typeof context.sof === 'number') raceBits.push(`SoF ${context.sof}`);
            raceBits.push(`${result.incidents} inc`);
            lines.push(`🏟️ Race: ${raceBits.join(' • ')}`);
            const perf: string[] = [];
            if (context.bestLap) perf.push(`Best ${context.bestLap.time} (L${context.bestLap.lap})`);
            if (context.avgLap) perf.push(`Avg ${context.avgLap}`);
            if (typeof context.champPoints === 'number') perf.push(`Pts ${context.champPoints}`);
            if (typeof context.irDelta === 'number') perf.push(`iR ${result.irating_before} → ${result.irating_after} (${context.irDelta >= 0 ? '+' : ''}${context.irDelta})`);
            if (context.gapToWinner) perf.push(`Gap ${context.gapToWinner}`);
            if (perf.length) lines.push(`📊 ${perf.join(' • ')}`);
            const extra: string[] = [];
            if (context.qual?.time) extra.push(`Qual ${context.qual.time}${context.qual.lap ? ` (L${context.qual.lap})` : ''}${typeof context.qual.position === 'number' ? `, P${context.qual.position}` : ''}`);
            if (typeof context.fieldSize === 'number') extra.push(`Field ${context.fieldSize}${typeof context.classPos === 'number' ? `, Class P${context.classPos}` : ''}`);
            if (context.raceBestLapTime) extra.push(`Race Best ${context.raceBestLapTime}`);
            if (typeof context.wrDeltaPct === 'number') extra.push(`${context.wrDeltaPct.toFixed(1)}% over WR`);
            if (typeof context.pitStops === 'number') extra.push(`${context.pitStops} stops`);
            if (typeof context.cautions === 'number') extra.push(`${context.cautions} cautions`);
            if (context.posTrend) extra.push(`Trend ${context.posTrend.start ?? '?'}→${context.posTrend.end ?? '?'} (min ${context.posTrend.min ?? '?'}, max ${context.posTrend.max ?? '?'})`);
            if (extra.length) lines.push(`🧩 ${extra.join(' • ')}`);
            if (context.eventsSummary) lines.push(`🔎 Notable: ${context.eventsSummary}`);
            if (context.lapHighlights) lines.push(`🧾 Laps: ${context.lapHighlights}`);

            const text = lines.join('\n');
            embed.setDescription(text.length > 4096 ? text.slice(0, 4090) + '…' : text);
        }

        return { embed, attachment };
    }

    // (Removed) getLapTimeFields — legacy per-embed lap time fields no longer used.

    // ===== History command support =====
    private async handleHistoryCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const linked = await this.db.getLinkedUser(interaction.user.id);
            if (!linked || !linked.iracing_customer_id) {
                await interaction.reply({ content: '❌ You need to link your iRacing account first using /link.', flags: [MessageFlags.Ephemeral] });
                return;
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const range = '90d';
            const { imageBuffer, embed } = await this.buildHistoryResponse(interaction.user.id, linked.iracing_customer_id!, range);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'history.png' });
            const rows = this.buildHistoryButtons(interaction.user.id, range);
            await interaction.editReply({ embeds: [embed], files: [attachment], components: rows });
        } catch (error) {
            console.error('Error handling /history:', error);
            try { await interaction.editReply({ content: '❌ Failed to build history chart.' }); } catch {}
        }
    }

    private buildHistoryButtons(userId: string, active: string) {
        const ranges = [
            { k: '30d', label: '30d' },
            { k: '90d', label: '90d' },
            { k: '6m', label: '6m' },
            { k: '1y', label: '1y' },
            { k: 'all', label: 'All' }
        ];
        const buttons = ranges.map(r => new ButtonBuilder()
            .setCustomId(`history|${userId}|${r.k}`)
            .setLabel(r.label)
            .setStyle(r.k === active ? ButtonStyle.Primary : ButtonStyle.Secondary));
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
        return [row];
    }

    private async handleHistoryButton(interaction: ButtonInteraction): Promise<void> {
        const customId = interaction.customId;
        if (!customId.startsWith('history|')) return;
        const parts = customId.split('|');
        if (parts.length !== 3) return;
        const uid = parts[1]!;
        const range = parts[2]!;
        if (interaction.user.id !== uid) {
            await interaction.reply({ content: '❌ Only the original requester can use these buttons.', ephemeral: true });
            return;
        }
        const linked = await this.db.getLinkedUser(uid);
        if (!linked || !linked.iracing_customer_id) {
            await interaction.reply({ content: '❌ Your account is no longer linked.', ephemeral: true });
            return;
        }
        // Acknowledge quickly to avoid interaction expiry, then edit original message after heavy work
        try { await interaction.deferUpdate(); } catch {}
        const { imageBuffer, embed } = await this.buildHistoryResponse(uid, linked.iracing_customer_id!, range);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'history.png' });
        const rows = this.buildHistoryButtons(uid, range);
        await interaction.editReply({ embeds: [embed], files: [attachment], components: rows });
    }

    private async pickTrackAndCarForUser(discordId: string, trackQuery: string, inputCarId?: number): Promise<{ trackId: number; carId: number; trackName: string; carName: string } | null> {
        const all = await this.db.getRaceResultsForUserAsc(discordId);
        if (all.length === 0) return null;
        let candidates = all;
        if (trackQuery) {
            const q = trackQuery.toLowerCase();
            const filtered = all.filter(r => (r.track_name && r.track_name.toLowerCase().includes(q)) || (r.config_name && r.config_name.toLowerCase().includes(q)));
            if (filtered.length > 0) candidates = filtered;
        }
        if (candidates.length === 0) return null;
        const latest = candidates[candidates.length - 1]!;
        const trackId = latest.track_id;
        let carId = inputCarId || latest.car_id;
        if (!carId) {
            const onTrack = all.filter(r => r.track_id === trackId);
            if (onTrack.length > 0) {
                const last = onTrack[onTrack.length - 1];
                if (last) carId = last.car_id;
            }
        }
        const carName = latest.car_name || 'Car';
        const cfg = (latest as any).config_name || '';
        const trackName = cfg ? `${latest.track_name} (${cfg})` : latest.track_name;
        return { trackId, carId, trackName, carName };
    }

    private async buildHistoryResponse(discordId: string, customerId: number, range: string): Promise<{ imageBuffer: Buffer; embed: EmbedBuilder }> {
        const { points, combos } = await this.collectHistoryPoints(discordId, customerId, range);
        const svg = this.renderHistorySvg(points, { title: `All Tracks • All Cars`, range });
        const imageBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

        const embed = new EmbedBuilder()
            .setTitle('Lap vs World Record')
            .setDescription(`All tracks and cars`)
            .addFields(
                { name: 'Points', value: String(points.length), inline: true },
                { name: 'Range', value: range.toUpperCase(), inline: true },
                { name: 'Combos', value: String(combos), inline: true }
            )
            .setImage('attachment://history.png')
            .setColor(0x3b82f6);

        return { imageBuffer, embed };
    }

    private async collectHistoryPoints(discordId: string, customerId: number, range: string): Promise<{ points: Array<{ t: number; y: number }>; combos: number }> {
        const all = await this.db.getRaceResultsForUserAsc(discordId);
        const cutoff = this.rangeToCutoff(range);
        const filtered = cutoff ? all.filter(r => new Date(r.start_time).getTime() >= cutoff) : all;
        // Build unique car/track combos and prefetch WRs
        const comboKeys = new Set<string>();
        for (const r of filtered) comboKeys.add(`${r.car_id}:${r.track_id}`);
        const wrCache = new Map<string, number | undefined>();
        const combos = Array.from(comboKeys);
        const limit = 6;
        for (let i = 0; i < combos.length; i += limit) {
            const batch = combos.slice(i, i + limit).map(async (key) => {
                const parts = key.split(':');
                const carStr = parts[0] || '0';
                const trackStr = parts[1] || '0';
                const wr = await this.iracing.getWorldRecordBestLap(parseInt(carStr, 10), parseInt(trackStr, 10));
                wrCache.set(key, wr ?? undefined);
            });
            await Promise.all(batch);
        }
        // Collect points with basic caching of per-subsesson best lap
        const bestLapCache = new Map<number, number | null>();
        const points: Array<{ t: number; y: number }> = [];
        for (const r of filtered) {
            let best = bestLapCache.get(r.subsession_id) ?? null;
            if (best === null && !bestLapCache.has(r.subsession_id)) {
                best = await this.getUserBestRaceLap(r.subsession_id, customerId);
                bestLapCache.set(r.subsession_id, best);
            }
            const wr = wrCache.get(`${r.car_id}:${r.track_id}`);
            if (!best || !wr || wr <= 0) continue;
            const pct = ((best - wr) / wr) * 100;
            // Eliminate outliers more than 50% slower than the WR
            if (pct > 50) continue;
            const t = new Date(r.start_time).getTime();
            points.push({ t, y: pct });
        }
        return { points, combos: comboKeys.size };
    }

    private rangeToCutoff(range: string): number | null {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        switch (range) {
            case '30d': return now - 30 * day;
            case '90d': return now - 90 * day;
            case '6m': return now - 182 * day;
            case '1y': return now - 365 * day;
            case 'all': return null;
            default: return now - 90 * day;
        }
    }

    private async getUserBestRaceLap(subsessionId: number, customerId: number): Promise<number | null> {
        const ss = await this.iracing.getSubsessionResult(subsessionId);
        if (!ss || !Array.isArray(ss.session_results)) return null;
        const getType = (sr: any) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
        const raceSession = ss.session_results.find((sr: any) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr)));
        const row = raceSession?.results?.find((x: any) => x.cust_id === customerId);
        const best = row?.best_lap_time;
        return typeof best === 'number' && best > 0 ? best : null;
    }

    private renderHistorySvg(points: Array<{ t: number; y: number }>, opts: { title: string; range: string }): string {
        const width = 1200, height = 600, margin = 60;
        const innerW = width - margin * 2, innerH = height - margin * 2;
        const times = points.map(p => p.t);
        const ys = points.map(p => p.y);
        const minX = times.length ? Math.min(...times) : Date.now() - 1;
        const maxX = times.length ? Math.max(...times) : Date.now();
        const minY = ys.length ? Math.min(...ys) : 0;
        const maxY = ys.length ? Math.max(...ys) : 1;
        const padY = (maxY - minY) * 0.1 || 1;
        const y0 = minY - padY;
        const y1 = maxY + padY;
        const xScale = (x: number) => margin + (times.length <= 1 ? innerW/2 : ((x - minX) / (maxX - minX)) * innerW);
        const yScale = (y: number) => margin + innerH - ((y - y0) / (y1 - y0)) * innerH;

        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');

        const loess = this.loessSmooth(points, { resolution: Math.min(300, Math.max(120, points.length * 8)), robust: true });

        const yTicks = 5;
        const ticks: number[] = [];
        for (let i = 0; i <= yTicks; i++) ticks.push(y0 + (i * (y1 - y0) / yTicks));

        const fmtPct = (v: number) => `${v.toFixed(1)}%`;
        const pointsCircles = points.map(p => `<circle cx="${xScale(p.t).toFixed(1)}" cy="${yScale(p.y).toFixed(1)}" r="3" fill="#93c5fd" stroke="#1d4ed8" stroke-width="1" />`).join('\n');

        return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<svg width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" xmlns=\"http://www.w3.org/2000/svg\">
  <rect x=\"0\" y=\"0\" width=\"${width}\" height=\"${height}\" fill=\"#0b1220\" />
  <text x=\"${width/2}\" y=\"30\" fill=\"#e5e7eb\" font-family=\"DejaVu Sans, Liberation Sans, Arial, sans-serif\" font-size=\"20\" text-anchor=\"middle\">${opts.title} • ${opts.range.toUpperCase()}</text>
  <line x1=\"${margin}\" y1=\"${margin}\" x2=\"${margin}\" y2=\"${height - margin}\" stroke=\"#334155\" stroke-width=\"1\" />
  <line x1=\"${margin}\" y1=\"${height - margin}\" x2=\"${width - margin}\" y2=\"${height - margin}\" stroke=\"#334155\" stroke-width=\"1\" />
  ${ticks.map(t => `<g>
    <line x1=\"${margin}\" y1=\"${yScale(t).toFixed(1)}\" x2=\"${width - margin}\" y2=\"${yScale(t).toFixed(1)}\" stroke=\"#1f2937\" stroke-width=\"1\" opacity=\"0.4\" />
    <text x=\"${margin - 10}\" y=\"${yScale(t).toFixed(1)}\" fill=\"#9ca3af\" font-size=\"12\" text-anchor=\"end\" dominant-baseline=\"middle\">${fmtPct(t)}</text>
  </g>`).join('')}
  ${pointsCircles}
  ${loess.length > 1 ? `<path d=\"${loess.map((p,i)=>`${i===0?'M':'L'} ${xScale(p.t).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ')}\" fill=\"none\" stroke=\"#22c55e\" stroke-dasharray=\"6 6\" stroke-width=\"2\" />` : ''}
  <g transform=\"translate(${width - margin - 200}, ${margin})\">
    <rect x=\"0\" y=\"0\" width=\"200\" height=\"60\" fill=\"#0f172a\" stroke=\"#334155\" />
    <circle cx=\"12\" cy=\"14\" r=\"4\" fill=\"#2563eb\" /><text x=\"24\" y=\"18\" fill=\"#e5e7eb\" font-size=\"12\">Point (% over WR)</text>
    <line x1=\"8\" y1=\"32\" x2=\"20\" y2=\"32\" stroke=\"#22c55e\" stroke-dasharray=\"6 6\" stroke-width=\"2\" />
    <text x=\"24\" y=\"36\" fill=\"#e5e7eb\" font-size=\"12\">Trend</text>
  </g>
</svg>`;
    }

    private linearRegression(points: Array<{ t: number; y: number }>): { m: number; b: number } | null {
        if (points.length < 2) return null;
        const xs = points.map(p => p.t);
        const ys = points.map(p => p.y);
        const x0 = Math.min(...xs);
        const nx = xs.map(x => (x - x0) / (24 * 60 * 60 * 1000));
        const n = nx.length;
        const sumX = nx.reduce((a, b) => a + b, 0);
        const sumY = ys.reduce((a, b) => a + b, 0);
        let sumXY = 0;
        for (let i = 0; i < n; i++) {
            const yi = ys[i];
            if (typeof yi !== 'number') continue;
            const xi = nx[i] ?? 0;
            sumXY += xi * yi;
        }
        const sumXX = nx.reduce((a, x) => a + x * x, 0);
        const denom = n * sumXX - sumX * sumX;
        if (denom === 0) return null;
        const mDay = (n * sumXY - sumX * sumY) / denom;
        const b = (sumY - mDay * sumX) / n;
        const m = mDay / (24 * 60 * 60 * 1000);
        return { m, b: b - m * x0 };
    }

    private loessSmooth(points: Array<{ t: number; y: number }>, opts?: { span?: number; resolution?: number; robust?: boolean }): Array<{ t: number; y: number }> {
        const pts = points.slice().sort((a, b) => a.t - b.t);
        const n = pts.length;
        if (n === 0) return [];
        if (n === 1) return [pts[0]!];
        // Adaptive span: for small datasets, increase span for a looser, smoother fit
        const autoSpan = n <= 20 ? 0.85 : n <= 50 ? 0.65 : 0.45;
        const span = Math.min(0.95, Math.max(0.2, opts?.span ?? autoSpan));
        const k = Math.max(2, Math.ceil(span * n));
        const xs = pts.map(p => p.t);
        const ys = pts.map(p => p.y);
        const minX = xs[0]!;
        const maxX = xs[n - 1]!;
        // Higher resolution for smoother visual line regardless of point count
        const resolution = Math.max(100, Math.min(360, opts?.resolution ?? 240));
        const evalXs: number[] = [];
        if (resolution >= n) {
            for (const x of xs) evalXs.push(x);
        } else {
            const step = (maxX - minX) / (resolution - 1 || 1);
            for (let i = 0; i < resolution; i++) evalXs.push(minX + i * step);
        }
        // Local weighted regression
        const yhatAt = (x0: number, robustW?: number[]): number => {
            const distances = xs.map((x, idx) => ({ idx, d: Math.abs((x as number) - x0) }));
            distances.sort((a, b) => a.d - b.d);
            const window = distances.slice(0, k);
            const last = window[window.length - 1];
            const dmax = (last ? last.d : 0) || 1e-9;
            let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
            for (const { idx, d } of window) {
                const u = d / dmax;
                let w = (1 - Math.pow(u, 3)) ** 3; // tricube weight
                if (robustW && typeof robustW[idx] === 'number') w *= robustW[idx]!;
                const x = xs[idx]!;
                const y = ys[idx]!;
                Sw += w;
                Sx += w * x;
                Sy += w * y;
                Sxx += w * x * x;
                Sxy += w * x * y;
            }
            const denom = Sw * Sxx - Sx * Sx;
            if (Math.abs(denom) < 1e-12 || Sw === 0) return Sy / (Sw || 1);
            const a = (Sxx * Sy - Sx * Sxy) / denom;
            const b = (Sw * Sxy - Sx * Sy) / denom;
            return a + b * x0;
        };
        // Initial fit at data x's
        const initialFits: number[] = xs.map(x0 => yhatAt(x0!));
        // Up to two robust iterations to downweight outliers strongly
        let robustW: number[] | undefined = undefined;
        if (opts?.robust !== false) {
            const computeRobustWeights = (fits: number[]): number[] => {
                const residuals = ys.map((y, i) => (y as number) - fits[i]!);
                const absRes = residuals.map(r => Math.abs(r)).sort((a, b) => a - b);
                const median = absRes.length > 0
                    ? (absRes.length % 2 === 1
                        ? absRes[(absRes.length - 1) >> 1]!
                        : ((absRes[absRes.length / 2 - 1]! + absRes[absRes.length / 2]!) / 2))
                    : 0;
                const s = median > 0 ? 4.685 * median : 1e-6; // stronger downweight
                return residuals.map(r => {
                    const u = Math.abs(r) / s;
                    if (u >= 1) return 0;
                    return (1 - u * u) ** 2; // Tukey bisquare
                });
            };
            robustW = computeRobustWeights(initialFits);
            // second pass fits
            const secondFits = xs.map(x0 => yhatAt(x0!, robustW));
            robustW = computeRobustWeights(secondFits);
        }
        // Evaluate and then apply a light moving-average on outputs to ensure smoothness
        const out: Array<{ t: number; y: number }> = [];
        for (const x0 of evalXs) out.push({ t: x0, y: yhatAt(x0, robustW) });
        const smoothed: Array<{ t: number; y: number }> = [];
        const win = Math.max(3, Math.floor(Math.min(13, Math.round(resolution / 30)))); // small window
        const half = Math.floor(win / 2);
        for (let i = 0; i < out.length; i++) {
            let sum = 0, cnt = 0;
            for (let j = i - half; j <= i + half; j++) {
                if (j >= 0 && j < out.length) { sum += out[j]!.y; cnt++; }
            }
            smoothed.push({ t: out[i]!.t, y: cnt > 0 ? sum / cnt : out[i]!.y });
        }
        return smoothed;
    }

    private getPositionColor(position: number): number {
        if (position === 1) return 0xFFD700; // Gold
        if (position <= 3) return 0xC0C0C0; // Silver
        if (position <= 10) return 0xCD7F32; // Bronze
        return 0x808080; // Gray
    }

    private getOrdinalSuffix(num: number): string {
        const j = num % 10;
        const k = num % 100;
        if (j === 1 && k !== 11) return 'st';
        if (j === 2 && k !== 12) return 'nd';
        if (j === 3 && k !== 13) return 'rd';
        return 'th';
    }

    async start(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }

        await this.client.login(token);
    }

    async stop(): Promise<void> {
        if (this.seriesUpdateInterval) {
            clearInterval(this.seriesUpdateInterval);
        }
        if (this.raceResultUpdateInterval) {
            clearInterval(this.raceResultUpdateInterval);
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
