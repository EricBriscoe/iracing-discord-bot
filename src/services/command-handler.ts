import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { DataService } from './data-service';
import { LicenseSnapshot } from '../database';

export class CommandHandler {
    private dataService: DataService;

    constructor(dataService: DataService) {
        this.dataService = dataService;
    }

    async handleSearchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        try {
            const targetDriver = interaction.options.getString('driver');
            let searchResult;

            if (targetDriver) {
                // Search for specified driver
                searchResult = await this.dataService.searchAndLoadUser(targetDriver, true);
                
                if (!searchResult) {
                    await interaction.editReply({ 
                        content: `❌ Could not find iRacing driver: ${targetDriver}` 
                    });
                    return;
                }
            } else {
                // Search for the command user's linked account
                searchResult = await this.dataService.findUserByDiscordId(interaction.user.id);
                
                if (!searchResult) {
                    await interaction.editReply({ 
                        content: '❌ You have not linked an iRacing account. Use `/link` to link your account first.' 
                    });
                    return;
                }

                // Load data for linked account
                const memberData = await this.dataService.loadMemberData(searchResult.customerId);
                if (!memberData) {
                    await interaction.editReply({ 
                        content: '❌ Failed to load iRacing data. Please try again later.' 
                    });
                    return;
                }
                searchResult.memberData = memberData;
            }

            if (!searchResult.memberData) {
                await interaction.editReply({ 
                    content: '❌ Failed to load iRacing data. Please try again later.' 
                });
                return;
            }

            const embed = this.createMemberEmbed(searchResult);
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in search command:', error);
            await interaction.editReply({ 
                content: '❌ An error occurred while searching for the user.' 
            });
        }
    }

    private createMemberEmbed(searchResult: any): EmbedBuilder {
        const { memberData, iracingUsername, customerId, discordUserId } = searchResult;
        const { driverData, licenses, recentRaces } = memberData;

        const embed = new EmbedBuilder()
            .setTitle(`🏁 ${driverData.display_name}`)
            .setColor('#FF6B00')
            .addFields(
                { name: 'Customer ID', value: customerId.toString(), inline: true },
                { name: 'Username', value: iracingUsername, inline: true }
            );

        if (discordUserId) {
            embed.addFields({ name: 'Discord User', value: `<@${discordUserId}>`, inline: true });
        }

        // Add license information
        if (licenses && licenses.length > 0) {
            const licenseText = licenses
                .map((license: LicenseSnapshot) => this.formatLicense(license))
                .join('\n');
            embed.addFields({ name: 'Current Licenses', value: licenseText, inline: false });
        }

        // Add recent races
        if (recentRaces && recentRaces.length > 0) {
            const recentRaceText = recentRaces
                .slice(0, 3) // Show only last 3 races
                .map((race: any) => {
                    const date = new Date(race.start_time).toLocaleDateString();
                    return `**${race.series_name}** at ${race.track_name}\nP${race.finish_position} • ${race.incidents} incidents • ${date}`;
                })
                .join('\n\n');
            
            embed.addFields({ name: 'Recent Races', value: recentRaceText, inline: false });
        }

        embed.setFooter({ 
            text: `Data updated: ${new Date(driverData.recorded_at).toLocaleString()}` 
        });

        return embed;
    }

    private formatLicense(license: LicenseSnapshot): string {
        const categories = {
            1: 'Oval',
            2: 'Road',
            3: 'Dirt Oval',
            4: 'Dirt Road'
        };

        const category = categories[license.category_id as keyof typeof categories] || 'Unknown';
        const licenseLevel = String.fromCharCode(65 + license.license_level); // A, B, C, D
        const irating = license.irating ? license.irating.toLocaleString() : 'N/A';
        const safety = license.safety_rating ? license.safety_rating.toFixed(2) : 'N/A';

        return `**${category}:** ${licenseLevel} ${safety} (${irating} iR)`;
    }
}