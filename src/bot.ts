import { Client, GatewayIntentBits, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { config } from 'dotenv';
import { Database } from './database';
import { iRacingClient } from './iracing-client';
import { DataService } from './services/data-service';
import { CommandHandler } from './services/command-handler';
import { BackgroundUpdater } from './services/background-updater';

config();

class iRacingBot {
    private client: Client;
    private db: Database;
    private iracing: iRacingClient;
    private dataService: DataService;
    private commandHandler: CommandHandler;
    private backgroundUpdater: BackgroundUpdater;

    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        this.db = new Database();
        this.iracing = new iRacingClient();
        this.dataService = new DataService(this.db, this.iracing);
        this.commandHandler = new CommandHandler(this.dataService);
        this.backgroundUpdater = new BackgroundUpdater(this.dataService);
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.once('ready', async () => {
            console.log(`${this.client.user?.tag} has connected to Discord!`);
            await this.db.initDb();
            await this.registerSlashCommands();
            
            // Start background updater after a short delay
            setTimeout(() => {
                this.backgroundUpdater.start();
            }, 30000); // Start after 30 seconds
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
                    case 'search':
                        await this.commandHandler.handleSearchCommand(interaction);
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
        });
    }

    private async registerSlashCommands(): Promise<void> {
        const commands = [
            new SlashCommandBuilder()
                .setName('link')
                .setDescription('Link an iRacing account')
                .addStringOption(option =>
                    option.setName('iracing_name')
                        .setDescription('Your iRacing full name or display name')
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink your iRacing account'),

            new SlashCommandBuilder()
                .setName('search')
                .setDescription('Search for iRacing driver information')
                .addStringOption(option =>
                    option.setName('driver')
                        .setDescription('iRacing full name or Discord user ID (defaults to your linked account)')
                        .setRequired(false))
        ];

        try {
            console.log('Registering slash commands...');
            await this.client.application?.commands.set(commands);
            console.log('Slash commands registered successfully');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    private async handleLinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const iracingName = interaction.options.getString('iracing_name', true);
        
        try {
            // Search for the iRacing user
            const customerId = await this.iracing.searchMember(iracingName);
            
            if (!customerId) {
                await interaction.reply({ content: `❌ Could not find iRacing driver: ${iracingName}`, ephemeral: true });
                return;
            }

            // Get member summary to verify account exists
            const memberData = await this.iracing.getMemberSummary(customerId);
            if (!memberData) {
                await interaction.reply({ content: `❌ Could not retrieve data for iRacing driver: ${iracingName}`, ephemeral: true });
                return;
            }

            // Save to database
            await this.db.addUser(interaction.user.id, iracingName, customerId);
            
            // Create success response with user data
            const response = `✅ Linked <@${interaction.user.id}> to **${memberData.display_name}** (ID: ${customerId})`;
            
            await interaction.reply({ content: response, ephemeral: true });
        } catch (error) {
            console.error('Error linking account:', error);
            await interaction.reply({ content: '❌ An error occurred while linking the account.', ephemeral: true });
        }
    }

    private async handleUnlinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await this.db.removeUser(interaction.user.id);
            await interaction.reply({ content: '✅ Successfully unlinked your account.', ephemeral: true });
        } catch (error) {
            console.error('Error unlinking account:', error);
            await interaction.reply({ content: '❌ An error occurred while unlinking the account.', ephemeral: true });
        }
    }

    async start(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            throw new Error('DISCORD_TOKEN environment variable not set');
        }

        await this.client.login(token);
    }

    async stop(): Promise<void> {
        this.backgroundUpdater.stop();
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