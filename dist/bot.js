"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = require("dotenv");
const database_1 = require("./database");
const iracing_client_1 = require("./iracing-client");
(0, dotenv_1.config)();
class iRacingBot {
    constructor() {
        this.seriesUpdateInterval = null;
        this.raceResultUpdateInterval = null;
        this.client = new discord_js_1.Client({
            intents: [discord_js_1.GatewayIntentBits.Guilds]
        });
        this.db = new database_1.Database();
        this.iracing = new iracing_client_1.iRacingClient();
        this.setupEventHandlers();
    }
    setupEventHandlers() {
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
                }
                catch (error) {
                    console.error('Error handling interaction:', error);
                    try {
                        await interaction.reply({ content: 'An error occurred.', ephemeral: true });
                    }
                    catch (replyError) {
                        console.error('Failed to send error message:', replyError);
                    }
                }
            }
        });
    }
    async registerSlashCommands() {
        const commands = [
            new discord_js_1.SlashCommandBuilder()
                .setName('link')
                .setDescription('Link a Discord account to an iRacing account')
                .addIntegerOption(option => option.setName('customer_id')
                .setDescription('iRacing Customer ID')
                .setRequired(true))
                .addUserOption(option => option.setName('user')
                .setDescription('User to link (admin only - leave blank to link yourself)')
                .setRequired(false)),
            new discord_js_1.SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink your iRacing account from Discord')
                .addUserOption(option => option.setName('user')
                .setDescription('User to unlink (admin only - leave blank to unlink yourself)')
                .setRequired(false)),
            new discord_js_1.SlashCommandBuilder()
                .setName('race-log')
                .setDescription('Set this channel to receive race result notifications for tracked members')
        ];
        try {
            console.log('Registering slash commands...');
            await this.client.application?.commands.set(commands);
            console.log('Slash commands registered successfully');
        }
        catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }
    isServerAdmin(interaction) {
        if (!interaction.guild || !interaction.member)
            return false;
        const member = interaction.member;
        if ('permissions' in member && member.permissions) {
            if (typeof member.permissions === 'string') {
                return false;
            }
            return member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator);
        }
        return false;
    }
    async handleLinkCommand(interaction) {
        const customerId = interaction.options.getInteger('customer_id', true);
        const targetUser = interaction.options.getUser('user');
        try {
            await interaction.deferReply({ flags: [discord_js_1.MessageFlags.Ephemeral] });
            if (targetUser && targetUser.id !== interaction.user.id) {
                if (!this.isServerAdmin(interaction)) {
                    await interaction.editReply({ content: '❌ Only server administrators can link other users.' });
                    return;
                }
            }
            const userToLink = targetUser || interaction.user;
            const memberInfo = await this.iracing.getMemberSummary(customerId);
            if (!memberInfo) {
                await interaction.editReply({ content: `❌ Could not find iRacing member with Customer ID: ${customerId}` });
                return;
            }
            const displayName = memberInfo.display_name || `User ${customerId}`;
            await this.db.linkUser(userToLink.id, displayName, customerId);
            const isLinkingOther = targetUser && targetUser.id !== interaction.user.id;
            const response = isLinkingOther
                ? `✅ Linked <@${userToLink.id}> to **${displayName}** (Customer ID: ${customerId})`
                : `✅ Linked <@${userToLink.id}> to **${displayName}** (Customer ID: ${customerId})`;
            await interaction.editReply({ content: response });
        }
        catch (error) {
            console.error('Error linking account:', error);
            await interaction.editReply({ content: '❌ An error occurred while linking the account.' });
        }
    }
    async handleUnlinkCommand(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            if (targetUser && targetUser.id !== interaction.user.id) {
                if (!this.isServerAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Only server administrators can unlink other users.', flags: [discord_js_1.MessageFlags.Ephemeral] });
                    return;
                }
            }
            const userToUnlink = targetUser || interaction.user;
            const wasLinked = await this.db.unlinkUser(userToUnlink.id);
            if (wasLinked) {
                const response = (targetUser && targetUser.id !== interaction.user.id)
                    ? `✅ Successfully unlinked <@${userToUnlink.id}>.`
                    : '✅ Successfully unlinked your account.';
                await interaction.reply({ content: response, flags: [discord_js_1.MessageFlags.Ephemeral] });
            }
            else {
                const response = (targetUser && targetUser.id !== interaction.user.id)
                    ? `❌ No linked account found for <@${userToUnlink.id}>.`
                    : '❌ No linked account found.';
                await interaction.reply({ content: response, flags: [discord_js_1.MessageFlags.Ephemeral] });
            }
        }
        catch (error) {
            console.error('Error unlinking account:', error);
            await interaction.reply({ content: '❌ An error occurred while unlinking the account.', flags: [discord_js_1.MessageFlags.Ephemeral] });
        }
    }
    async handleRaceLogCommand(interaction) {
        try {
            await interaction.deferReply();
            if (!interaction.channel) {
                await interaction.editReply({ content: '❌ This command must be used in a channel.' });
                return;
            }
            if (!this.isServerAdmin(interaction)) {
                await interaction.editReply({ content: '❌ Only server administrators can set race log channels.' });
                return;
            }
            const existingRaceLogChannel = await this.db.getRaceLogChannel(interaction.channel.id);
            if (existingRaceLogChannel) {
                await interaction.editReply({ content: '❌ This channel is already configured as a race log channel.' });
                return;
            }
            await this.db.setRaceLogChannel(interaction.channel.id, interaction.guildId);
            const embed = new discord_js_1.EmbedBuilder()
                .setTitle('🏁 Race Log Channel Configured')
                .setDescription('This channel will now receive race result notifications for all tracked guild members.')
                .setColor(0x00AE86)
                .addFields({ name: 'What happens next?', value: 'New race results for linked members will be posted here automatically.' }, { name: 'How to link members?', value: 'Use `/link` command to link Discord accounts to iRacing accounts.' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }
        catch (error) {
            console.error('Error setting race log channel:', error);
            await interaction.editReply({ content: '❌ An error occurred while setting up the race log channel.' });
        }
    }
    async updateOfficialSeries() {
        try {
            console.log('Updating official series data...');
            const officialSeries = await this.iracing.getOfficialSeries();
            if (officialSeries && officialSeries.length > 0) {
                const seriesData = officialSeries.map(series => ({
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
        }
        catch (error) {
            console.error('Error updating official series:', error);
        }
    }
    startSeriesUpdateTimer() {
        this.seriesUpdateInterval = setInterval(async () => {
            await this.updateOfficialSeries();
        }, 24 * 60 * 60 * 1000);
    }
    startRaceResultUpdateTimer() {
        this.raceResultUpdateInterval = setInterval(async () => {
            await this.checkForNewRaceResults();
        }, 10 * 60 * 1000);
        setTimeout(async () => {
            await this.checkForNewRaceResults();
        }, 30000);
    }
    async checkForNewRaceResults() {
        console.log('Checking for new race results...');
        try {
            const linkedUsers = await this.db.getAllLinkedUsers();
            for (const user of linkedUsers) {
                if (user.iracing_customer_id) {
                    await this.updateRaceResultsForUser(user);
                }
            }
            console.log('Race result check completed');
        }
        catch (error) {
            console.error('Error during race result check:', error);
        }
    }
    async updateRaceResultsForUser(user) {
        try {
            const recentRaces = await this.iracing.getMemberRecentRaces(user.iracing_customer_id);
            if (recentRaces && recentRaces.length > 0) {
                for (const race of recentRaces) {
                    const exists = await this.db.getRaceResultExists(race.subsession_id, user.discord_id);
                    if (!exists) {
                        await this.processNewRaceResult(race, user);
                    }
                }
            }
        }
        catch (error) {
            console.error(`Error updating race results for user ${user.iracing_username}:`, error);
        }
    }
    async processNewRaceResult(raceData, user) {
        try {
            let carName = raceData.car_name;
            if (!carName && raceData.car_id) {
                carName = await this.iracing.getCarName(raceData.car_id);
            }
            if (!carName) {
                carName = 'Unknown Car';
            }
            const raceResult = {
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
                event_type: 'Race',
                official_session: true,
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString()
            };
            await this.db.upsertRaceResult(raceResult);
            await this.postRaceResultToChannels(raceResult, raceData);
            console.log(`Processed new race result for ${user.iracing_username}: ${raceResult.series_name} - P${raceResult.finish_position}`);
        }
        catch (error) {
            console.error(`Error processing race result for ${user.iracing_username}:`, error);
        }
    }
    getEventTypeName(eventType) {
        const eventTypes = {
            2: 'Practice',
            3: 'Qualifying',
            4: 'Time Trial',
            5: 'Race'
        };
        return eventTypes[eventType] || 'Unknown';
    }
    async postRaceResultToChannels(raceResult, raceData) {
        try {
            const raceLogChannels = await this.db.getAllRaceLogChannels();
            for (const logChannel of raceLogChannels) {
                const channel = await this.client.channels.fetch(logChannel.channel_id);
                if (channel && channel instanceof discord_js_1.TextChannel) {
                    const { embed, attachment } = await this.createRaceResultEmbed(raceResult, raceData);
                    const messageOptions = { embeds: [embed] };
                    if (attachment) {
                        messageOptions.files = [attachment];
                    }
                    await channel.send(messageOptions);
                }
            }
        }
        catch (error) {
            console.error('Error posting race result to channels:', error);
        }
    }
    async createRaceResultEmbed(result, raceData) {
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`🏁 ${result.series_name}`)
            .setColor(this.getPositionColor(result.finish_position))
            .setTimestamp(new Date(result.start_time));
        let attachment;
        try {
            const trackMapPath = await this.iracing.getTrackMapActivePng(result.track_id);
            if (trackMapPath) {
                attachment = new discord_js_1.AttachmentBuilder(trackMapPath, { name: 'track-map.png' });
                embed.setImage('attachment://track-map.png');
            }
        }
        catch (error) {
            console.warn('Could not fetch track map:', error);
        }
        try {
            const carImageUrl = await this.iracing.getCarImageUrl(raceData.car_id);
            if (carImageUrl) {
                embed.setThumbnail(carImageUrl);
            }
        }
        catch (error) {
            console.warn('Could not fetch car image:', error);
        }
        embed.addFields({ name: '🏃 Driver', value: `<@${result.discord_id}> (${result.iracing_username})`, inline: true }, { name: '🏁 Track', value: `${result.track_name}${result.config_name ? ` (${result.config_name})` : ''}`, inline: true }, { name: '🏎️ Car', value: result.car_name, inline: true });
        const startPos = result.starting_position || raceData.start_position;
        const finishPos = result.finish_position;
        const positionChange = startPos ? (startPos - finishPos) : 0;
        const positionChangeStr = positionChange === 0 ? '=' : positionChange > 0 ? `+${positionChange}` : positionChange.toString();
        embed.addFields({ name: '🚦 Starting Position', value: (startPos || 'Unknown').toString(), inline: true }, { name: '🏆 Finishing Position', value: `${finishPos}${this.getOrdinalSuffix(finishPos)}`, inline: true }, { name: '📈 Position Change', value: positionChangeStr, inline: true });
        embed.addFields({ name: '⚠️ Incidents', value: result.incidents.toString(), inline: true }, { name: '🏁 Laps', value: `${raceData.laps || 'Unknown'}`, inline: true }, { name: '🎯 Strength of Field', value: (raceData.strength_of_field || 'Unknown').toString(), inline: true });
        const lapTimeFields = await this.getLapTimeFields(result.subsession_id, result.iracing_customer_id);
        if (lapTimeFields.length > 0) {
            embed.addFields(...lapTimeFields);
        }
        if (raceData.qualifying_time && raceData.qualifying_time > 0) {
            const qualifyingTime = this.iracing.formatLapTime(raceData.qualifying_time);
            embed.addFields({ name: '⏱️ Qualifying Time', value: qualifyingTime, inline: true });
        }
        if (result.irating_before && result.irating_after) {
            const iRatingChange = result.irating_after - result.irating_before;
            const changeStr = iRatingChange >= 0 ? `+${iRatingChange}` : iRatingChange.toString();
            embed.addFields({
                name: '📊 iRating Change',
                value: `${result.irating_before} → ${result.irating_after} (${changeStr})`,
                inline: true
            });
        }
        if (raceData.points) {
            embed.addFields({ name: '🏆 Points Earned', value: raceData.points.toString(), inline: true });
        }
        return { embed, attachment };
    }
    async getLapTimeFields(subsessionId, customerId) {
        try {
            const subsessionDetail = await this.iracing.getSubsessionResult(subsessionId);
            if (!subsessionDetail)
                return [];
            const fields = [];
            const userResult = subsessionDetail.session_results?.[0]?.results?.find((r) => r.cust_id === customerId);
            if (userResult) {
                if (userResult.best_qual_lap_time && userResult.best_qual_lap_time > 0) {
                    const qualTime = this.iracing.formatLapTime(userResult.best_qual_lap_time);
                    fields.push({ name: '🏃 Best Qualifying Lap', value: qualTime, inline: true });
                }
                if (userResult.best_lap_time && userResult.best_lap_time > 0) {
                    const raceTime = this.iracing.formatLapTime(userResult.best_lap_time);
                    fields.push({ name: '⚡ Best Race Lap', value: raceTime, inline: true });
                }
            }
            return fields;
        }
        catch (error) {
            console.warn('Could not fetch lap time data:', error);
            return [];
        }
    }
    getPositionColor(position) {
        if (position === 1)
            return 0xFFD700;
        if (position <= 3)
            return 0xC0C0C0;
        if (position <= 10)
            return 0xCD7F32;
        return 0x808080;
    }
    getOrdinalSuffix(num) {
        const j = num % 10;
        const k = num % 100;
        if (j === 1 && k !== 11)
            return 'st';
        if (j === 2 && k !== 12)
            return 'nd';
        if (j === 3 && k !== 13)
            return 'rd';
        return 'th';
    }
    async start() {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }
        await this.client.login(token);
    }
    async stop() {
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
const bot = new iRacingBot();
bot.start().catch(error => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});
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
//# sourceMappingURL=bot.js.map