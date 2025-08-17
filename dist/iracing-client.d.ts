export interface MemberSummary {
    cust_id: number;
    display_name: string;
    licenses: License[];
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
}
//# sourceMappingURL=iracing-client.d.ts.map