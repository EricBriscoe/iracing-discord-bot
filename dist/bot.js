"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const sharp_1 = __importDefault(require("sharp"));
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
            else if (interaction.isButton()) {
                try {
                    await this.handleHistoryButton(interaction);
                }
                catch (error) {
                    console.error('Error handling button interaction:', error);
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
                .setDescription('Set this channel to receive race result notifications for tracked members'),
            new discord_js_1.SlashCommandBuilder()
                .setName('history')
                .setDescription('Show your % over WR history for all cars on a track, with range & track navigation')
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
    async clearRaceLogChannel(channel) {
        try {
            console.log(`Clearing channel ${channel.id} (${channel.name})...`);
            let lastId = undefined;
            const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
            while (true) {
                const batch = await channel.messages.fetch({ limit: 100, before: lastId });
                if (batch.size === 0)
                    break;
                const now = Date.now();
                const nonPinned = batch.filter((m) => !m.pinned);
                const younger = nonPinned.filter((m) => now - m.createdTimestamp < fourteenDaysMs);
                const older = nonPinned.filter((m) => now - m.createdTimestamp >= fourteenDaysMs);
                if (younger.size > 0) {
                    try {
                        await channel.bulkDelete(younger, true);
                    }
                    catch (e) {
                        for (const msg of younger.values()) {
                            try {
                                await msg.delete();
                            }
                            catch { }
                        }
                    }
                }
                for (const msg of older.values()) {
                    try {
                        await msg.delete();
                    }
                    catch { }
                }
                lastId = batch.last()?.id;
                if (!lastId || batch.size < 100)
                    break;
            }
            console.log(`Channel ${channel.id} cleared.`);
        }
        catch (err) {
            console.error(`Failed to clear channel ${channel.id}:`, err);
        }
    }
    async repostAllFromDatabaseOldestFirst() {
        try {
            console.log('Reposting all race results from database (oldest → newest)...');
            const results = await this.db.getAllRaceResultsAsc();
            let count = 0;
            for (const result of results) {
                let raceData = { car_id: result.car_id, start_position: result.starting_position };
                try {
                    const subsession = await this.iracing.getSubsessionResult(result.subsession_id);
                    if (subsession) {
                        raceData.event_laps_complete = subsession.event_laps_complete;
                        raceData.event_strength_of_field = subsession.event_strength_of_field;
                        const getType = (sr) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
                        const raceSession = Array.isArray(subsession.session_results) ? subsession.session_results.find((sr) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr))) : null;
                        const userRow = raceSession?.results?.find((r) => r.cust_id === result.iracing_customer_id);
                        if (userRow && typeof userRow.laps_complete === 'number') {
                            raceData.laps = userRow.laps_complete;
                        }
                    }
                }
                catch { }
                await this.postRaceResultToChannels(result, raceData);
                count++;
            }
            console.log(`Reposted ${count} results from database.`);
        }
        catch (err) {
            console.error('Error while reposting from database:', err);
        }
    }
    async backfillRecentFromApiOldestFirst() {
        try {
            console.log('Backfilling recent results from API (oldest → newest)...');
            const linkedUsers = await this.db.getAllLinkedUsers();
            for (const user of linkedUsers) {
                if (!user.iracing_customer_id)
                    continue;
                try {
                    const recent = await this.iracing.getMemberRecentRaces(user.iracing_customer_id);
                    if (!recent || recent.length === 0)
                        continue;
                    const toProcess = [];
                    for (const race of recent) {
                        const exists = await this.db.getRaceResultExists(race.subsession_id, user.discord_id);
                        if (!exists)
                            toProcess.push(race);
                    }
                    toProcess.sort((a, b) => new Date(a.session_start_time).getTime() - new Date(b.session_start_time).getTime());
                    for (const race of toProcess) {
                        await this.processNewRaceResult(race, user);
                    }
                }
                catch (e) {
                    console.error(`Backfill error for user ${user.iracing_username}:`, e);
                }
            }
            console.log('API backfill completed.');
        }
        catch (err) {
            console.error('Error during API backfill:', err);
        }
    }
    async rebuildRaceLogsOnStartup() {
        try {
            const raceLogChannels = await this.db.getAllRaceLogChannels();
            if (raceLogChannels.length === 0)
                return;
            for (const logChannel of raceLogChannels) {
                const channel = await this.client.channels.fetch(logChannel.channel_id);
                if (channel && channel instanceof discord_js_1.TextChannel) {
                    await this.clearRaceLogChannel(channel);
                }
            }
            await this.repostAllFromDatabaseOldestFirst();
            await this.backfillRecentFromApiOldestFirst();
        }
        catch (err) {
            console.error('Error rebuilding race logs on startup:', err);
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
        const lapsValue = (typeof raceData.laps === 'number')
            ? raceData.laps
            : (typeof raceData.event_laps_complete === 'number')
                ? raceData.event_laps_complete
                : 'Unknown';
        const sofValue = (typeof raceData.strength_of_field === 'number')
            ? raceData.strength_of_field
            : (typeof raceData.event_strength_of_field === 'number')
                ? raceData.event_strength_of_field
                : 'Unknown';
        embed.addFields({ name: '⚠️ Incidents', value: result.incidents.toString(), inline: true }, { name: '🏁 Laps', value: String(lapsValue), inline: true }, { name: '🎯 Strength of Field', value: String(sofValue), inline: true });
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
            if (!subsessionDetail || !Array.isArray(subsessionDetail.session_results))
                return [];
            const fields = [];
            const getType = (sr) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
            const raceSession = subsessionDetail.session_results.find((sr) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr)));
            const raceUser = raceSession?.results?.find((r) => r.cust_id === customerId);
            if (raceUser && raceUser.best_lap_time && raceUser.best_lap_time > 0) {
                const raceTime = this.iracing.formatLapTime(raceUser.best_lap_time);
                fields.push({ name: '⚡ Best Race Lap', value: raceTime, inline: true });
            }
            const qualSession = subsessionDetail.session_results.find((sr) => /qual/i.test(getType(sr)));
            const qualUser = qualSession?.results?.find((r) => r.cust_id === customerId);
            if (qualUser && qualUser.best_qual_lap_time && qualUser.best_qual_lap_time > 0) {
                const qualTime = this.iracing.formatLapTime(qualUser.best_qual_lap_time);
                fields.push({ name: '🏃 Best Qualifying Lap', value: qualTime, inline: true });
            }
            return fields;
        }
        catch (error) {
            console.warn('Could not fetch lap time data:', error);
            return [];
        }
    }
    async handleHistoryCommand(interaction) {
        try {
            const linked = await this.db.getLinkedUser(interaction.user.id);
            if (!linked || !linked.iracing_customer_id) {
                await interaction.reply({ content: '❌ You need to link your iRacing account first using /link.', flags: [discord_js_1.MessageFlags.Ephemeral] });
                return;
            }
            await interaction.deferReply({ flags: [discord_js_1.MessageFlags.Ephemeral] });
            const range = '90d';
            const { imageBuffer, embed } = await this.buildHistoryResponse(interaction.user.id, linked.iracing_customer_id, range);
            const attachment = new discord_js_1.AttachmentBuilder(imageBuffer, { name: 'history.png' });
            const rows = this.buildHistoryButtons(interaction.user.id, range);
            await interaction.editReply({ embeds: [embed], files: [attachment], components: rows });
        }
        catch (error) {
            console.error('Error handling /history:', error);
            try {
                await interaction.editReply({ content: '❌ Failed to build history chart.' });
            }
            catch { }
        }
    }
    buildHistoryButtons(userId, active) {
        const ranges = [
            { k: '30d', label: '30d' },
            { k: '90d', label: '90d' },
            { k: '6m', label: '6m' },
            { k: '1y', label: '1y' },
            { k: 'all', label: 'All' }
        ];
        const buttons = ranges.map(r => new discord_js_1.ButtonBuilder()
            .setCustomId(`history|${userId}|${r.k}`)
            .setLabel(r.label)
            .setStyle(r.k === active ? discord_js_1.ButtonStyle.Primary : discord_js_1.ButtonStyle.Secondary));
        const row = new discord_js_1.ActionRowBuilder().addComponents(...buttons);
        return [row];
    }
    async handleHistoryButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('history|'))
            return;
        const parts = customId.split('|');
        if (parts.length !== 3)
            return;
        const uid = parts[1];
        const range = parts[2];
        if (interaction.user.id !== uid) {
            await interaction.reply({ content: '❌ Only the original requester can use these buttons.', ephemeral: true });
            return;
        }
        const linked = await this.db.getLinkedUser(uid);
        if (!linked || !linked.iracing_customer_id) {
            await interaction.reply({ content: '❌ Your account is no longer linked.', ephemeral: true });
            return;
        }
        try {
            await interaction.deferUpdate();
        }
        catch { }
        const { imageBuffer, embed } = await this.buildHistoryResponse(uid, linked.iracing_customer_id, range);
        const attachment = new discord_js_1.AttachmentBuilder(imageBuffer, { name: 'history.png' });
        const rows = this.buildHistoryButtons(uid, range);
        await interaction.editReply({ embeds: [embed], files: [attachment], components: rows });
    }
    async pickTrackAndCarForUser(discordId, trackQuery, inputCarId) {
        const all = await this.db.getRaceResultsForUserAsc(discordId);
        if (all.length === 0)
            return null;
        let candidates = all;
        if (trackQuery) {
            const q = trackQuery.toLowerCase();
            const filtered = all.filter(r => (r.track_name && r.track_name.toLowerCase().includes(q)) || (r.config_name && r.config_name.toLowerCase().includes(q)));
            if (filtered.length > 0)
                candidates = filtered;
        }
        if (candidates.length === 0)
            return null;
        const latest = candidates[candidates.length - 1];
        const trackId = latest.track_id;
        let carId = inputCarId || latest.car_id;
        if (!carId) {
            const onTrack = all.filter(r => r.track_id === trackId);
            if (onTrack.length > 0) {
                const last = onTrack[onTrack.length - 1];
                if (last)
                    carId = last.car_id;
            }
        }
        const carName = latest.car_name || 'Car';
        const cfg = latest.config_name || '';
        const trackName = cfg ? `${latest.track_name} (${cfg})` : latest.track_name;
        return { trackId, carId, trackName, carName };
    }
    async buildHistoryResponse(discordId, customerId, range) {
        const { points, combos } = await this.collectHistoryPoints(discordId, customerId, range);
        const svg = this.renderHistorySvg(points, { title: `All Tracks • All Cars`, range });
        const imageBuffer = await (0, sharp_1.default)(Buffer.from(svg)).png().toBuffer();
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle('Lap vs World Record')
            .setDescription(`All tracks and cars`)
            .addFields({ name: 'Points', value: String(points.length), inline: true }, { name: 'Range', value: range.toUpperCase(), inline: true }, { name: 'Combos', value: String(combos), inline: true })
            .setImage('attachment://history.png')
            .setColor(0x3b82f6);
        return { imageBuffer, embed };
    }
    async collectHistoryPoints(discordId, customerId, range) {
        const all = await this.db.getRaceResultsForUserAsc(discordId);
        const cutoff = this.rangeToCutoff(range);
        const filtered = cutoff ? all.filter(r => new Date(r.start_time).getTime() >= cutoff) : all;
        const comboKeys = new Set();
        for (const r of filtered)
            comboKeys.add(`${r.car_id}:${r.track_id}`);
        const wrCache = new Map();
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
        const bestLapCache = new Map();
        const points = [];
        for (const r of filtered) {
            let best = bestLapCache.get(r.subsession_id) ?? null;
            if (best === null && !bestLapCache.has(r.subsession_id)) {
                best = await this.getUserBestRaceLap(r.subsession_id, customerId);
                bestLapCache.set(r.subsession_id, best);
            }
            const wr = wrCache.get(`${r.car_id}:${r.track_id}`);
            if (!best || !wr || wr <= 0)
                continue;
            const pct = ((best - wr) / wr) * 100;
            const t = new Date(r.start_time).getTime();
            points.push({ t, y: pct });
        }
        return { points, combos: comboKeys.size };
    }
    rangeToCutoff(range) {
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
    async getUserBestRaceLap(subsessionId, customerId) {
        const ss = await this.iracing.getSubsessionResult(subsessionId);
        if (!ss || !Array.isArray(ss.session_results))
            return null;
        const getType = (sr) => (sr?.simsession_type_name || sr?.simsession_name || sr?.session_type || '').toString();
        const raceSession = ss.session_results.find((sr) => /race/i.test(getType(sr)) && !/qual/i.test(getType(sr)));
        const row = raceSession?.results?.find((x) => x.cust_id === customerId);
        const best = row?.best_lap_time;
        return typeof best === 'number' && best > 0 ? best : null;
    }
    renderHistorySvg(points, opts) {
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
        const xScale = (x) => margin + (times.length <= 1 ? innerW / 2 : ((x - minX) / (maxX - minX)) * innerW);
        const yScale = (y) => margin + innerH - ((y - y0) / (y1 - y0)) * innerH;
        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');
        const loess = this.loessSmooth(points, { resolution: Math.min(300, Math.max(120, points.length * 8)), robust: true });
        const yTicks = 5;
        const ticks = [];
        for (let i = 0; i <= yTicks; i++)
            ticks.push(y0 + (i * (y1 - y0) / yTicks));
        const fmtPct = (v) => `${v.toFixed(1)}%`;
        const pointsCircles = points.map(p => `<circle cx="${xScale(p.t).toFixed(1)}" cy="${yScale(p.y).toFixed(1)}" r="3" fill="#93c5fd" stroke="#1d4ed8" stroke-width="1" />`).join('\n');
        return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<svg width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" xmlns=\"http://www.w3.org/2000/svg\">
  <rect x=\"0\" y=\"0\" width=\"${width}\" height=\"${height}\" fill=\"#0b1220\" />
  <text x=\"${width / 2}\" y=\"30\" fill=\"#e5e7eb\" font-family=\"DejaVu Sans, Liberation Sans, Arial, sans-serif\" font-size=\"20\" text-anchor=\"middle\">${opts.title} • ${opts.range.toUpperCase()}</text>
  <line x1=\"${margin}\" y1=\"${margin}\" x2=\"${margin}\" y2=\"${height - margin}\" stroke=\"#334155\" stroke-width=\"1\" />
  <line x1=\"${margin}\" y1=\"${height - margin}\" x2=\"${width - margin}\" y2=\"${height - margin}\" stroke=\"#334155\" stroke-width=\"1\" />
  ${ticks.map(t => `<g>
    <line x1=\"${margin}\" y1=\"${yScale(t).toFixed(1)}\" x2=\"${width - margin}\" y2=\"${yScale(t).toFixed(1)}\" stroke=\"#1f2937\" stroke-width=\"1\" opacity=\"0.4\" />
    <text x=\"${margin - 10}\" y=\"${yScale(t).toFixed(1)}\" fill=\"#9ca3af\" font-size=\"12\" text-anchor=\"end\" dominant-baseline=\"middle\">${fmtPct(t)}</text>
  </g>`).join('')}
  ${pointsCircles}
  ${loess.length > 1 ? `<path d=\"${loess.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ')}\" fill=\"none\" stroke=\"#22c55e\" stroke-dasharray=\"6 6\" stroke-width=\"2\" />` : ''}
  <g transform=\"translate(${width - margin - 200}, ${margin})\">
    <rect x=\"0\" y=\"0\" width=\"200\" height=\"60\" fill=\"#0f172a\" stroke=\"#334155\" />
    <circle cx=\"12\" cy=\"14\" r=\"4\" fill=\"#2563eb\" /><text x=\"24\" y=\"18\" fill=\"#e5e7eb\" font-size=\"12\">Point (% over WR)</text>
    <line x1=\"8\" y1=\"32\" x2=\"20\" y2=\"32\" stroke=\"#22c55e\" stroke-dasharray=\"6 6\" stroke-width=\"2\" />
    <text x=\"24\" y=\"36\" fill=\"#e5e7eb\" font-size=\"12\">Trend</text>
  </g>
</svg>`;
    }
    linearRegression(points) {
        if (points.length < 2)
            return null;
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
            if (typeof yi !== 'number')
                continue;
            const xi = nx[i] ?? 0;
            sumXY += xi * yi;
        }
        const sumXX = nx.reduce((a, x) => a + x * x, 0);
        const denom = n * sumXX - sumX * sumX;
        if (denom === 0)
            return null;
        const mDay = (n * sumXY - sumX * sumY) / denom;
        const b = (sumY - mDay * sumX) / n;
        const m = mDay / (24 * 60 * 60 * 1000);
        return { m, b: b - m * x0 };
    }
    loessSmooth(points, opts) {
        const pts = points.slice().sort((a, b) => a.t - b.t);
        const n = pts.length;
        if (n === 0)
            return [];
        if (n === 1)
            return [pts[0]];
        const autoSpan = n <= 20 ? 0.85 : n <= 50 ? 0.65 : 0.45;
        const span = Math.min(0.95, Math.max(0.2, opts?.span ?? autoSpan));
        const k = Math.max(2, Math.ceil(span * n));
        const xs = pts.map(p => p.t);
        const ys = pts.map(p => p.y);
        const minX = xs[0];
        const maxX = xs[n - 1];
        const resolution = Math.max(100, Math.min(360, opts?.resolution ?? 240));
        const evalXs = [];
        if (resolution >= n) {
            for (const x of xs)
                evalXs.push(x);
        }
        else {
            const step = (maxX - minX) / (resolution - 1 || 1);
            for (let i = 0; i < resolution; i++)
                evalXs.push(minX + i * step);
        }
        const yhatAt = (x0, robustW) => {
            const distances = xs.map((x, idx) => ({ idx, d: Math.abs(x - x0) }));
            distances.sort((a, b) => a.d - b.d);
            const window = distances.slice(0, k);
            const last = window[window.length - 1];
            const dmax = (last ? last.d : 0) || 1e-9;
            let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
            for (const { idx, d } of window) {
                const u = d / dmax;
                let w = (1 - Math.pow(u, 3)) ** 3;
                if (robustW && typeof robustW[idx] === 'number')
                    w *= robustW[idx];
                const x = xs[idx];
                const y = ys[idx];
                Sw += w;
                Sx += w * x;
                Sy += w * y;
                Sxx += w * x * x;
                Sxy += w * x * y;
            }
            const denom = Sw * Sxx - Sx * Sx;
            if (Math.abs(denom) < 1e-12 || Sw === 0)
                return Sy / (Sw || 1);
            const a = (Sxx * Sy - Sx * Sxy) / denom;
            const b = (Sw * Sxy - Sx * Sy) / denom;
            return a + b * x0;
        };
        const initialFits = xs.map(x0 => yhatAt(x0));
        let robustW = undefined;
        if (opts?.robust !== false) {
            const computeRobustWeights = (fits) => {
                const residuals = ys.map((y, i) => y - fits[i]);
                const absRes = residuals.map(r => Math.abs(r)).sort((a, b) => a - b);
                const median = absRes.length > 0
                    ? (absRes.length % 2 === 1
                        ? absRes[(absRes.length - 1) >> 1]
                        : ((absRes[absRes.length / 2 - 1] + absRes[absRes.length / 2]) / 2))
                    : 0;
                const s = median > 0 ? 4.685 * median : 1e-6;
                return residuals.map(r => {
                    const u = Math.abs(r) / s;
                    if (u >= 1)
                        return 0;
                    return (1 - u * u) ** 2;
                });
            };
            robustW = computeRobustWeights(initialFits);
            const secondFits = xs.map(x0 => yhatAt(x0, robustW));
            robustW = computeRobustWeights(secondFits);
        }
        const out = [];
        for (const x0 of evalXs)
            out.push({ t: x0, y: yhatAt(x0, robustW) });
        const smoothed = [];
        const win = Math.max(3, Math.floor(Math.min(13, Math.round(resolution / 30))));
        const half = Math.floor(win / 2);
        for (let i = 0; i < out.length; i++) {
            let sum = 0, cnt = 0;
            for (let j = i - half; j <= i + half; j++) {
                if (j >= 0 && j < out.length) {
                    sum += out[j].y;
                    cnt++;
                }
            }
            smoothed.push({ t: out[i].t, y: cnt > 0 ? sum / cnt : out[i].y });
        }
        return smoothed;
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