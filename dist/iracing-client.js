"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.iRacingClient = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
class iRacingClient {
    constructor() {
        this.authCookie = null;
        this.loginPromise = null;
        this.username = process.env.IRACING_USERNAME || '';
        if (process.env.IRACING_HASHWORD) {
            this.password = process.env.IRACING_HASHWORD;
        }
        else {
            this.password = process.env.IRACING_PASSWORD || '';
        }
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
            let passwordToSend;
            if (process.env.IRACING_HASHWORD) {
                passwordToSend = this.password;
            }
            else {
                passwordToSend = (0, crypto_1.createHash)('sha256')
                    .update(this.password + this.username.toLowerCase())
                    .digest('base64');
            }
            const response = await this.client.post('/auth', {
                email: this.username,
                password: passwordToSend
            });
            const cookies = response.headers['set-cookie'];
            let cookieHeader = '';
            if (cookies) {
                const relevantCookies = cookies
                    .filter(cookie => cookie.startsWith('irsso_membersv2=') || cookie.startsWith('authtoken_members='))
                    .map(cookie => cookie.split(';')[0]);
                cookieHeader = relevantCookies.join('; ');
            }
            if (response.data && response.data.authcode) {
                this.authCookie = cookieHeader;
            }
            else if (cookieHeader) {
                this.authCookie = cookieHeader;
            }
            else {
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
            const response = await this.client.get('/data/member/get', {
                params: {
                    cust_ids: customerId
                }
            });
            if (response.data.link) {
                console.log('Fetching data from S3 link:', response.data.link);
                const s3Response = await this.client.get(response.data.link);
                const memberResponse = s3Response.data;
                if (memberResponse.success && memberResponse.members && memberResponse.members.length > 0) {
                    return memberResponse.members[0] || null;
                }
            }
            else {
                const memberResponse = response.data;
                if (memberResponse.success && memberResponse.members && memberResponse.members.length > 0) {
                    return memberResponse.members[0] || null;
                }
            }
            return null;
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
    async getSeries() {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/series/get');
            if (response.data.link) {
                console.log('Fetching series data from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            }
            else {
                return response.data;
            }
        }
        catch (error) {
            console.error('Error fetching series data:', error);
            return null;
        }
    }
    async getOfficialSeries() {
        const allSeries = await this.getSeries();
        if (!allSeries)
            return null;
        return allSeries.filter(series => series.eligible &&
            series.allowed_licenses.length > 0 &&
            !series.series_name.toLowerCase().includes('hosted') &&
            !series.series_name.toLowerCase().includes('league'));
    }
    async getMemberBestLapTimes(customerId, carId) {
        try {
            await this.ensureAuthenticated();
            const params = { cust_id: customerId };
            if (carId)
                params.car_id = carId;
            const response = await this.client.get('/data/stats/member_bests', { params });
            if (response.data.link) {
                console.log('Fetching member bests from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            }
            else {
                return response.data;
            }
        }
        catch (error) {
            console.error(`Error fetching member best lap times for ${customerId}:`, error);
            return null;
        }
    }
    formatLapTime(tenThousandths) {
        const totalSeconds = tenThousandths / 10000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = (totalSeconds % 60).toFixed(3);
        return `${minutes}:${seconds.padStart(6, '0')}`;
    }
    async getMemberBestForTrack(customerId, trackId, carId) {
        const memberBests = await this.getMemberBestLapTimes(customerId, carId);
        if (!memberBests)
            return [];
        return memberBests.bests.filter(best => best.track.track_id === trackId);
    }
    async getSeriesSeasons(seriesId) {
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
            }
            else {
                return response.data;
            }
        }
        catch (error) {
            console.error(`Error fetching series seasons for ${seriesId}:`, error);
            return null;
        }
    }
    async getCurrentSeriesSchedule(seriesId) {
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
            }
            else {
                return response.data;
            }
        }
        catch (error) {
            console.error(`Error fetching series schedule for ${seriesId}:`, error);
            return null;
        }
    }
}
exports.iRacingClient = iRacingClient;
//# sourceMappingURL=iracing-client.js.map