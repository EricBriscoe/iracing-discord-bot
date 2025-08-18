"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = require("dotenv");
const database_1 = require("./database");
(0, dotenv_1.config)();
class iRacingBot {
    constructor() {
        this.client = new discord_js_1.Client({
            intents: [discord_js_1.GatewayIntentBits.Guilds]
        });
        this.db = new database_1.Database();
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.registerSlashCommands();
        });
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand())
                return;
            try {
                switch (interaction.commandName) {
                    case 'link':
                        await this.handleLinkCommand(interaction);
                        break;
                    case 'unlink':
                        await this.handleUnlinkCommand(interaction);
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
        });
    }
    async registerSlashCommands() {
        const commands = [
            new discord_js_1.SlashCommandBuilder()
                .setName('link')
                .setDescription('Link an iRacing account')
                .addStringOption(option => option.setName('iracing_username')
                .setDescription('The iRacing username')
                .setRequired(true)),
            new discord_js_1.SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink your iRacing account')
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
    async handleLinkCommand(interaction) {
        const iracingUsername = interaction.options.getString('iracing_username', true);
        try {
            await this.db.addUser(interaction.user.id, iracingUsername, 123456);
            await interaction.reply({ content: `✅ Linked <@${interaction.user.id}> to ${iracingUsername}`, ephemeral: true });
        }
        catch (error) {
            console.error('Error linking account:', error);
            await interaction.reply({ content: '❌ An error occurred while linking the account.', ephemeral: true });
        }
    }
    async handleUnlinkCommand(interaction) {
        try {
            await this.db.removeUser(interaction.user.id);
            await interaction.reply({ content: '✅ Successfully unlinked your account.', ephemeral: true });
        }
        catch (error) {
            console.error('Error unlinking account:', error);
            await interaction.reply({ content: '❌ An error occurred while unlinking the account.', ephemeral: true });
        }
    }
    async start() {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }
        await this.client.login(token);
    }
    async stop() {
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