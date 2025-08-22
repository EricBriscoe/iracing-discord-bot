import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';

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
    best_lap_time: number; // in microseconds
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

export class iRacingClient {
    private username: string;
    private password: string;
    private client: AxiosInstance;
    private authCookie: string | null = null;
    private loginPromise: Promise<void> | null = null;
    private staticImagesBase = 'https://images-static.iracing.com/';

    constructor() {
        this.username = process.env.IRACING_USERNAME || '';
        
        // Check for pre-hashed password first, fallback to raw password
        if (process.env.IRACING_HASHWORD) {
            this.password = process.env.IRACING_HASHWORD;
        } else {
            this.password = process.env.IRACING_PASSWORD || '';
        }
        
        if (!this.username || !this.password) {
            throw new Error('iRacing credentials not configured');
        }

        this.client = axios.create({
            baseURL: 'https://members-ng.iracing.com',
            timeout: 30000,
            headers: {
                'User-Agent': 'iRacing Discord Bot',
                'Content-Type': 'application/json'
            }
        });
    }

    private async login(): Promise<void> {
        if (this.loginPromise) {
            return this.loginPromise;
        }

        this.loginPromise = this._performLogin();
        return this.loginPromise;
    }

    private async _performLogin(): Promise<void> {
        try {
            // Use pre-hashed password if available, otherwise hash the raw password
            let passwordToSend: string;
            if (process.env.IRACING_HASHWORD) {
                passwordToSend = this.password; // Already hashed
            } else {
                passwordToSend = createHash('sha256')
                    .update(this.password + this.username.toLowerCase())
                    .digest('base64');
            }
            
            const response = await this.client.post('/auth', {
                email: this.username,
                password: passwordToSend
            });

            // iRacing returns both cookies and auth response data
            const cookies = response.headers['set-cookie'];
            let cookieHeader = '';
            
            if (cookies) {
                // Collect all relevant cookies
                const relevantCookies = cookies
                    .filter(cookie => cookie.startsWith('irsso_membersv2=') || cookie.startsWith('authtoken_members='))
                    .map(cookie => cookie.split(';')[0]);
                cookieHeader = relevantCookies.join('; ');
            }

            // Check for authcode in response body for new authentication
            if (response.data && response.data.authcode) {
                this.authCookie = cookieHeader;
            } else if (cookieHeader) {
                this.authCookie = cookieHeader;
            } else {
                throw new Error('Failed to obtain authentication cookie');
            }

            // Set the cookie for future requests
            this.client.defaults.headers.Cookie = this.authCookie;
        } catch (error) {
            this.loginPromise = null;
            throw new Error(`iRacing login failed: ${error}`);
        }
    }

    private async ensureAuthenticated(): Promise<void> {
        if (!this.authCookie) {
            await this.login();
        }
    }

    // Expose the authenticated Axios client for callers that need raw access
    async getHttpClient(): Promise<AxiosInstance> {
        await this.ensureAuthenticated();
        return this.client;
    }

    async searchMember(username: string): Promise<number | null> {
        try {
            await this.ensureAuthenticated();
            
            const response = await this.client.get('/data/lookup/drivers', {
                params: {
                    search_term: username
                }
            });

            const results = response.data as DriverSearchResult[];
            
            if (results && results.length > 0) {
                // Try to find exact match first
                for (const member of results) {
                    if (member.display_name.toLowerCase() === username.toLowerCase()) {
                        return member.cust_id;
                    }
                }
                // Return first result if no exact match
                return results[0]?.cust_id || null;
            }
            
            return null;
        } catch (error) {
            console.error(`Error searching for member ${username}:`, error);
            return null;
        }
    }

