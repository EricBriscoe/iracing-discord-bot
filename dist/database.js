"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = void 0;
const sqlite3_1 = __importDefault(require("sqlite3"));
const util_1 = require("util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class Database {
    constructor(dbPath = 'data/data.db') {
        this.dbPath = dbPath;
        const dataDir = path.dirname(dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this.db = new sqlite3_1.default.Database(dbPath);
    }
    async initDb() {
        const run = (0, util_1.promisify)(this.db.run.bind(this.db));
        await run(`
            CREATE TABLE IF NOT EXISTS user_links (
                discord_id TEXT PRIMARY KEY,
                iracing_username TEXT NOT NULL,
                iracing_customer_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS official_series (
                series_id INTEGER PRIMARY KEY,
                series_name TEXT NOT NULL,
                series_short_name TEXT NOT NULL,
                category TEXT NOT NULL,
                category_id INTEGER NOT NULL,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS channel_tracks (
                channel_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                series_id INTEGER NOT NULL,
                series_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (series_id) REFERENCES official_series (series_id)
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS track_car_combos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series_id INTEGER NOT NULL,
                track_id INTEGER NOT NULL,
                car_id INTEGER NOT NULL,
                track_name TEXT NOT NULL,
                config_name TEXT NOT NULL,
                car_name TEXT NOT NULL,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(series_id, track_id, car_id),
                FOREIGN KEY (series_id) REFERENCES official_series (series_id)
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS lap_time_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                combo_id INTEGER NOT NULL,
                discord_id TEXT NOT NULL,
                iracing_customer_id INTEGER NOT NULL,
                iracing_username TEXT NOT NULL,
                lap_time_microseconds INTEGER NOT NULL,
                subsession_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                recorded_at DATETIME NOT NULL,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(combo_id, discord_id),
                FOREIGN KEY (combo_id) REFERENCES track_car_combos (id),
                FOREIGN KEY (discord_id) REFERENCES user_links (discord_id)
            )
        `);
    }
    async linkUser(discordId, iracingUsername, iracingCustomerId) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR REPLACE INTO user_links (discord_id, iracing_username, iracing_customer_id) VALUES (?, ?, ?)', [discordId, iracingUsername, iracingCustomerId || null], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getLinkedUser(discordId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT discord_id, iracing_username, iracing_customer_id, created_at FROM user_links WHERE discord_id = ?', [discordId], (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row || null);
            });
        });
    }
    async unlinkUser(discordId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM user_links WHERE discord_id = ?', [discordId], function (err) {
                if (err)
                    reject(err);
                else
                    resolve(this.changes > 0);
            });
        });
    }
    async getAllLinkedUsers() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT discord_id, iracing_username, iracing_customer_id, created_at FROM user_links ORDER BY created_at DESC');
        return results;
    }
    async updateOfficialSeries(seriesList) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM official_series', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                let completed = 0;
                const total = seriesList.length;
                if (total === 0) {
                    resolve();
                    return;
                }
                for (const series of seriesList) {
                    this.db.run('INSERT INTO official_series (series_id, series_name, series_short_name, category, category_id) VALUES (?, ?, ?, ?, ?)', [series.series_id, series.series_name, series.series_short_name, series.category, series.category_id], (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        completed++;
                        if (completed === total) {
                            resolve();
                        }
                    });
                }
            });
        });
    }
    async getOfficialSeries() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT series_id, series_name, series_short_name, category, category_id, last_updated FROM official_series ORDER BY series_name');
        return results;
    }
    async setChannelTrack(channelId, guildId, seriesId, seriesName) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR REPLACE INTO channel_tracks (channel_id, guild_id, series_id, series_name) VALUES (?, ?, ?, ?)', [channelId, guildId, seriesId, seriesName], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getChannelTrack(channelId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT channel_id, guild_id, series_id, series_name, created_at FROM channel_tracks WHERE channel_id = ?', [channelId], (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row || null);
            });
        });
    }
    async removeChannelTrack(channelId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM channel_tracks WHERE channel_id = ?', [channelId], function (err) {
                if (err)
                    reject(err);
                else
                    resolve(this.changes > 0);
            });
        });
    }
    async getGuildLinkedUsers(guildId) {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT DISTINCT ul.discord_id, ul.iracing_username, ul.iracing_customer_id, ul.created_at FROM user_links ul WHERE ul.discord_id IN (SELECT DISTINCT discord_id FROM user_links)');
        return results;
    }
    async getAllChannelTracks() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT channel_id, guild_id, series_id, series_name, created_at FROM channel_tracks');
        return results;
    }
    async upsertTrackCarCombo(combo) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR REPLACE INTO track_car_combos (series_id, track_id, car_id, track_name, config_name, car_name) VALUES (?, ?, ?, ?, ?, ?)', [combo.series_id, combo.track_id, combo.car_id, combo.track_name, combo.config_name, combo.car_name], function (err) {
                if (err)
                    reject(err);
                else
                    resolve(this.lastID);
            });
        });
    }
    async getTrackCarCombosBySeriesId(seriesId) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, series_id, track_id, car_id, track_name, config_name, car_name, last_updated FROM track_car_combos WHERE series_id = ?', [seriesId], (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows || []);
            });
        });
    }
    async upsertLapTimeRecord(record) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR REPLACE INTO lap_time_records (combo_id, discord_id, iracing_customer_id, iracing_username, lap_time_microseconds, subsession_id, event_type, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [record.combo_id, record.discord_id, record.iracing_customer_id, record.iracing_username, record.lap_time_microseconds, record.subsession_id, record.event_type, record.recorded_at], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getTopLapTimesForCombo(comboId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, combo_id, discord_id, iracing_customer_id, iracing_username, lap_time_microseconds, subsession_id, event_type, recorded_at, last_updated FROM lap_time_records WHERE combo_id = ? ORDER BY lap_time_microseconds ASC LIMIT ?', [comboId, limit], (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows || []);
            });
        });
    }
    close() {
        this.db.close();
    }
}
exports.Database = Database;
//# sourceMappingURL=database.js.map