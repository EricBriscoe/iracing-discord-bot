import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

export interface User {
    discord_id: string;
    iracing_username: string;
    iracing_customer_id: number | null;
    created_at: string;
}

export interface GuildConfig {
    guild_id: string;
    stats_channel_id: string | null;
    stats_message_id: string | null;
    created_at: string;
    updated_at: string;
}

export class Database {
    private db: sqlite3.Database;
    private dbPath: string;

    constructor(dbPath: string = 'data/users.db') {
        this.dbPath = dbPath;
        
        // Ensure data directory exists
        const dataDir = path.dirname(dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        this.db = new sqlite3.Database(dbPath);
    }

    async initDb(): Promise<void> {
        const run = promisify(this.db.run.bind(this.db));
        
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

    async addUser(discordId: string, iracingUsername: string, iracingCustomerId?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO users (discord_id, iracing_username, iracing_customer_id) VALUES (?, ?, ?)',
                [discordId, iracingUsername, iracingCustomerId || null],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getUser(discordId: string): Promise<[string, number | null] | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT iracing_username, iracing_customer_id FROM users WHERE discord_id = ?',
                [discordId],
                (err, row: { iracing_username: string; iracing_customer_id: number | null } | undefined) => {
                    if (err) reject(err);
                    else resolve(row ? [row.iracing_username, row.iracing_customer_id] : null);
                }
            );
        });
    }

    async getAllUsers(): Promise<[string, string, number | null][]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT discord_id, iracing_username, iracing_customer_id FROM users'
        ) as { discord_id: string; iracing_username: string; iracing_customer_id: number | null }[];
        
        return results.map(row => [row.discord_id, row.iracing_username, row.iracing_customer_id]);
    }

    async removeUser(discordId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM users WHERE discord_id = ?', [discordId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async setStatsChannel(guildId: string, channelId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT OR REPLACE INTO guild_configs (guild_id, stats_channel_id, updated_at) 
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `, [guildId, channelId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getStatsChannel(guildId: string): Promise<[string, string | null] | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT stats_channel_id, stats_message_id FROM guild_configs WHERE guild_id = ?',
                [guildId],
                (err, row: { stats_channel_id: string; stats_message_id: string | null } | undefined) => {
                    if (err) reject(err);
                    else resolve(row ? [row.stats_channel_id, row.stats_message_id] : null);
                }
            );
        });
    }

    async updateStatsMessageId(guildId: string, messageId: string | null): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE guild_configs SET stats_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
                [messageId, guildId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async removeStatsChannel(guildId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM guild_configs WHERE guild_id = ?', [guildId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getAllGuildConfigs(): Promise<[string, string, string | null][]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT guild_id, stats_channel_id, stats_message_id FROM guild_configs WHERE stats_channel_id IS NOT NULL'
        ) as { guild_id: string; stats_channel_id: string; stats_message_id: string | null }[];
        
        return results.map(row => [row.guild_id, row.stats_channel_id, row.stats_message_id]);
    }

    close(): void {
        this.db.close();
    }
}
