import axios, { AxiosInstance } from 'axios';

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

export class iRacingClient {
    private username: string;
    private password: string;
    private client: AxiosInstance;
    private authCookie: string | null = null;
    private loginPromise: Promise<void> | null = null;

    constructor() {
        this.username = process.env.IRACING_USERNAME || '';
        this.password = process.env.IRACING_PASSWORD || '';
        
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
            const response = await this.client.post('/auth', {
                email: this.username,
                password: this.password
            });

            const cookies = response.headers['set-cookie'];
            if (cookies) {
                this.authCookie = cookies.find(cookie => cookie.startsWith('irsso_membersitev2='))?.split(';')[0] || null;
            }

            if (!this.authCookie) {
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
            
            const response = await this.client.get('/data/stats/member_summary', {
                params: {
                    cust_id: customerId
                }
            });

            return response.data as MemberSummary;
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
}
