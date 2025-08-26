import { Client, GatewayIntentBits, SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, TextChannel, EmbedBuilder, AttachmentBuilder } from 'discord.js';
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
                    }
                } catch (error) {
                    console.error('Error handling interaction:', error);
                    try {
                        await interaction.reply({ content: 'An error occurred.', ephemeral: true });
                    } catch (replyError) {
                        console.error('Failed to send error message:', replyError);
                    }
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

            // Create race result record directly from member_recent_races data
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
                finish_position: raceData.finish_position,
                starting_position: raceData.start_position,
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
                    const { embed, attachment } = await this.createRaceResultEmbed(raceResult, raceData);
                    const messageOptions: any = { embeds: [embed] };
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

    private async createRaceResultEmbed(result: RaceResult, raceData: any): Promise<{ embed: EmbedBuilder; attachment?: AttachmentBuilder }> {
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

        // Driver and basic info
        embed.addFields(
            { name: '🏃 Driver', value: `<@${result.discord_id}> (${result.iracing_username})`, inline: true },
            { name: '🏁 Track', value: `${result.track_name}${result.config_name ? ` (${result.config_name})` : ''}`, inline: true },
            { name: '🏎️ Car', value: result.car_name, inline: true }
        );

        // Position information
        const startPos = result.starting_position || raceData.start_position;
        const finishPos = result.finish_position;
        const positionChange = startPos ? (startPos - finishPos) : 0;
        const positionChangeStr = positionChange === 0 ? '=' : positionChange > 0 ? `+${positionChange}` : positionChange.toString();
        
        embed.addFields(
            { name: '🚦 Starting Position', value: (startPos || 'Unknown').toString(), inline: true },
            { name: '🏆 Finishing Position', value: `${finishPos}${this.getOrdinalSuffix(finishPos)}`, inline: true },
            { name: '📈 Position Change', value: positionChangeStr, inline: true }
        );

        // Performance data
        embed.addFields(
            { name: '⚠️ Incidents', value: result.incidents.toString(), inline: true },
            { name: '🏁 Laps', value: `${raceData.laps || 'Unknown'}`, inline: true },
            { name: '🎯 Strength of Field', value: (raceData.strength_of_field || 'Unknown').toString(), inline: true }
        );

        // Add lap times if available
        const lapTimeFields = await this.getLapTimeFields(result.subsession_id, result.iracing_customer_id);
        if (lapTimeFields.length > 0) {
            embed.addFields(...lapTimeFields);
        }

        // Add qualifying time if available and > 0
        if (raceData.qualifying_time && raceData.qualifying_time > 0) {
            const qualifyingTime = this.iracing.formatLapTime(raceData.qualifying_time);
            embed.addFields({ name: '⏱️ Qualifying Time', value: qualifyingTime, inline: true });
        }

        // Add iRating change if available
        if (result.irating_before && result.irating_after) {
            const iRatingChange = result.irating_after - result.irating_before;
            const changeStr = iRatingChange >= 0 ? `+${iRatingChange}` : iRatingChange.toString();
            embed.addFields({
                name: '📊 iRating Change',
                value: `${result.irating_before} → ${result.irating_after} (${changeStr})`,
                inline: true
            });
        }

        // Add championship points if available
        if (raceData.points) {
            embed.addFields({ name: '🏆 Points Earned', value: raceData.points.toString(), inline: true });
        }

        return { embed, attachment };
    }

    private async getLapTimeFields(subsessionId: number, customerId: number): Promise<Array<{name: string, value: string, inline: boolean}>> {
        try {
            // Get detailed subsession result for lap times
            const subsessionDetail = await this.iracing.getSubsessionResult(subsessionId);
            if (!subsessionDetail || !Array.isArray(subsessionDetail.session_results)) return [];

            const fields: Array<{name: string, value: string, inline: boolean}> = [];

            const getType = (sr: any) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();

            // Prefer the Race session for best race lap
            const raceSession = subsessionDetail.session_results.find((sr: any) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr)));
            const raceUser = raceSession?.results?.find((r: any) => r.cust_id === customerId);
            if (raceUser && raceUser.best_lap_time && raceUser.best_lap_time > 0) {
                const raceTime = this.iracing.formatLapTime(raceUser.best_lap_time);
                fields.push({ name: '⚡ Best Race Lap', value: raceTime, inline: true });
            }

            // Prefer the Qualifying session for best qualifying lap
            const qualSession = subsessionDetail.session_results.find((sr: any) => /qual/i.test(getType(sr)));
            const qualUser = qualSession?.results?.find((r: any) => r.cust_id === customerId);
            if (qualUser && qualUser.best_qual_lap_time && qualUser.best_qual_lap_time > 0) {
                const qualTime = this.iracing.formatLapTime(qualUser.best_qual_lap_time);
                fields.push({ name: '🏃 Best Qualifying Lap', value: qualTime, inline: true });
            }

            return fields;
        } catch (error) {
            console.warn('Could not fetch lap time data:', error);
            return [];
        }
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
