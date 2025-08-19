"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = require("dotenv");
const database_1 = require("./database");
const data_service_1 = require("./services/data-service");
const command_handler_1 = require("./services/command-handler");
const background_updater_1 = require("./services/background-updater");
(0, dotenv_1.config)();
class iRacingBot {
    constructor() {
        this.client = new discord_js_1.Client({
            intents: [discord_js_1.GatewayIntentBits.Guilds]
        });
        this.db = new database_1.Database();
        this.dataService = new data_service_1.DataService(this.db);
        this.commandHandler = new command_handler_1.CommandHandler(this.dataService);
        this.backgroundUpdater = new background_updater_1.BackgroundUpdater(this.dataService);
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.registerSlashCommands();
            setTimeout(() => {
                this.backgroundUpdater.start();
            }, 30000);
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
                    case 'search':
                        await this.commandHandler.handleSearchCommand(interaction);
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
                .addStringOption(option => option.setName('iracing_name')
                .setDescription('Your iRacing full name or display name')
                .setRequired(true)),
            new discord_js_1.SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink your iRacing account'),
            new discord_js_1.SlashCommandBuilder()
                .setName('search')
                .setDescription('Search for iRacing driver information')
                .addStringOption(option => option.setName('driver')
                .setDescription('iRacing full name or Discord user ID (defaults to your linked account)')
                .setRequired(false))
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
        const iracingName = interaction.options.getString('iracing_name', true);
        try {
            await interaction.deferReply({ ephemeral: true });
            const driverData = await this.dataService.findUserByIracingUsername(iracingName);
            if (!driverData) {
                await interaction.editReply({ content: `❌ Could not find iRacing driver: ${iracingName}` });
                return;
            }
            await this.db.addUser(interaction.user.id, iracingName, driverData.customerId);
            await this.db.saveDriverData(driverData.customerId, iracingName);
            const response = `✅ Linked <@${interaction.user.id}> to **${iracingName}** (ID: ${driverData.customerId})`;
            await interaction.editReply({ content: response });
        }
        catch (error) {
            console.error('Error linking account:', error);
            await interaction.editReply({ content: '❌ An error occurred while linking the account.' });
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
        this.backgroundUpdater.stop();
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