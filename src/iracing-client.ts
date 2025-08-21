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
    
    async getCurrentSeriesSchedule(seriesId: number): Promise<any> {
        try {
            await this.ensureAuthenticated();
            
            const response = await this.client.get('/data/season/race_guide', {
                params: {
                    series_id: seriesId,
                    include_end_after_time: true
                }
            });
            
            if (response.data.link) {
                console.log('Fetching series schedule from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            } else {
                return response.data;
            }
        } catch (error) {
            console.error(`Error fetching series schedule for ${seriesId}:`, error);
            return null;
        }
    }
}
