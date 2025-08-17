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
    close(): void;
}
//# sourceMappingURL=database.d.ts.map