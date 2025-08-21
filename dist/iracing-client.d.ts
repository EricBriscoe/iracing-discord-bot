export interface MemberSummary {
    cust_id: number;
    display_name: string;
    helmet: {
        pattern: number;
        color1: string;
        color2: string;
        color3: string;
        face_type: number;
        helmet_type: number;
    };
    last_login: string;
    member_since: string;
    flair_id: number;
    flair_name: string;
    flair_shortname: string;
    ai: boolean;
}
export interface MemberResponse {
    success: boolean;
    cust_ids: number[];
    members: MemberSummary[];
}
export interface License {
    category_id: number;
    license_level: number;
    safety_rating: number;
    irating: number;
}
export interface DriverSearchResult {
    cust_id: number;
    display_name: string;
}
export interface RecentRace {
    subsession_id: number;
    series_name: string;
    track: {
        track_name: string;
    };
    start_time: string;
    finish_position: number;
    incidents: number;
}
export interface LicenseGroup {
    group_name: string;
    license_group: number;
    max_license_level: number;
    min_license_level: number;
}
export interface Series {
    series_id: number;
    series_name: string;
    series_short_name: string;
    category: string;
    category_id: number;
    allowed_licenses: LicenseGroup[];
    eligible: boolean;
    first_season: {
        season_year: number;
        season_quarter: number;
    };
    forum_url?: string;
    max_starters: number;
    min_starters: number;
    oval_caution_type: number;
    road_caution_type: number;
    cars?: CarInfo[];
}
export interface Track {
    track_id: number;
    track_name: string;
    config_name: string;
}
export interface SeriesTrackCar {
    series_id: number;
    track_id: number;
    car_id: number;
    track_name: string;
    config_name: string;
    car_name: string;
}
export interface CarInfo {
    car_id: number;
    car_name: string;
}
export interface BestLapTime {
    track: {
        track_id: number;
        track_name: string;
        config_name: string;
    };
    event_type: string;
    best_lap_time: number;
    subsession_id: number;
    end_time: string;
    season_year: number;
    season_quarter: number;
}
export interface MemberBests {
    cust_id: number;
    car_id?: number;
    cars_driven: CarInfo[];
    bests: BestLapTime[];
}
export declare class iRacingClient {
    private username;
    private password;
    private client;
    private authCookie;
    private loginPromise;
    constructor();
    private login;
    private _performLogin;
    private ensureAuthenticated;
    searchMember(username: string): Promise<number | null>;
    getMemberSummary(customerId: number): Promise<MemberSummary | null>;
    getMemberRecentRaces(customerId: number): Promise<RecentRace[] | null>;
    getSeries(): Promise<Series[] | null>;
    getOfficialSeries(): Promise<Series[] | null>;
    getMemberBestLapTimes(customerId: number, carId?: number): Promise<MemberBests | null>;
    formatLapTime(tenThousandths: number): string;
    getMemberBestForTrack(customerId: number, trackId: number, carId?: number): Promise<BestLapTime[]>;
    getSeriesSeasons(seriesId: number): Promise<any>;
    getCurrentSeriesSchedule(seriesId: number): Promise<any>;
}
//# sourceMappingURL=iracing-client.d.ts.map