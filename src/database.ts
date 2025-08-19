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

export interface DriverData {
    customer_id: number;
    display_name: string;
    recorded_at: string;
}

export interface LicenseSnapshot {
    id: number;
    customer_id: number;
    category_id: number;
    license_level: number;
    safety_rating: number;
    irating: number;
    recorded_at: string;
}

export interface RaceResult {
    id: number;
    customer_id: number;
    subsession_id: number;
    series_name: string;
    track_name: string;
    start_time: string;
    finish_position: number;
    incidents: number;
    recorded_at: string;
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

    async saveDriverData(customerId: number, displayName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO driver_data (customer_id, display_name, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)',
                [customerId, displayName],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async saveLicenseSnapshot(customerId: number, categoryId: number, licenseLevel: number, safetyRating: number, irating: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO license_snapshots (customer_id, category_id, license_level, safety_rating, irating) VALUES (?, ?, ?, ?, ?)',
                [customerId, categoryId, licenseLevel, safetyRating, irating],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async saveRaceResult(customerId: number, subsessionId: number, seriesName: string, trackName: string, startTime: string, finishPosition: number, incidents: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR IGNORE INTO race_results (customer_id, subsession_id, series_name, track_name, start_time, finish_position, incidents) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [customerId, subsessionId, seriesName, trackName, startTime, finishPosition, incidents],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getDriverData(customerId: number): Promise<DriverData | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT customer_id, display_name, last_updated as recorded_at FROM driver_data WHERE customer_id = ?',
                [customerId],
                (err, row: DriverData | undefined) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    async getLatestLicenseSnapshots(customerId: number): Promise<LicenseSnapshot[]> {
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
            `, [customerId], (err, rows: LicenseSnapshot[]) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async getLicenseHistory(customerId: number, categoryId: number, limit: number = 10): Promise<LicenseSnapshot[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM license_snapshots WHERE customer_id = ? AND category_id = ? ORDER BY recorded_at DESC LIMIT ?',
                [customerId, categoryId, limit],
                (err, rows: LicenseSnapshot[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async getRecentRaces(customerId: number, limit: number = 10): Promise<RaceResult[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM race_results WHERE customer_id = ? ORDER BY start_time DESC LIMIT ?',
                [customerId, limit],
                (err, rows: RaceResult[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async needsDataUpdate(customerId: number, maxAgeMinutes: number = 15): Promise<boolean> {
        const driverData = await this.getDriverData(customerId);
        if (!driverData) return true;

        const lastUpdate = new Date(driverData.recorded_at);
        const now = new Date();
        const diffMinutes = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);
        
        return diffMinutes >= maxAgeMinutes;
    }

    async getAllDriverData(): Promise<DriverData[]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT customer_id, display_name, last_updated as recorded_at FROM driver_data ORDER BY last_updated ASC'
        ) as DriverData[];
        
        return results;
    }

    async getOldestDriver(): Promise<DriverData | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT customer_id, display_name, last_updated as recorded_at FROM driver_data ORDER BY last_updated ASC LIMIT 1',
                [],
                (err, row: DriverData | undefined) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    close(): void {
        this.db.close();
    }
}
