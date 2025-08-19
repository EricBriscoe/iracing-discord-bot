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
    constructor(dbPath = 'data/users.db') {
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
            CREATE TABLE IF NOT EXISTS users (
                discord_id TEXT PRIMARY KEY,
                iracing_username TEXT NOT NULL,
                iracing_customer_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS guild_configs (
                guild_id TEXT PRIMARY KEY,
                stats_channel_id TEXT,
                stats_message_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS driver_data (
                customer_id INTEGER PRIMARY KEY,
                display_name TEXT NOT NULL,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS license_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                license_level INTEGER NOT NULL,
                safety_rating REAL NOT NULL,
                irating INTEGER NOT NULL,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES driver_data (customer_id)
            )
        `);
        await run(`
            CREATE TABLE IF NOT EXISTS race_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                subsession_id INTEGER NOT NULL,
                series_name TEXT NOT NULL,
                track_name TEXT NOT NULL,
                start_time DATETIME NOT NULL,
                finish_position INTEGER NOT NULL,
                incidents INTEGER NOT NULL,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES driver_data (customer_id),
                UNIQUE(customer_id, subsession_id)
            )
        `);
        await run(`
            CREATE INDEX IF NOT EXISTS idx_license_snapshots_customer_recorded 
            ON license_snapshots (customer_id, recorded_at)
        `);
        await run(`
            CREATE INDEX IF NOT EXISTS idx_race_results_customer_start 
            ON race_results (customer_id, start_time)
        `);
    }
    async addUser(discordId, iracingUsername, iracingCustomerId) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR REPLACE INTO users (discord_id, iracing_username, iracing_customer_id) VALUES (?, ?, ?)', [discordId, iracingUsername, iracingCustomerId || null], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getUser(discordId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT iracing_username, iracing_customer_id FROM users WHERE discord_id = ?', [discordId], (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row ? [row.iracing_username, row.iracing_customer_id] : null);
            });
        });
    }
    async getAllUsers() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT discord_id, iracing_username, iracing_customer_id FROM users');
        return results.map(row => [row.discord_id, row.iracing_username, row.iracing_customer_id]);
    }
    async removeUser(discordId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM users WHERE discord_id = ?', [discordId], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async setStatsChannel(guildId, channelId) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT OR REPLACE INTO guild_configs (guild_id, stats_channel_id, updated_at) 
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `, [guildId, channelId], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getStatsChannel(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT stats_channel_id, stats_message_id FROM guild_configs WHERE guild_id = ?', [guildId], (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row ? [row.stats_channel_id, row.stats_message_id] : null);
            });
        });
    }
    async updateStatsMessageId(guildId, messageId) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE guild_configs SET stats_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [messageId, guildId], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async removeStatsChannel(guildId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM guild_configs WHERE guild_id = ?', [guildId], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getAllGuildConfigs() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT guild_id, stats_channel_id, stats_message_id FROM guild_configs WHERE stats_channel_id IS NOT NULL');
        return results.map(row => [row.guild_id, row.stats_channel_id, row.stats_message_id]);
    }
    async saveDriverData(customerId, displayName) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR REPLACE INTO driver_data (customer_id, display_name, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)', [customerId, displayName], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async saveLicenseSnapshot(customerId, categoryId, licenseLevel, safetyRating, irating) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT INTO license_snapshots (customer_id, category_id, license_level, safety_rating, irating) VALUES (?, ?, ?, ?, ?)', [customerId, categoryId, licenseLevel, safetyRating, irating], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async saveRaceResult(customerId, subsessionId, seriesName, trackName, startTime, finishPosition, incidents) {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT OR IGNORE INTO race_results (customer_id, subsession_id, series_name, track_name, start_time, finish_position, incidents) VALUES (?, ?, ?, ?, ?, ?, ?)', [customerId, subsessionId, seriesName, trackName, startTime, finishPosition, incidents], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async getDriverData(customerId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT customer_id, display_name, last_updated as recorded_at FROM driver_data WHERE customer_id = ?', [customerId], (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row || null);
            });
        });
    }
    async getLatestLicenseSnapshots(customerId) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT ls1.* FROM license_snapshots ls1
                INNER JOIN (
                    SELECT customer_id, category_id, MAX(recorded_at) as max_recorded_at
                    FROM license_snapshots 
                    WHERE customer_id = ?
                    GROUP BY customer_id, category_id
                ) ls2 ON ls1.customer_id = ls2.customer_id 
                    AND ls1.category_id = ls2.category_id 
                    AND ls1.recorded_at = ls2.max_recorded_at
                ORDER BY ls1.category_id
            `, [customerId], (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows || []);
            });
        });
    }
    async getLicenseHistory(customerId, categoryId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM license_snapshots WHERE customer_id = ? AND category_id = ? ORDER BY recorded_at DESC LIMIT ?', [customerId, categoryId, limit], (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows || []);
            });
        });
    }
    async getRecentRaces(customerId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM race_results WHERE customer_id = ? ORDER BY start_time DESC LIMIT ?', [customerId, limit], (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows || []);
            });
        });
    }
    async needsDataUpdate(customerId, maxAgeMinutes = 15) {
        const driverData = await this.getDriverData(customerId);
        if (!driverData)
            return true;
        const lastUpdate = new Date(driverData.recorded_at);
        const now = new Date();
        const diffMinutes = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);
        return diffMinutes >= maxAgeMinutes;
    }
    async getAllDriverData() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        const results = await all('SELECT customer_id, display_name, last_updated as recorded_at FROM driver_data ORDER BY last_updated ASC');
        return results;
    }
    async getOldestDriver() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT customer_id, display_name, last_updated as recorded_at FROM driver_data ORDER BY last_updated ASC LIMIT 1', [], (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row || null);
            });
        });
    }
    close() {
        this.db.close();
    }
}
exports.Database = Database;
//# sourceMappingURL=database.js.map