import { Database, DriverData, LicenseSnapshot, RaceResult } from '../database';
import { iRacingClient, MemberSummary, RecentRace } from '../iracing-client';

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
    private iracing: iRacingClient;
    private readonly UPDATE_INTERVAL_MINUTES = 15;

    constructor(db: Database, iracing: iRacingClient) {
        this.db = db;
        this.iracing = iracing;
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
        const customerId = await this.iracing.searchMember(username);
        if (!customerId) return null;

        // Check if this user is linked to a Discord account
        const allUsers = await this.db.getAllUsers();
        const linkedUser = allUsers.find(([, , id]) => id === customerId);

        return {
            discordUserId: linkedUser?.[0],
            iracingUsername: username,
            customerId
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
            
            const [summary, recentRaces] = await Promise.all([
                this.iracing.getMemberSummary(customerId),
                this.iracing.getMemberRecentRaces(customerId)
            ]);

            if (!summary) {
                console.warn(`Could not fetch summary for driver ${customerId}`);
                return;
            }

            // Save driver basic info
            await this.db.saveDriverData(customerId, summary.display_name);

            // Save license snapshots
            if (summary.licenses) {
                for (const license of summary.licenses) {
                    await this.db.saveLicenseSnapshot(
                        customerId,
                        license.category_id,
                        license.license_level,
                        license.safety_rating,
                        license.irating
                    );
                }
            }

            // Save race results
            if (recentRaces) {
                for (const race of recentRaces) {
                    await this.db.saveRaceResult(
                        customerId,
                        race.subsession_id,
                        race.series_name,
                        race.track.track_name,
                        race.start_time,
                        race.finish_position,
                        race.incidents
                    );
                }
            }

            console.log(`Updated data for driver ${customerId} (${summary.display_name})`);
        } catch (error) {
            console.error(`Error updating driver data for ${customerId}:`, error);
        }
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