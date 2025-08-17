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
    close() {
        this.db.close();
    }
}
exports.Database = Database;
//# sourceMappingURL=database.js.map