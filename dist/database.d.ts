export interface UserLink {
    discord_id: string;
    iracing_username: string;
    iracing_customer_id: number | null;
    created_at: string;
}
export interface OfficialSeries {
    series_id: number;
    series_name: string;
    series_short_name: string;
    category: string;
    category_id: number;
    last_updated: string;
}
export interface ChannelTrack {
    channel_id: string;
    guild_id: string;
    series_id: number;
    series_name: string;
    created_at: string;
}
export interface TrackCarCombo {
    id?: number;
    series_id: number;
    track_id: number;
    car_id: number;
    track_name: string;
    config_name: string;
    car_name: string;
    last_updated: string;
}
export interface RaceResult {
    id?: number;
    subsession_id: number;
    discord_id: string;
    iracing_customer_id: number;
    iracing_username: string;
    series_id: number;
    series_name: string;
    track_id: number;
    track_name: string;
    config_name: string;
    car_id: number;
    car_name: string;
    start_time: string;
    finish_position: number;
    starting_position?: number;
    incidents: number;
    irating_before?: number;
    irating_after?: number;
    license_level_before?: number;
    license_level_after?: number;
    event_type: string;
    official_session: boolean;
    created_at: string;
    last_updated: string;
}
export interface RaceLogChannel {
    channel_id: string;
    guild_id: string;
    created_at: string;
}
export declare class Database {
    private db;
    private dbPath;
    constructor(dbPath?: string);
    initDb(): Promise<void>;
    linkUser(discordId: string, iracingUsername: string, iracingCustomerId?: number): Promise<void>;
    getLinkedUser(discordId: string): Promise<UserLink | null>;
    unlinkUser(discordId: string): Promise<boolean>;
    getAllLinkedUsers(): Promise<UserLink[]>;
    updateOfficialSeries(seriesList: OfficialSeries[]): Promise<void>;
    getOfficialSeries(): Promise<OfficialSeries[]>;
    setChannelTrack(channelId: string, guildId: string, seriesId: number, seriesName: string): Promise<void>;
    getChannelTrack(channelId: string): Promise<ChannelTrack | null>;
    removeChannelTrack(channelId: string): Promise<boolean>;
    getGuildLinkedUsers(guildId: string): Promise<UserLink[]>;
    getAllChannelTracks(): Promise<ChannelTrack[]>;
    upsertTrackCarCombo(combo: TrackCarCombo): Promise<number>;
    getTrackCarCombosBySeriesId(seriesId: number): Promise<TrackCarCombo[]>;
    setRaceLogChannel(channelId: string, guildId: string): Promise<void>;
    getRaceLogChannel(channelId: string): Promise<RaceLogChannel | null>;
    getAllRaceLogChannels(): Promise<RaceLogChannel[]>;
    removeRaceLogChannel(channelId: string): Promise<boolean>;
    upsertRaceResult(result: RaceResult): Promise<void>;
    getRecentRaceResults(discordId: string, limit?: number): Promise<RaceResult[]>;
    getAllRaceResultsAsc(): Promise<RaceResult[]>;
    getRaceResultsForUserAsc(discordId: string, opts?: {
        trackId?: number;
        carId?: number;
    }): Promise<RaceResult[]>;
    getRaceResultExists(subsessionId: number, discordId: string): Promise<boolean>;
    getLatestRaceResultTime(discordId: string): Promise<string | null>;
    close(): void;
}
//# sourceMappingURL=database.d.ts.map