    async getMemberSummary(customerId: number): Promise<MemberSummary | null> {
        try {
            await this.ensureAuthenticated();
            
            const response = await this.client.get('/data/member/get', {
                params: {
                    cust_ids: customerId
                }
            });

            // Check if response contains a link to S3 data
            if (response.data.link) {
                console.log('Fetching data from S3 link:', response.data.link);
                const s3Response = await this.client.get(response.data.link);
                const memberResponse = s3Response.data as MemberResponse;
                
                if (memberResponse.success && memberResponse.members && memberResponse.members.length > 0) {
                    return memberResponse.members[0] || null;
                }
            } else {
                // Direct response format
                const memberResponse = response.data as MemberResponse;
                
                if (memberResponse.success && memberResponse.members && memberResponse.members.length > 0) {
                    return memberResponse.members[0] || null;
                }
            }
            
            return null;
        } catch (error) {
            console.error(`Error fetching member summary for ${customerId}:`, error);
            return null;
        }
    }

    async getMemberRecentRaces(customerId: number): Promise<RecentRace[] | null> {
        try {
            await this.ensureAuthenticated();
            
            const response = await this.client.get('/data/stats/member_recent_races', {
                params: {
                    cust_id: customerId
                }
            });

            return response.data as RecentRace[];
        } catch (error) {
            console.error(`Error fetching recent races for ${customerId}:`, error);
            return null;
        }
    }

    async getSeries(): Promise<Series[] | null> {
        try {
            await this.ensureAuthenticated();
            
            const response = await this.client.get('/data/series/get');

            // Check if response contains a link to S3 data
            if (response.data.link) {
                console.log('Fetching series data from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data as Series[];
            } else {
                // Direct response format
                return response.data as Series[];
            }
        } catch (error) {
            console.error('Error fetching series data:', error);
            return null;
        }
    }

    async getOfficialSeries(): Promise<Series[] | null> {
        const allSeries = await this.getSeries();
        if (!allSeries) return null;
        
        // Filter for official series (typically those with certain categories and license requirements)
        return allSeries.filter(series => 
            series.eligible && 
            series.allowed_licenses.length > 0 &&
            !series.series_name.toLowerCase().includes('hosted') &&
            !series.series_name.toLowerCase().includes('league')
        );
    }

    async getMemberBestLapTimes(customerId: number, carId?: number): Promise<MemberBests | null> {
        try {
            await this.ensureAuthenticated();
            
            const params: any = { cust_id: customerId };
            if (carId) params.car_id = carId;
            
            const response = await this.client.get('/data/stats/member_bests', { params });

            // Check if response contains a link to S3 data
            if (response.data.link) {
                console.log('Fetching member bests from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data as MemberBests;
            } else {
                // Direct response format
                return response.data as MemberBests;
            }
        } catch (error) {
            console.error(`Error fetching member best lap times for ${customerId}:`, error);
            return null;
        }
    }

    // Helper function to format lap time from ten-thousandths of a second to readable format
    formatLapTime(tenThousandths: number): string {
        const totalSeconds = tenThousandths / 10000; // Convert from ten-thousandths to seconds
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = (totalSeconds % 60).toFixed(3);
        return `${minutes}:${seconds.padStart(6, '0')}`;
    }

    async getMemberBestForTrack(customerId: number, trackId: number, carId?: number): Promise<BestLapTime[]> {
        const memberBests = await this.getMemberBestLapTimes(customerId, carId);
        if (!memberBests) return [];
        
        return memberBests.bests.filter(best => best.track.track_id === trackId);
    }
    
    async getSeriesSeasons(seriesId: number): Promise<any> {
        try {
            await this.ensureAuthenticated();
            
            const response = await this.client.get('/data/series/seasons', {
                params: {
                    series_id: seriesId,
                    include_series: true
                }
            });
            
            if (response.data.link) {
                console.log('Fetching series seasons from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            } else {
                return response.data;
            }
        } catch (error) {
            console.error(`Error fetching series seasons for ${seriesId}:`, error);
            return null;
        }
    }
    
    private async getSeriesSeasonsFor(year: number, quarter: number): Promise<any> {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/series/seasons', {
                params: {
                    include_series: true,
                    season_year: year,
                    season_quarter: quarter
                }
            });
            if (response.data.link) {
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            }
            return response.data;
        } catch (error) {
            console.error(`Error fetching series seasons for ${year} Q${quarter}:`, error);
            return null;
        }
    }
    
