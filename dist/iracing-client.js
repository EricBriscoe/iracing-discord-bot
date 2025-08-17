"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.iRacingClient = void 0;
const axios_1 = __importDefault(require("axios"));
class iRacingClient {
    constructor() {
        this.authCookie = null;
        this.loginPromise = null;
        this.username = process.env.IRACING_USERNAME || '';
        this.password = process.env.IRACING_PASSWORD || '';
        if (!this.username || !this.password) {
            throw new Error('iRacing credentials not configured');
        }
        this.client = axios_1.default.create({
            baseURL: 'https://members-ng.iracing.com',
            timeout: 30000,
            headers: {
                'User-Agent': 'iRacing Discord Bot',
                'Content-Type': 'application/json'
            }
        });
    }
    async login() {
        if (this.loginPromise) {
            return this.loginPromise;
        }
        this.loginPromise = this._performLogin();
        return this.loginPromise;
    }
    async _performLogin() {
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
            this.client.defaults.headers.Cookie = this.authCookie;
        }
        catch (error) {
            this.loginPromise = null;
            throw new Error(`iRacing login failed: ${error}`);
        }
    }
    async ensureAuthenticated() {
        if (!this.authCookie) {
            await this.login();
        }
    }
    async searchMember(username) {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/lookup/drivers', {
                params: {
                    search_term: username
                }
            });
            const results = response.data;
            if (results && results.length > 0) {
                for (const member of results) {
                    if (member.display_name.toLowerCase() === username.toLowerCase()) {
                        return member.cust_id;
                    }
                }
                return results[0]?.cust_id || null;
            }
            return null;
        }
        catch (error) {
            console.error(`Error searching for member ${username}:`, error);
            return null;
        }
    }
    async getMemberSummary(customerId) {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/stats/member_summary', {
                params: {
                    cust_id: customerId
                }
            });
            return response.data;
        }
        catch (error) {
            console.error(`Error fetching member summary for ${customerId}:`, error);
            return null;
        }
    }
    async getMemberRecentRaces(customerId) {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/stats/member_recent_races', {
                params: {
                    cust_id: customerId
                }
            });
            return response.data;
        }
        catch (error) {
            console.error(`Error fetching recent races for ${customerId}:`, error);
            return null;
        }
    }
}
exports.iRacingClient = iRacingClient;
//# sourceMappingURL=iracing-client.js.map