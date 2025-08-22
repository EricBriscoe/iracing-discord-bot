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
        this.staticImagesBase = 'https://images-static.iracing.com/';
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
    async getHttpClient() {
        await this.ensureAuthenticated();
        return this.client;
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
    async getSeriesSeasonsFor(year, quarter) {
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
        }
        catch (error) {
            console.error(`Error fetching series seasons for ${year} Q${quarter}:`, error);
            return null;
        }
    }
    async getSeriesSeasonSchedule(seasonId) {
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
        }
        catch (error) {
            console.error(`Error fetching season schedule for season ${seasonId}:`, error);
            return null;
        }
    }
    async getCurrentSeriesSchedule(seriesId) {
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
        }
        catch (error) {
            console.error(`Error fetching race guide:`, error);
            return null;
        }
    }
    async fetchMaybeS3(path, params) {
        await this.ensureAuthenticated();
        const response = await this.client.get(path, { params });
        if (response.data && response.data.link) {
            const s3 = await this.client.get(response.data.link);
            return s3.data;
        }
        return response.data;
    }
    async getCarAssets() {
        return this.fetchMaybeS3('/data/car/assets');
    }
    async getTrackAssets() {
        return this.fetchMaybeS3('/data/track/assets');
    }
    async getCarImageUrl(carId) {
        try {
            const assets = await this.getCarAssets();
            let entry = null;
            if (Array.isArray(assets)) {
                entry = assets.find((a) => a && (a.car_id === carId || a.id === carId));
            }
            else if (assets && typeof assets === 'object') {
                entry = assets[carId] || Object.values(assets).find((a) => a && (a.car_id === carId || a.id === carId));
            }
            if (!entry)
                return null;
            const folder = entry.folder;
            const file = (entry.small_image || entry.large_image);
            if (folder && file) {
                const path = `${folder.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
                return this.staticImagesBase + path.replace(/^\//, '');
            }
            const logo = entry.logo;
            if (logo) {
                return logo.startsWith('http') ? logo : this.staticImagesBase + logo.replace(/^\//, '');
            }
            return null;
        }
        catch {
            return null;
        }
    }
    async getTrackImageUrl(trackId) {
        try {
            const assets = await this.getTrackAssets();
            let entry = null;
            if (Array.isArray(assets)) {
                entry = assets.find((a) => a && (a.track_id === trackId || a.id === trackId));
            }
            else if (assets && typeof assets === 'object') {
                entry = assets[trackId] || Object.values(assets).find((a) => a && (a.track_id === trackId || a.id === trackId));
            }
            if (!entry)
                return null;
            const folder = entry.folder;
            const file = (entry.large_image || entry.small_image);
            if (folder && file) {
                const path = `${folder.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
                return this.staticImagesBase + path.replace(/^\//, '');
            }
            const logo = entry.logo;
            if (logo) {
                return logo.startsWith('http') ? logo : this.staticImagesBase + logo.replace(/^\//, '');
            }
            return null;
        }
        catch {
            return null;
        }
    }
    async getTrackMapActiveUrl(trackId) {
        try {
            const assets = await this.getTrackAssets();
            let entry = null;
            if (Array.isArray(assets)) {
                entry = assets.find((a) => a && (a.track_id === trackId || a.id === trackId));
            }
            else if (assets && typeof assets === 'object') {
                entry = assets[trackId] || Object.values(assets).find((a) => a && (a.track_id === trackId || a.id === trackId));
            }
            if (!entry)
                return null;
            const trackMap = entry.track_map;
            const layers = entry.track_map_layers;
            const activeName = layers?.active || 'active.svg';
            if (!trackMap)
                return null;
            const base = trackMap.replace(/\/$/, '');
            const file = activeName.endsWith('.svg') ? activeName : `${activeName}.svg`;
            return `${base}/${file}`;
        }
        catch {
            return null;
        }
    }
    async getCurrentOrNextEventForSeries(seriesId) {
        let seasons = await this.getSeriesSeasons(seriesId);
        const seasonRowsFrom = (data) => Array.isArray(data) ? data : (data?.seasons || data?.data || []);
        const seasonsList = seasonRowsFrom(seasons) || [];
        const bySeries = seasonsList.filter((s) => s && (s.series_id === seriesId || (s.series && s.series.series_id === seriesId)));
        if (bySeries.length > 0) {
            const active = bySeries.find((s) => !!s.active) || bySeries[0];
            const raceWeek = (active.race_week ?? active.race_week_num ?? null);
            const schedules = active.schedules || [];
            if (schedules.length > 0) {
                let pick = schedules.find((it) => it.race_week_num === raceWeek);
                if (!pick) {
                    const sorted = schedules.slice().sort((a, b) => (a.race_week_num ?? 0) - (b.race_week_num ?? 0));
                    pick = sorted[0];
                }
                if (pick && pick.track && pick.track.track_id) {
                    return { track_id: pick.track.track_id, track_name: pick.track.track_name, config_name: pick.track.config_name };
                }
            }
        }
        return await (async () => {
            const now = new Date();
            const parseTime = (x) => (x ? new Date(x) : null);
            let fallbackSeasons = seasonsList;
            if (fallbackSeasons.length === 0) {
                const currentMonth = now.getUTCMonth();
                const currentQuarter = Math.floor(currentMonth / 3) + 1;
                let y = now.getUTCFullYear();
                let q = currentQuarter;
                for (let i = 0; i < 8 && fallbackSeasons.length === 0; i++) {
                    const data = await this.getSeriesSeasonsFor(y, q);
                    const rows = seasonRowsFrom(data);
                    const bs = rows.filter((s) => s && (s.series_id === seriesId || (s.series && s.series.series_id === seriesId)));
                    if (bs.length > 0)
                        fallbackSeasons = bs;
                    q -= 1;
                    if (q < 1) {
                        q = 4;
                        y -= 1;
                    }
                }
            }
            if (fallbackSeasons.length === 0)
                return null;
            const seasonId = fallbackSeasons[0].season_id || (fallbackSeasons[0].season && fallbackSeasons[0].season.season_id);
            if (!seasonId)
                return null;
            const schedule = await this.getSeriesSeasonSchedule(seasonId);
            const items = Array.isArray(schedule) ? schedule : (schedule.schedule || schedule.data || []);
            if (!items || items.length === 0)
                return null;
            const startOfItem = (it) => parseTime(it.start_time || it.start || it.race_week_start);
            const dated = items.map(it => ({ it, t: startOfItem(it) })).filter(x => x.t);
            const upcoming = dated.filter(x => x.t.getTime() > now.getTime()).sort((a, b) => a.t.getTime() - b.t.getTime());
            const pick = upcoming[0]?.it || dated.sort((a, b) => b.t.getTime() - a.t.getTime())[0]?.it || items[0];
            const tr = pick.track || pick;
            return tr && tr.track_id ? { track_id: tr.track_id, track_name: tr.track_name, config_name: tr.config_name } : null;
        })();
    }
}
exports.iRacingClient = iRacingClient;
//# sourceMappingURL=iracing-client.js.map