    async getSeriesSeasonSchedule(seasonId: number): Promise<any> {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/series/season_schedule', {
                params: { season_id: seasonId }
            });
            if (response.data.link) {
                console.log('Fetching series season schedule from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            }
            return response.data;
        } catch (error) {
            console.error(`Error fetching season schedule for season ${seasonId}:`, error);
            return null;
        }
    }
    
    async getCurrentSeriesSchedule(seriesId: number): Promise<any> {
        // Maintained for backwards compatibility; prefer using getSeriesSeasonSchedule via getCurrentOrNextEventForSeries
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/season/race_guide', {
                params: { include_end_after_from: true }
            });
            if (response.data.link) {
                console.log('Fetching series schedule from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            }
            return response.data;
        } catch (error) {
            console.error(`Error fetching race guide:`, error);
            return null;
        }
    }

    // Assets helpers
    private async fetchMaybeS3<T = any>(path: string, params?: any): Promise<T> {
        await this.ensureAuthenticated();
        const response = await this.client.get(path, { params });
        if (response.data && response.data.link) {
            const s3 = await this.client.get(response.data.link);
            return s3.data as T;
        }
        return response.data as T;
    }

    async getCarAssets(): Promise<any> {
        return this.fetchMaybeS3('/data/car/assets');
    }

    async getTrackAssets(): Promise<any> {
        // If /data/track/assets is not available in some environments, callers should handle errors.
        return this.fetchMaybeS3('/data/track/assets');
    }

    async getCarImageUrl(carId: number): Promise<string | null> {
        try {
            const assets = await this.getCarAssets();
            // assets might be an array or object keyed by car_id
            let entry: any = null;
            if (Array.isArray(assets)) {
                entry = assets.find((a: any) => a && (a.car_id === carId || a.id === carId));
            } else if (assets && typeof assets === 'object') {
                entry = assets[carId] || Object.values(assets).find((a: any) => a && (a.car_id === carId || a.id === carId));
            }
            if (!entry) return null;
            // Prefer small/large image with folder
            const folder = entry.folder as string | undefined;
            const file = (entry.small_image || entry.large_image) as string | undefined;
            if (folder && file) {
                const path = `${folder.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
                return this.staticImagesBase + path.replace(/^\//, '');
            }
            // Fallback to logo if absolute/relative
            const logo = entry.logo as string | undefined;
            if (logo) {
                return logo.startsWith('http') ? logo : this.staticImagesBase + logo.replace(/^\//, '');
            }
            return null;
        } catch {
            return null;
        }
    }

    async getTrackImageUrl(trackId: number): Promise<string | null> {
        try {
            const assets = await this.getTrackAssets();
            let entry: any = null;
            if (Array.isArray(assets)) {
                entry = assets.find((a: any) => a && (a.track_id === trackId || a.id === trackId));
            } else if (assets && typeof assets === 'object') {
                entry = assets[trackId] || Object.values(assets).find((a: any) => a && (a.track_id === trackId || a.id === trackId));
            }
            if (!entry) return null;
            // Prefer large or small image with folder
            const folder = entry.folder as string | undefined;
            const file = (entry.large_image || entry.small_image) as string | undefined;
            if (folder && file) {
                const path = `${folder.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
                return this.staticImagesBase + path.replace(/^\//, '');
            }
            // Fallback to logo
            const logo = entry.logo as string | undefined;
            if (logo) {
                return logo.startsWith('http') ? logo : this.staticImagesBase + logo.replace(/^\//, '');
            }
            return null;
        } catch {
            return null;
        }
    }

    async getTrackMapActiveUrl(trackId: number): Promise<string | null> {
        try {
            const assets = await this.getTrackAssets();
            let entry: any = null;
            if (Array.isArray(assets)) {
                entry = assets.find((a: any) => a && (a.track_id === trackId || a.id === trackId));
            } else if (assets && typeof assets === 'object') {
                entry = assets[trackId] || Object.values(assets).find((a: any) => a && (a.track_id === trackId || a.id === trackId));
            }
            if (!entry) return null;
            const trackMap: string | undefined = entry.track_map;
            const layers: any = entry.track_map_layers;
            const activeName: string = (layers?.active as string) || 'active.svg';
            if (!trackMap) return null;
            const base = trackMap.replace(/\/$/, '');
            const file = activeName.endsWith('.svg') ? activeName : `${activeName}.svg`;
            return `${base}/${file}`;
        } catch {
            return null;
        }
    }

    async getCurrentOrNextEventForSeries(seriesId: number): Promise<{ track_id: number; track_name?: string; config_name?: string } | null> {
        // Preferred strategy: use series/seasons which includes an active 'race_week' and embedded 'schedules'
        let seasons = await this.getSeriesSeasons(seriesId);
        const seasonRowsFrom = (data: any) => Array.isArray(data) ? data : (data?.seasons || data?.data || []);
        const seasonsList: any[] = seasonRowsFrom(seasons) || [];
        // Filter to this series
        const bySeries = seasonsList.filter((s: any) => s && (s.series_id === seriesId || (s.series && s.series.series_id === seriesId)));
        if (bySeries.length > 0) {
            // Prefer an active season
            const active = bySeries.find((s: any) => !!s.active) || bySeries[0];
            const raceWeek = (active.race_week ?? active.race_week_num ?? null);
            const schedules: any[] = active.schedules || [];
            if (schedules.length > 0) {
                // Find schedule for current race week
                let pick = schedules.find((it: any) => it.race_week_num === raceWeek);
                if (!pick) {
                    // fallback to nearest by race_week_num
                    const sorted = schedules.slice().sort((a: any, b: any) => (a.race_week_num ?? 0) - (b.race_week_num ?? 0));
                    pick = sorted[0];
                }
                if (pick && pick.track && pick.track.track_id) {
                    return { track_id: pick.track.track_id, track_name: pick.track.track_name, config_name: pick.track.config_name };
                }
            }
        }
        // Fallback: scan recent quarters using series/season_schedule
        return await (async () => {
            const now = new Date();
            const parseTime = (x: any) => (x ? new Date(x) : null);
            let fallbackSeasons = seasonsList;
            if (fallbackSeasons.length === 0) {
                const currentMonth = now.getUTCMonth();
                const currentQuarter = Math.floor(currentMonth / 3) + 1;
                let y = now.getUTCFullYear();
                let q = currentQuarter;
                for (let i = 0; i < 8 && fallbackSeasons.length === 0; i++) {
                    const data = await this.getSeriesSeasonsFor(y, q);
                    const rows = seasonRowsFrom(data);
                    const bs = rows.filter((s: any) => s && (s.series_id === seriesId || (s.series && s.series.series_id === seriesId)));
                    if (bs.length > 0) fallbackSeasons = bs;
                    q -= 1; if (q < 1) { q = 4; y -= 1; }
                }
            }
            if (fallbackSeasons.length === 0) return null;
            const seasonId = fallbackSeasons[0].season_id || (fallbackSeasons[0].season && fallbackSeasons[0].season.season_id);
            if (!seasonId) return null;
            const schedule = await this.getSeriesSeasonSchedule(seasonId);
            const items: any[] = Array.isArray(schedule) ? schedule : (schedule.schedule || schedule.data || []);
            if (!items || items.length === 0) return null;
            const startOfItem = (it: any) => parseTime(it.start_time || it.start || it.race_week_start);
            const dated = items.map(it => ({ it, t: startOfItem(it) })).filter(x => x.t);
            const upcoming = dated.filter(x => x.t!.getTime() > now.getTime()).sort((a, b) => a.t!.getTime() - b.t!.getTime());
            const pick = upcoming[0]?.it || dated.sort((a, b) => b.t!.getTime() - a.t!.getTime())[0]?.it || items[0];
            const tr = pick.track || pick;
            return tr && tr.track_id ? { track_id: tr.track_id, track_name: tr.track_name, config_name: tr.config_name } : null;
        })();
    }
}
