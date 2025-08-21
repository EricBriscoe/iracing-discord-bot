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
            else if (interaction.isAutocomplete()) {
                try {
                    if (interaction.commandName === 'track') {
                        await this.handleTrackAutocomplete(interaction);
                    }
                }
                catch (error) {
                    console.error('Error handling autocomplete:', error);
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
                .setDescription('Unlink your iRacing account from Discord'),
            new discord_js_1.SlashCommandBuilder()
                .setName('track')
                .setDescription('Set this channel to display top lap times for an official series')
                .addStringOption(option => option.setName('series')
                .setDescription('Select an official iRacing series')
                .setRequired(true)
                .setAutocomplete(true))
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
            console.log('Member info response:', memberInfo);
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
            const wasLinked = await this.db.unlinkUser(interaction.user.id);
            if (wasLinked) {
                await interaction.reply({ content: '✅ Successfully unlinked your account.', flags: [discord_js_1.MessageFlags.Ephemeral] });
            }
            else {
                await interaction.reply({ content: '❌ No linked account found.', flags: [discord_js_1.MessageFlags.Ephemeral] });
            }
        }
        catch (error) {
            console.error('Error unlinking account:', error);
            await interaction.reply({ content: '❌ An error occurred while unlinking the account.', flags: [discord_js_1.MessageFlags.Ephemeral] });
        }
    }
    async start() {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }
        await this.client.login(token);
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
    startLapTimeUpdateTimer() {
        setInterval(async () => {
            await this.updateChannelLapTimes();
        }, 60 * 60 * 1000);
        setTimeout(async () => {
            await this.updateChannelLapTimes();
        }, 30000);
    }
    async handleTrackAutocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const allSeries = await this.db.getOfficialSeries();
        const filtered = allSeries
            .filter(series => series.series_name.toLowerCase().includes(focusedValue) ||
            series.series_short_name.toLowerCase().includes(focusedValue) ||
            series.category.toLowerCase().includes(focusedValue))
            .slice(0, 25)
            .map(series => ({
            name: `${series.series_name} (${series.category})`,
            value: series.series_id.toString()
        }));
        await interaction.respond(filtered);
    }
    async handleTrackCommand(interaction) {
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
            await this.db.setChannelTrack(interaction.channel.id, interaction.guildId, selectedSeries.series_id, selectedSeries.series_name);
            if (interaction.channel instanceof discord_js_1.TextChannel) {
                try {
                    console.log(`Clearing messages in channel ${interaction.channel.name} for series tracking`);
                    const messages = await interaction.channel.messages.fetch({ limit: 100 });
                    const messagesToDelete = messages.filter(msg => !msg.pinned && msg.id !== interaction.id);
                    if (messagesToDelete.size > 0) {
                        await interaction.channel.bulkDelete(messagesToDelete, true);
                        console.log(`Deleted ${messagesToDelete.size} messages from tracked channel`);
                    }
                }
                catch (error) {
                    console.error('Error clearing channel messages:', error);
                }
            }
            const response = `✅ This channel is now tracking **${selectedSeries.series_name}** lap times.\n\nChannel messages have been cleared. Lap time leaderboards will appear here for tracked events.`;
            await interaction.editReply({ content: response });
        }
        catch (error) {
            console.error('Error setting channel track:', error);
            await interaction.editReply({ content: '❌ An error occurred while setting up channel tracking.' });
        }
    }
    async updateChannelLapTimes() {
        console.log('Starting lap time update cycle...');
        try {
            const trackedChannels = await this.db.getAllChannelTracks();
            for (const channelTrack of trackedChannels) {
                console.log(`Updating lap times for channel ${channelTrack.channel_id}, series: ${channelTrack.series_name}`);
                await this.updateChannelWithCommonCombos(channelTrack);
            }
            console.log('Lap time update cycle completed');
        }
        catch (error) {
            console.error('Error during lap time update cycle:', error);
        }
    }
    async updateChannelWithCommonCombos(channelTrack) {
        const commonCombos = [
            {
                track_id: 467,
                track_name: 'Virginia International Raceway',
                config_name: 'North Course',
                car_id: 195,
                car_name: 'BMW M2 CS Racing'
            },
            {
                track_id: 324,
                track_name: 'Tsukuba Circuit',
                config_name: '2000 Full',
                car_id: 195,
                car_name: 'BMW M2 CS Racing'
            },
            {
                track_id: 324,
                track_name: 'Tsukuba Circuit',
                config_name: '2000 Full',
                car_id: 67,
                car_name: 'Global Mazda MX-5 Cup'
            }
        ];
        const leaderboards = [];
        for (const combo of commonCombos) {
            const comboData = {
                series_id: channelTrack.series_id,
                track_id: combo.track_id,
                car_id: combo.car_id,
                track_name: combo.track_name,
                config_name: combo.config_name,
                car_name: combo.car_name,
                last_updated: new Date().toISOString()
            };
            const comboId = await this.db.upsertTrackCarCombo(comboData);
            await this.updateLapTimesForCombo(comboId, comboData);
            const topTimes = await this.db.getTopLapTimesForCombo(comboId, 10);
            if (topTimes.length > 0) {
                leaderboards.push({
                    combo: comboData,
                    times: topTimes
                });
            }
        }
        if (leaderboards.length > 0) {
            await this.updateChannelMessages(channelTrack.channel_id, leaderboards);
        }
    }
    async updateChannelMessages(channelId, leaderboards) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel || !(channel instanceof discord_js_1.TextChannel))
                return;
            console.log(`Updating messages in channel ${channel.name}`);
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesToDelete = messages.filter(msg => !msg.pinned);
            if (messagesToDelete.size > 0) {
                await channel.bulkDelete(messagesToDelete, true);
                console.log(`Deleted ${messagesToDelete.size} old messages`);
            }
            for (const leaderboard of leaderboards) {
                const messageContent = this.formatLeaderboard(leaderboard.combo, leaderboard.times);
                await channel.send(messageContent);
                console.log(`Posted leaderboard for ${leaderboard.combo.track_name} - ${leaderboard.combo.car_name}`);
            }
        }
        catch (error) {
            console.error(`Error updating messages in channel ${channelId}:`, error);
        }
    }
    async updateLapTimesForCombo(comboId, combo) {
        const guildUsers = await this.db.getAllLinkedUsers();
        for (const user of guildUsers) {
            if (user.iracing_customer_id) {
                try {
                    const bestTimes = await this.iracing.getMemberBestForTrack(user.iracing_customer_id, combo.track_id, combo.car_id);
                    if (bestTimes.length > 0) {
                        const bestTime = bestTimes[0];
                        if (bestTime) {
                            const record = {
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
                }
                catch (error) {
                    console.error(`Error updating lap times for user ${user.iracing_username}:`, error);
                }
            }
        }
    }
    formatLeaderboard(combo, lapTimes) {
        let leaderboard = `**🏁 ${combo.track_name}** (${combo.config_name})\n`;
        leaderboard += `**🏎️ ${combo.car_name}**\n\n`;
        lapTimes.forEach((record, index) => {
            const position = index + 1;
            const emoji = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : '🏁';
            const lapTime = this.iracing.formatLapTime(record.lap_time_microseconds);
            leaderboard += `${emoji} **${position}.** ${record.iracing_username} - \`${lapTime}\`\n`;
        });
        leaderboard += `\n*Last updated: ${new Date().toLocaleString()}*`;
        return leaderboard;
    }
    async stop() {
        if (this.seriesUpdateInterval) {
            clearInterval(this.seriesUpdateInterval);
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