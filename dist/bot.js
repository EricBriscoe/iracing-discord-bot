"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = require("dotenv");
const database_1 = require("./database");
const iracing_client_1 = require("./iracing-client");
const leaderboard_embed_builder_1 = require("./leaderboard-embed-builder");
const axios_1 = __importDefault(require("axios"));
const sharp_1 = __importDefault(require("sharp"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
(0, dotenv_1.config)();
class iRacingBot {
    constructor() {
        this.seriesUpdateInterval = null;
        this.channelMessageMap = new Map();
        this.memoryImageCache = new Map();
        this.client = new discord_js_1.Client({
            intents: [discord_js_1.GatewayIntentBits.Guilds]
        });
        this.db = new database_1.Database();
        this.iracing = new iracing_client_1.iRacingClient();
        this.embedBuilder = new leaderboard_embed_builder_1.LeaderboardEmbedBuilder();
        this.imageCacheDir = path.resolve('data/cache/images');
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.ensureImageCacheDir();
            await this.registerSlashCommands();
            await this.updateOfficialSeries();
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
                .setDescription('Unlink your iRacing account from Discord')
                .addUserOption(option => option.setName('user')
                .setDescription('User to unlink (admin only - leave blank to unlink yourself)')
                .setRequired(false)),
            new discord_js_1.SlashCommandBuilder()
                .setName('track')
                .setDescription('Set this channel to display top lap times for an official series')
                .addStringOption(option => option.setName('series')
                .setDescription('Select an official iRacing series')
                .setRequired(true)
                .setAutocomplete(true)),
            new discord_js_1.SlashCommandBuilder()
                .setName('untrack')
                .setDescription('Remove series tracking from this channel')
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
    async handleUntrackCommand(interaction) {
        try {
            await interaction.deferReply();
            if (!interaction.channel) {
                await interaction.editReply({ content: '❌ This command must be used in a channel.' });
                return;
            }
            const channelTrack = await this.db.getChannelTrack(interaction.channel.id);
            if (!channelTrack) {
                await interaction.editReply({ content: '❌ This channel is not currently tracking any series.' });
                return;
            }
            const wasRemoved = await this.db.removeChannelTrack(interaction.channel.id);
            if (wasRemoved) {
                if (interaction.channel instanceof discord_js_1.TextChannel) {
                    try {
                        console.log(`Clearing messages in channel ${interaction.channel.name} after untracking`);
                        const messages = await interaction.channel.messages.fetch({ limit: 100 });
                        const messagesToDelete = messages.filter(msg => !msg.pinned && msg.id !== interaction.id);
                        if (messagesToDelete.size > 0) {
                            await interaction.channel.bulkDelete(messagesToDelete, true);
                            console.log(`Deleted ${messagesToDelete.size} messages from untracked channel`);
                        }
                    }
                    catch (error) {
                        console.error('Error clearing channel messages:', error);
                    }
                }
                await interaction.editReply({
                    content: `✅ Removed series tracking from this channel.\n\n**${channelTrack.series_name}** is no longer being tracked here. All leaderboard messages have been cleared.`
                });
            }
            else {
                await interaction.editReply({ content: '❌ Failed to remove channel tracking.' });
            }
        }
        catch (error) {
            console.error('Error removing channel track:', error);
            await interaction.editReply({ content: '❌ An error occurred while removing channel tracking.' });
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
    async prepareTrackedChannelsOnStartup() {
        try {
            const trackedChannels = await this.db.getAllChannelTracks();
            for (const channelTrack of trackedChannels) {
                const channel = await this.client.channels.fetch(channelTrack.channel_id);
                if (!channel || !(channel instanceof discord_js_1.TextChannel))
                    continue;
                try {
                    const messages = await channel.messages.fetch({ limit: 100 });
                    const messagesToDelete = messages.filter(m => !m.pinned);
                    if (messagesToDelete.size > 0) {
                        await channel.bulkDelete(messagesToDelete, true);
                        console.log(`Startup: deleted ${messagesToDelete.size} messages in #${channel.name}`);
                    }
                }
                catch (err) {
                    console.error('Error clearing channel on startup:', err);
                }
                const baseEmbeds = this.embedBuilder.build(channelTrack.series_name, []);
                const msg = await channel.send({ embeds: baseEmbeds.slice(0, 10) });
                this.channelMessageMap.set(channel.id, msg.id);
            }
        }
        catch (error) {
            console.error('Error preparing tracked channels on startup:', error);
        }
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
            const response = `✅ This channel is now tracking **${selectedSeries.series_name}** lap times.\n\nChannel messages will be cleared and lap time leaderboards will appear here for tracked events.`;
            await interaction.editReply({ content: response });
            if (interaction.channel instanceof discord_js_1.TextChannel) {
                try {
                    console.log(`Clearing messages in channel ${interaction.channel.name} for series tracking`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const messages = await interaction.channel.messages.fetch({ limit: 100 });
                    const messagesToDelete = messages.filter(msg => !msg.pinned);
                    if (messagesToDelete.size > 0) {
                        await interaction.channel.bulkDelete(messagesToDelete, true);
                        console.log(`Deleted ${messagesToDelete.size} messages from tracked channel`);
                    }
                    await this.postTrackingMessage(interaction.channel.id, selectedSeries.series_name);
                }
                catch (error) {
                    console.error('Error clearing channel messages:', error);
                }
            }
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
        try {
            console.log(`Processing series ${channelTrack.series_id} (${channelTrack.series_name})`);
            const existingCombos = await this.db.getTrackCarCombosBySeriesId(channelTrack.series_id);
            if (existingCombos && existingCombos.length > 0) {
                console.log(`Found ${existingCombos.length} existing track/car combinations for series ${channelTrack.series_id}`);
                const currentTrack = await this.iracing.getCurrentOrNextEventForSeries(channelTrack.series_id);
                let combosToProcess = existingCombos;
                if (currentTrack?.track_id) {
                    combosToProcess = existingCombos.filter(c => c.track_id === currentTrack.track_id && (!currentTrack.config_name || c.config_name === currentTrack.config_name));
                    console.log(`Filtered to ${combosToProcess.length} combos for current track_id=${currentTrack.track_id}`);
                }
                else {
                    console.log('No current track found for series; ignoring old combos');
                    combosToProcess = [];
                }
                const leaderboards = [];
                for (const combo of combosToProcess) {
                    await this.updateLapTimesForCombo(combo.id, combo);
                    const topTimes = await this.db.getTopLapTimesForCombo(combo.id, 10);
                    if (topTimes.length > 0) {
                        leaderboards.push({
                            combo: combo,
                            times: topTimes
                        });
                    }
                }
                let embedOptions = await this.resolveEmbedImagesForCurrent(combosToProcess);
                if (currentTrack?.track_id && combosToProcess.length === 0) {
                    try {
                        const [trackUrl, mapActiveUrl] = await Promise.all([
                            this.iracing.getTrackImageUrl(currentTrack.track_id),
                            this.iracing.getTrackMapActiveUrl(currentTrack.track_id)
                        ]);
                        if (trackUrl)
                            embedOptions.trackImageUrl = trackUrl;
                        if (mapActiveUrl)
                            embedOptions.trackMapActiveUrl = mapActiveUrl;
                    }
                    catch { }
                }
                await this.updateChannelSingleMessage(channelTrack.channel_id, channelTrack.series_name, leaderboards, embedOptions);
                console.log(`Updated consolidated message for series ${channelTrack.series_name}`);
                return;
            }
            console.log(`No existing combinations found for series ${channelTrack.series_id}, posting tracking message`);
            await this.postTrackingMessage(channelTrack.channel_id, channelTrack.series_name);
        }
        catch (error) {
            console.error(`Error updating channel with combos for ${channelTrack.series_name}:`, error);
        }
    }
    async updateChannelSingleMessage(channelId, seriesName, leaderboards, options) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel || !(channel instanceof discord_js_1.TextChannel))
                return;
            let files;
            let embedOptions = options;
            if (options?.trackMapActiveUrl && !options.trackMapActiveUrl.startsWith('attachment://')) {
                try {
                    const png = await this.getRasterizedPng(options.trackMapActiveUrl);
                    const attachmentName = 'track-map.png';
                    files = [new discord_js_1.AttachmentBuilder(png, { name: attachmentName })];
                    embedOptions = { ...options, trackMapActiveUrl: `attachment://${attachmentName}` };
                }
                catch (e) {
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
                }
                catch (e) {
                    console.warn(`Failed to fetch/edit existing message ${messageId} in ${channelId}, sending new one.`, e);
                    this.channelMessageMap.delete(channelId);
                }
            }
            const newMsg = await channel.send({ embeds: embeds.slice(0, 10), files });
            this.channelMessageMap.set(channelId, newMsg.id);
        }
        catch (error) {
            console.error(`Error updating consolidated message in channel ${channelId}:`, error);
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
    async postTrackingMessage(channelId, seriesName) {
        const embedOptions = await this.resolveEmbedImagesForCurrent([]);
        await this.updateChannelSingleMessage(channelId, seriesName, [], embedOptions);
        console.log(`Ensured base tracking message for series ${seriesName}`);
    }
    async resolveEmbedImagesForCurrent(combos) {
        const opts = {};
        try {
            if (combos.length > 0) {
                const first = combos[0];
                const tId = first.track_id;
                const [trackUrl, mapActiveUrl] = await Promise.all([
                    this.iracing.getTrackImageUrl(tId),
                    this.iracing.getTrackMapActiveUrl(tId)
                ]);
                if (trackUrl)
                    opts.trackImageUrl = trackUrl;
                if (mapActiveUrl)
                    opts.trackMapActiveUrl = mapActiveUrl;
                const cId = first.car_id;
                const carUrl = await this.iracing.getCarImageUrl(cId);
                if (carUrl)
                    opts.carImageUrl = carUrl;
            }
            else {
            }
        }
        catch (e) {
            console.warn('Failed to resolve embed images:', e);
        }
        return opts;
    }
    async ensureImageCacheDir() {
        try {
            await fs.mkdir(this.imageCacheDir, { recursive: true });
        }
        catch { }
    }
    hashUrl(url) {
        return (0, crypto_1.createHash)('sha256').update(url).digest('hex');
    }
    async getRasterizedPng(svgUrl) {
        const key = this.hashUrl(svgUrl);
        const inMem = this.memoryImageCache.get(key);
        if (inMem)
            return inMem;
        await this.ensureImageCacheDir();
        const filePath = path.join(this.imageCacheDir, `${key}.png`);
        try {
            const onDisk = await fs.readFile(filePath);
            this.memoryImageCache.set(key, onDisk);
            return onDisk;
        }
        catch { }
        const res = await axios_1.default.get(svgUrl, { responseType: 'arraybuffer' });
        const input = Buffer.from(res.data);
        const png = await (0, sharp_1.default)(input, { density: 300 })
            .png({ compressionLevel: 9 })
            .resize({ width: 1280, withoutEnlargement: true })
            .toBuffer();
        try {
            await fs.writeFile(filePath, png);
        }
        catch { }
        this.memoryImageCache.set(key, png);
        return png;
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