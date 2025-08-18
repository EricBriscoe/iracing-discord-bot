import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, TextChannel, Guild, User, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { config } from 'dotenv';
import { Database } from './database';
import { iRacingClient } from './iracing-client';
import * as cron from 'node-cron';

config();

interface LeaderboardData {
    discordId: string;
    iracingUsername: string;
    irating: number;
    safetyRating: number;
    licenseLevel: number;
}

class iRacingBot {
    private client: Client;
    private db: Database;
    private iracing: iRacingClient;

    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        this.db = new Database();
        this.iracing = new iRacingClient();

        this.setupEventHandlers();
        this.setupCommands();
    }

    private setupEventHandlers(): void {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.registerSlashCommands();
            this.startLeaderboardUpdates();
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            try {
                switch (interaction.commandName) {
                    case 'link':
                        await this.handleLinkCommand(interaction);
                        break;
                    case 'unlink':
                        await this.handleUnlinkCommand(interaction);
                        break;
                    case 'list-links':
                        await this.handleListLinksCommand(interaction);
                        break;
                    case 'toggle-stats-channel':
                        await this.handleToggleStatsChannelCommand(interaction);
                        break;
                }
            } catch (error) {
                console.error('Error handling interaction:', error);
                const errorMessage = 'An error occurred while processing your command.';
                
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: errorMessage, ephemeral: true });
                    } else {
                        await interaction.reply({ content: errorMessage, ephemeral: true });
                    }
                } catch (replyError) {
                    console.error('Failed to send error message to user:', replyError);
                }
            }
        });
    }

    private setupCommands(): void {
        // Commands are registered in registerSlashCommands method
    }

    private async registerSlashCommands(): Promise<void> {
        const commands = [
            new SlashCommandBuilder()
                .setName('link')
                .setDescription('Link an iRacing account to a Discord account')
                .addStringOption(option =>
                    option.setName('iracing_username')
                        .setDescription('The iRacing username to link')
                        .setRequired(true))
                .addUserOption(option =>
                    option.setName('discord_user')
                        .setDescription('[ADMIN ONLY] The Discord user to link (leave empty to link yourself)')
                        .setRequired(false)),

            new SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink an iRacing account from Discord')
                .addUserOption(option =>
                    option.setName('discord_user')
                        .setDescription('[ADMIN ONLY] The Discord user to unlink (leave empty to unlink yourself)')
                        .setRequired(false)),

            new SlashCommandBuilder()
                .setName('list-links')
                .setDescription('[ADMIN] List all linked accounts')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('toggle-stats-channel')
                .setDescription('[ADMIN] Toggle iRacing leaderboard updates for a channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to toggle for leaderboard updates (leave empty to disable)')
                        .setRequired(false))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];

        try {
            console.log('Registering slash commands...');
            await this.client.application?.commands.set(commands);
            console.log('Slash commands registered successfully');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    private isServerOwner(interaction: ChatInputCommandInteraction): boolean {
        return interaction.guild?.ownerId === interaction.user.id;
    }

    private async handleLinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        interaction.deferReply({ ephemeral: true });

        const iracingUsername = interaction.options.getString('iracing_username', true);
        const discordUser = interaction.options.getUser('discord_user');
        const targetUser = discordUser || interaction.user;
        const isAdminAction = discordUser !== null;

        if (isAdminAction && !this.isServerOwner(interaction)) {
            await interaction.editReply({ content: '❌ Only server owners can link accounts for other users.' });
            return;
        }

        try {
            const customerId = await this.iracing.searchMember(iracingUsername);

            if (!customerId) {
                await interaction.editReply({ content: `❌ Could not find iRacing user: ${iracingUsername}` });
                return;
            }

            const memberData = await this.iracing.getMemberSummary(customerId);
            if (!memberData) {
                await interaction.editReply({ content: `❌ Could not retrieve data for iRacing user: ${iracingUsername}` });
                return;
            }

            await this.db.addUser(targetUser.id, iracingUsername, customerId);

            const embed = new EmbedBuilder()
                .setTitle(`✅ Account Linked Successfully${isAdminAction ? ' (Admin)' : ''}`)
                .setColor(isAdminAction ? 0xFF8C00 : 0x00FF00)
                .addFields(
                    { name: 'Discord User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'iRacing User', value: iracingUsername, inline: true },
                    { name: 'Customer ID', value: customerId.toString(), inline: true }
                );

            if (isAdminAction) {
                embed.addFields({ name: 'Linked by', value: `<@${interaction.user.id}>`, inline: true });
            }

            if (memberData.licenses) {
                const roadLicense = memberData.licenses.find(l => l.category_id === 2);
                const ovalLicense = memberData.licenses.find(l => l.category_id === 1);

                if (roadLicense) {
                    embed.addFields({
                        name: 'Road License',
                        value: `${roadLicense.license_level} ${roadLicense.safety_rating.toFixed(2)}`,
                        inline: true
                    });
                }
                if (ovalLicense) {
                    embed.addFields({
                        name: 'Oval License',
                        value: `${ovalLicense.license_level} ${ovalLicense.safety_rating.toFixed(2)}`,
                        inline: true
                    });
                }
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error linking account:', error);
            await interaction.editReply({ content: '❌ An error occurred while linking the account. Please try again later.' });
        }
    }

    private async handleUnlinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        interaction.deferReply({ ephemeral: true });

        const discordUser = interaction.options.getUser('discord_user');
        const targetUser = discordUser || interaction.user;
        const isAdminAction = discordUser !== null;

        if (isAdminAction && !this.isServerOwner(interaction)) {
            await interaction.editReply({ content: '❌ Only server owners can unlink accounts for other users.' });
            return;
        }

        try {
            const userData = await this.db.getUser(targetUser.id);
            if (!userData) {
                const message = isAdminAction 
                    ? `❌ No iRacing account linked to <@${targetUser.id}>.`
                    : '❌ No iRacing account linked to your Discord account.';
                await interaction.editReply({ content: message });
                return;
            }

            await this.db.removeUser(targetUser.id);

            if (isAdminAction) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Account Unlinked Successfully (Admin)')
                    .setColor(0xFF8C00)
                    .addFields(
                        { name: 'Discord User', value: `<@${targetUser.id}>`, inline: true },
                        { name: 'Previous iRacing User', value: userData[0], inline: true },
                        { name: 'Unlinked by', value: `<@${interaction.user.id}>`, inline: true }
                    );
                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply({ content: '✅ Successfully unlinked your iRacing account.' });
            }
        } catch (error) {
            console.error('Error unlinking account:', error);
            await interaction.editReply({ content: '❌ An error occurred while unlinking the account.' });
        }
    }

    private async handleListLinksCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        interaction.deferReply({ ephemeral: true });

        if (!this.isServerOwner(interaction)) {
            await interaction.editReply({ content: '❌ Only server owners can use this command.' });
            return;
        }

        try {
            const users = await this.db.getAllUsers();

            if (users.length === 0) {
                await interaction.editReply({ content: '❌ No linked accounts found.' });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('📋 Linked Accounts')
                .setColor(0x0099FF);

            let linksText = '';
            for (const [discordId, iracingUsername, customerId] of users) {
                const discordUser = await this.client.users.fetch(discordId).catch(() => null);
                const userDisplay = discordUser ? `<@${discordId}>` : `Unknown User (${discordId})`;
                linksText += `${userDisplay} → **${iracingUsername}** (ID: ${customerId})\n`;
            }

            embed.setDescription(linksText);
            embed.setFooter({ text: `Total: ${users.length} linked accounts` });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error listing links:', error);
            await interaction.editReply({ content: '❌ An error occurred while listing linked accounts.' });
        }
    }

    private async handleToggleStatsChannelCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        interaction.deferReply({ ephemeral: true });

        if (!this.isServerOwner(interaction)) {
            await interaction.editReply({ content: '❌ Only server owners can use this command.' });
            return;
        }

        const channel = interaction.options.getChannel('channel') as TextChannel | null;
        const guildId = interaction.guildId!;

        try {
            const currentConfig = await this.db.getStatsChannel(guildId);

            if (!channel) {
                // Disable stats channel
                if (!currentConfig) {
                    await interaction.editReply({ content: '❌ No stats channel is currently configured for this server.' });
                    return;
                }

                await this.db.removeStatsChannel(guildId);

                const embed = new EmbedBuilder()
                    .setTitle('✅ Stats Channel Disabled')
                    .setColor(0xFF8C00)
                    .setDescription('Leaderboard updates have been disabled for this server.')
                    .addFields(
                        { name: 'Guild', value: interaction.guild!.name, inline: true },
                        { name: 'Disabled by', value: `<@${interaction.user.id}>`, inline: true }
                    );

                await interaction.editReply({ embeds: [embed] });
            } else {
                // Set/change stats channel
                await this.db.setStatsChannel(guildId, channel.id);

                const action = currentConfig ? 'Updated' : 'Configured';
                const embed = new EmbedBuilder()
                    .setTitle(`✅ Stats Channel ${action}`)
                    .setColor(0x00FF00)
                    .setDescription(`The leaderboard will now be automatically updated in <#${channel.id}> every 30 minutes.`)
                    .addFields(
                        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                        { name: 'Guild', value: interaction.guild!.name, inline: true },
                        { name: `${action} by`, value: `<@${interaction.user.id}>`, inline: true }
                    );

                await interaction.editReply({ embeds: [embed] });

                // Trigger an immediate leaderboard update for this guild
                this.updateGuildLeaderboard(guildId);
            }
        } catch (error) {
            console.error('Error toggling stats channel:', error);
            await interaction.editReply({ content: '❌ An error occurred while configuring the stats channel.' });
        }
    }

    private async updateGuildLeaderboard(guildId: string): Promise<void> {
        try {
            const config = await this.db.getStatsChannel(guildId);
            if (!config) return;

            const [channelId, messageId] = config;
            const channel = await this.client.channels.fetch(channelId) as TextChannel;
            if (!channel) {
                console.error(`Could not find stats channel ${channelId} for guild ${guildId}`);
                return;
            }

            const guild = await this.client.guilds.fetch(guildId);
            if (!guild) {
                console.error(`Could not find guild ${guildId}`);
                return;
            }

            // Get all users and filter for this guild
            const allUsers = await this.db.getAllUsers();
            const guildUsers: [string, string, number | null][] = [];

            for (const [discordId, iracingUsername, customerId] of allUsers) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member && customerId) {
                        guildUsers.push([discordId, iracingUsername, customerId]);
                    }
                } catch {
                    // User not in guild, skip
                }
            }

            let embed: EmbedBuilder;

            if (guildUsers.length === 0) {
                embed = new EmbedBuilder()
                    .setTitle(`🏁 ${guild.name} iRacing Leaderboard (Road)`)
                    .setColor(0x0099FF)
                    .setDescription('No linked accounts found. Use `/link` to add your iRacing account!')
                    .setFooter({ text: 'Updates every 30 minutes' })
                    .setTimestamp();
            } else {
                const leaderboardData: LeaderboardData[] = [];

                for (const [discordId, iracingUsername, customerId] of guildUsers) {
                    if (!customerId) continue;
                    
                    const memberData = await this.iracing.getMemberSummary(customerId);
                    if (memberData?.licenses) {
                        const roadLicense = memberData.licenses.find(l => l.category_id === 2);

                        if (roadLicense) {
                            leaderboardData.push({
                                discordId,
                                iracingUsername,
                                irating: roadLicense.irating,
                                safetyRating: roadLicense.safety_rating,
                                licenseLevel: roadLicense.license_level
                            });
                        }
                    }
                }

                leaderboardData.sort((a, b) => b.irating - a.irating);

                embed = new EmbedBuilder()
                    .setTitle(`🏁 ${guild.name} iRacing Leaderboard (Road)`)
                    .setColor(0x0099FF)
                    .setFooter({ text: 'Updates every 30 minutes' })
                    .setTimestamp();

                if (leaderboardData.length > 0) {
                    let leaderboardText = '';
                    for (let i = 0; i < Math.min(leaderboardData.length, 10); i++) {
                        const data = leaderboardData[i];
                        if (data) {
                            const member = await guild.members.fetch(data.discordId).catch(() => null);
                            const displayName = member?.displayName || data.iracingUsername;

                            leaderboardText += `${i + 1}. **${displayName}** (${data.iracingUsername})\n`;
                            leaderboardText += `   iRating: ${data.irating} | SR: ${data.safetyRating.toFixed(2)} | License: ${data.licenseLevel}\n\n`;
                        }
                    }
                    embed.setDescription(leaderboardText);
                } else {
                    embed.setDescription('No linked accounts found. Use `/link` to add your iRacing account!');
                }
            }

            // Try to update existing message first
            if (messageId) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    await message.edit({ embeds: [embed] });
                    return;
                } catch {
                    // Message was deleted, clear the message_id
                    await this.db.updateStatsMessageId(guildId, null);
                }
            }

            // Clear channel of bot messages and post new one
            const messages = await channel.messages.fetch({ limit: 100 });
            const botMessages = messages.filter(msg => msg.author.id === this.client.user?.id);
            
            for (const message of botMessages.values()) {
                await message.delete().catch(() => {});
            }

            const newMessage = await channel.send({ embeds: [embed] });
            await this.db.updateStatsMessageId(guildId, newMessage.id);

        } catch (error) {
            console.error(`Error updating leaderboard for guild ${guildId}:`, error);
        }
    }

    private startLeaderboardUpdates(): void {
        // Update leaderboards every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            try {
                const guildConfigs = await this.db.getAllGuildConfigs();
                for (const [guildId] of guildConfigs) {
                    await this.updateGuildLeaderboard(guildId);
                }
            } catch (error) {
                console.error('Error in leaderboard update loop:', error);
            }
        });

        console.log('Leaderboard update scheduler started');
    }

    async start(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }

        await this.client.login(token);
    }

    async stop(): Promise<void> {
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
