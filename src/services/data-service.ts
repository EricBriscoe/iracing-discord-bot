import { Database, DriverData, LicenseSnapshot, RaceResult } from '../database';
import { NyoomClient, NyoomDriverData } from './nyoom-client';

export interface StoredMemberData {
    driverData: DriverData;
    licenses: LicenseSnapshot[];
    recentRaces: RaceResult[];
}

export interface SearchResult {
    discordUserId?: string;
    iracingUsername: string;
    customerId: number;
    memberData?: StoredMemberData;
}

export class DataService {
    private db: Database;
    private nyoom: NyoomClient;
    private readonly UPDATE_INTERVAL_MINUTES = 15;

    constructor(db: Database) {
        this.db = db;
        this.nyoom = new NyoomClient();
    }

    async findUserByDiscordId(discordId: string): Promise<SearchResult | null> {
        const userData = await this.db.getUser(discordId);
        if (!userData) return null;

        const [username, customerId] = userData;
        if (!customerId) return null;

        return {
            discordUserId: discordId,
            iracingUsername: username,
            customerId
        };
    }

    async findUserByIracingUsername(username: string): Promise<SearchResult | null> {
        const driverData = await this.nyoom.searchDriver(username);
        if (!driverData) return null;

        // Check if this user is linked to a Discord account
        const allUsers = await this.db.getAllUsers();
        const linkedUser = allUsers.find(([, , id]) => id === driverData.customerId);

        return {
            discordUserId: linkedUser?.[0],
            iracingUsername: username,
            customerId: driverData.customerId
        };
    }

    async loadMemberData(customerId: number, forceRefresh = false): Promise<StoredMemberData | null> {
        const needsUpdate = forceRefresh || await this.db.needsDataUpdate(customerId, this.UPDATE_INTERVAL_MINUTES);

        if (needsUpdate) {
            await this.updateDriverData(customerId);
        }

        try {
            const [driverData, licenses, recentRaces] = await Promise.all([
                this.db.getDriverData(customerId),
                this.db.getLatestLicenseSnapshots(customerId),
                this.db.getRecentRaces(customerId)
            ]);

            if (!driverData) return null;

            return {
                driverData,
                licenses,
                recentRaces
            };
        } catch (error) {
            console.error(`Error loading stored member data for ${customerId}:`, error);
            return null;
        }
    }

    private async updateDriverData(customerId: number): Promise<void> {
        try {
            console.log(`Updating data for driver ${customerId}...`);
            
            // Get existing driver data to find the name for searching
            const existingDriver = await this.db.getDriverData(customerId);
            if (!existingDriver) {
                console.warn(`No existing driver data found for ${customerId}`);
                return;
            }

            const driverData = await this.nyoom.searchDriver(existingDriver.display_name);
            if (!driverData) {
                console.warn(`Could not fetch data for driver ${customerId} (${existingDriver.display_name})`);
                return;
            }

            // Save driver basic info
            await this.db.saveDriverData(customerId, driverData.name);

            // Save license snapshots
            for (const license of driverData.licenses) {
                const categoryId = this.mapCategoryNameToId(license.category);
                const licenseLevel = this.mapLicenseLevelToNumber(license.level);
                
                await this.db.saveLicenseSnapshot(
                    customerId,
                    categoryId,
                    licenseLevel,
                    license.safetyRating,
                    license.irating
                );
            }

            // Save race results
            for (const race of driverData.recentResults) {
                await this.db.saveRaceResult(
                    customerId,
                    Math.floor(Math.random() * 1000000), // Generate subsession ID
                    race.series,
                    race.track,
                    race.date,
                    race.position,
                    race.incidents
                );
            }

            console.log(`Updated data for driver ${customerId} (${driverData.name})`);
        } catch (error) {
            console.error(`Error updating driver data for ${customerId}:`, error);
        }
    }

    private mapCategoryNameToId(category: string): number {
        const categoryMap: { [key: string]: number } = {
            'Oval': 1,
            'Road': 2,
            'Dirt Oval': 3,
            'Dirt Road': 4
        };
        return categoryMap[category] || 2; // Default to Road
    }

    private mapLicenseLevelToNumber(level: string): number {
        const levelMap: { [key: string]: number } = {
            'A': 0,
            'B': 1,
            'C': 2,
            'D': 3
        };
        return levelMap[level] || 3; // Default to D
    }

    async searchAndLoadUser(searchTerm: string, loadData = false): Promise<SearchResult | null> {
        let result: SearchResult | null = null;

        // Try to parse as Discord ID first (if it's a numeric string)
        if (/^\d+$/.test(searchTerm)) {
            result = await this.findUserByDiscordId(searchTerm);
        }

        // If not found, try as iRacing username
        if (!result) {
            result = await this.findUserByIracingUsername(searchTerm);
        }

        // If still not found, search directly and create new data
        if (!result) {
            const driverData = await this.nyoom.searchDriver(searchTerm);
            if (driverData) {
                // Save new driver data
                await this.db.saveDriverData(driverData.customerId, driverData.name);
                
                // Create result
                result = {
                    iracingUsername: searchTerm,
                    customerId: driverData.customerId
                };
            }
        }

        // Lazy load member data if requested
        if (result && loadData) {
            const memberData = await this.loadMemberData(result.customerId);
            if (memberData) {
                result.memberData = memberData;
            }
        }

        return result;
    }

    async getLicenseHistory(customerId: number, categoryId: number): Promise<LicenseSnapshot[]> {
        return this.db.getLicenseHistory(customerId, categoryId);
    }

    async getAllStoredDrivers(): Promise<DriverData[]> {
        return this.db.getAllDriverData();
    }

    async getOldestDriver(): Promise<DriverData | null> {
        return this.db.getOldestDriver();
    }
}