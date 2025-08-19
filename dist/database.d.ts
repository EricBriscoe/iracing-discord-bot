export interface User {
    discord_id: string;
    iracing_username: string;
    iracing_customer_id: number | null;
    created_at: string;
}
export interface GuildConfig {
    guild_id: string;
    stats_channel_id: string | null;
    stats_message_id: string | null;
    created_at: string;
    updated_at: string;
}
export interface DriverData {
    customer_id: number;
    display_name: string;
    recorded_at: string;
}
export interface LicenseSnapshot {
    id: number;
    customer_id: number;
    category_id: number;
    license_level: number;
    safety_rating: number;
    irating: number;
    recorded_at: string;
}
export interface RaceResult {
    id: number;
    customer_id: number;
    subsession_id: number;
    series_name: string;
    track_name: string;
    start_time: string;
    finish_position: number;
    incidents: number;
    recorded_at: string;
}
export declare class Database {
    private db;
    private dbPath;
    constructor(dbPath?: string);
    initDb(): Promise<void>;
    addUser(discordId: string, iracingUsername: string, iracingCustomerId?: number): Promise<void>;
    getUser(discordId: string): Promise<[string, number | null] | null>;
    getAllUsers(): Promise<[string, string, number | null][]>;
    removeUser(discordId: string): Promise<void>;
    setStatsChannel(guildId: string, channelId: string): Promise<void>;
    getStatsChannel(guildId: string): Promise<[string, string | null] | null>;
    updateStatsMessageId(guildId: string, messageId: string | null): Promise<void>;
    removeStatsChannel(guildId: string): Promise<void>;
    getAllGuildConfigs(): Promise<[string, string, string | null][]>;
    saveDriverData(customerId: number, displayName: string): Promise<void>;
    saveLicenseSnapshot(customerId: number, categoryId: number, licenseLevel: number, safetyRating: number, irating: number): Promise<void>;
    saveRaceResult(customerId: number, subsessionId: number, seriesName: string, trackName: string, startTime: string, finishPosition: number, incidents: number): Promise<void>;
    getDriverData(customerId: number): Promise<DriverData | null>;
    getLatestLicenseSnapshots(customerId: number): Promise<LicenseSnapshot[]>;
    getLicenseHistory(customerId: number, categoryId: number, limit?: number): Promise<LicenseSnapshot[]>;
    getRecentRaces(customerId: number, limit?: number): Promise<RaceResult[]>;
    needsDataUpdate(customerId: number, maxAgeMinutes?: number): Promise<boolean>;
    getAllDriverData(): Promise<DriverData[]>;
    getOldestDriver(): Promise<DriverData | null>;
    close(): void;
}
//# sourceMappingURL=database.d.ts.map