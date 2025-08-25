"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.iRacingClient = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const sharp_1 = __importDefault(require("sharp"));
const fs_1 = require("fs");
const path_1 = require("path");
class iRacingClient {
    constructor() {
        this.authCookie = null;
        this.loginPromise = null;
        this.staticImagesBase = 'https://images-static.iracing.com/';
        this.worldRecordCache = new Map();
        this.cacheDir = './data/cache/images';
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
    async ensureAuthenticated(forceReauth = false) {
        if (!this.authCookie || forceReauth) {
            this.authCookie = null;
            this.loginPromise = null;
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
            if (error.response?.status === 401) {
                console.log('Authentication expired, retrying with fresh login...');
                try {
                    await this.ensureAuthenticated(true);
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
                catch (retryError) {
                    console.error(`Error searching for member ${username} after retry:`, retryError);
                    return null;
                }
            }
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
            let data = response.data;
            if (data.link) {
                console.log('Fetching recent races from S3 link');
                const s3Response = await this.client.get(data.link);
                data = s3Response.data;
            }
            if (data.races && Array.isArray(data.races)) {
                return data.races;
            }
            else if (Array.isArray(data)) {
                return data;
            }
            console.warn('Unexpected recent races data format:', typeof data);
            return null;
        }
        catch (error) {
            console.error(`Error fetching recent races for ${customerId}:`, error);
            return null;
        }
    }
    async searchSeriesResults(options) {
        try {
            await this.ensureAuthenticated();
            const params = {};
            if (options.customerId)
                params.cust_id = options.customerId;
            if (options.startRangeBegin)
                params.start_range_begin = options.startRangeBegin;
            if (options.finishRangeBegin)
                params.finish_range_begin = options.finishRangeBegin;
            if (options.seriesId)
                params.series_id = options.seriesId;
            if (options.officialOnly !== undefined)
                params.official_only = options.officialOnly;
            const response = await this.client.get('/data/results/search_series', { params });
            let data = response.data;
            if (data.link) {
                console.log('Fetching search results from S3 link');
                const s3Response = await this.client.get(data.link);
                data = s3Response.data;
            }
            if (data.data && data.data.chunk_info) {
                const chunkInfo = data.data.chunk_info;
                if (chunkInfo.chunk_file_names && chunkInfo.base_download_url) {
                    console.log(`Processing ${chunkInfo.num_chunks} chunks with ${chunkInfo.rows} total results`);
                    const allResults = [];
                    const baseUrl = chunkInfo.base_download_url.replace(/\/$/, '');
                    for (const chunkFile of chunkInfo.chunk_file_names) {
                        try {
                            const chunkUrl = `${baseUrl}/${chunkFile}`;
                            const chunkResponse = await this.client.get(chunkUrl);
                            if (Array.isArray(chunkResponse.data)) {
                                allResults.push(...chunkResponse.data);
                            }
                        }
                        catch (chunkError) {
                            console.error('Error fetching chunk:', chunkError);
                        }
                    }
                    return allResults;
                }
            }
            if (Array.isArray(data)) {
                return data;
            }
            console.warn('Unexpected series search data format:', typeof data);
            return null;
        }
        catch (error) {
            if (error.response?.status === 401) {
                console.log('Authentication expired for series search, retrying with fresh login...');
                try {
                    await this.ensureAuthenticated(true);
                    return await this.searchSeriesResults(options);
                }
                catch (retryError) {
                    console.error('Error searching series results after retry:', retryError);
                    return null;
                }
            }
            console.error('Error searching series results:', error);
            return null;
        }
    }
    async getSubsessionResult(subsessionId) {
        try {
            await this.ensureAuthenticated();
            const response = await this.client.get('/data/results/get', {
                params: {
                    subsession_id: subsessionId,
                    include_licenses: true
                }
            });
            if (response.data.link) {
                console.log('Fetching subsession result from S3 link');
                const s3Response = await this.client.get(response.data.link);
                return s3Response.data;
            }
            else {
                return response.data;
            }
        }
        catch (error) {
            console.error(`Error fetching subsession result for ${subsessionId}:`, error);
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
            if (error.response?.status === 401) {
                console.log('Authentication expired for lap times, retrying with fresh login...');
                try {
                    await this.ensureAuthenticated(true);
                    const params = { cust_id: customerId };
                    if (carId)
                        params.car_id = carId;
                    const response = await this.client.get('/data/stats/member_bests', { params });
                    if (response.data.link) {
                        const s3Response = await this.client.get(response.data.link);
                        return s3Response.data;
                    }
                    else {
                        return response.data;
                    }
                }
                catch (retryError) {
                    console.error(`Error fetching member best lap times for ${customerId} after retry:`, retryError);
                    return null;
                }
            }
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
    async getWorldRecordBestLap(carId, trackId, opts) {
        await this.ensureAuthenticated();
        const includeQualify = opts?.includeQualify !== false;
        const includeRace = opts?.includeRace !== false;
        const includeTT = opts?.includeTimeTrial !== false;
        const includePractice = !!opts?.includePractice;
        const key = `wr:${carId}:${trackId}:${opts?.seasonYear ?? 'all'}:${opts?.seasonQuarter ?? 'all'}:${includeQualify ? 1 : 0}${includeRace ? 1 : 0}${includeTT ? 1 : 0}${includePractice ? 1 : 0}`;
        const now = Date.now();
        const cached = this.worldRecordCache.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.value;
        }
        const params = { car_id: carId, track_id: trackId };
        if (typeof opts?.seasonYear === 'number')
            params.season_year = opts.seasonYear;
        if (typeof opts?.seasonQuarter === 'number')
            params.season_quarter = opts.seasonQuarter;
        const resp = await this.client.get('/data/stats/world_records', { params });
        const data = resp.data?.data;
        const meta = data && (data.success !== undefined ? data : resp.data);
        let best;
        const consider = (val) => {
            if (typeof val === 'number' && val > 0) {
                if (best === undefined || val < best)
                    best = val;
            }
        };
        if (meta && meta.chunk_info && meta.chunk_info.base_download_url && Array.isArray(meta.chunk_info.chunk_file_names)) {
            const base = meta.chunk_info.base_download_url.replace(/\/$/, '/');
            for (const name of meta.chunk_info.chunk_file_names) {
                try {
                    const url = base + name;
                    const chunkResp = await this.client.get(url);
                    const rows = Array.isArray(chunkResp.data) ? chunkResp.data : [];
                    for (const row of rows) {
                        if (includePractice)
                            consider(row.practice_lap_time);
                        if (includeQualify)
                            consider(row.qualify_lap_time);
                        if (includeTT)
                            consider(row.tt_lap_time);
                        if (includeRace)
                            consider(row.race_lap_time);
                    }
                }
                catch (e) {
                }
            }
        }
        this.worldRecordCache.set(key, { value: best, expiresAt: now + 15 * 60 * 1000 });
        return best;
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
    async getCars() {
        return this.fetchMaybeS3('/data/car/get');
    }
    async getCarName(carId) {
        try {
            const cars = await this.getCars();
            if (Array.isArray(cars)) {
                const car = cars.find((c) => c && c.car_id === carId);
                return car?.car_name || null;
            }
            return null;
        }
        catch (error) {
            console.warn(`Could not fetch car name for car ID ${carId}:`, error);
            return null;
        }
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
    async getTrackMapActivePng(trackId) {
        try {
            const svgUrl = await this.getTrackMapActiveUrl(trackId);
            if (!svgUrl)
                return null;
            const hash = (0, crypto_1.createHash)('sha256').update(svgUrl).digest('hex');
            const cacheFilename = `${hash}.png`;
            const cachePath = (0, path_1.join)(this.cacheDir, cacheFilename);
            try {
                await fs_1.promises.access(cachePath);
                return cachePath;
            }
            catch {
            }
            try {
                await fs_1.promises.mkdir(this.cacheDir, { recursive: true });
            }
            catch (err) {
                console.warn('Could not create cache directory:', err);
            }
            const response = await axios_1.default.get(svgUrl, { responseType: 'arraybuffer' });
            const svgBuffer = Buffer.from(response.data);
            const pngBuffer = await (0, sharp_1.default)(svgBuffer)
                .png()
                .resize(800, 600, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
                .toBuffer();
            await fs_1.promises.writeFile(cachePath, pngBuffer);
            return cachePath;
        }
        catch (error) {
            console.warn('Could not convert track map SVG to PNG:', error);
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