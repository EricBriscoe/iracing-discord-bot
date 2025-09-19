import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

export interface UserLink {
    discord_id: string;
    iracing_username: string;
    iracing_customer_id: number | null;
    created_at: string;
}

export interface OfficialSeries {
    series_id: number;
    series_name: string;
    series_short_name: string;
    category: string;
    category_id: number;
    last_updated: string;
}

export interface ChannelTrack {
    channel_id: string;
    guild_id: string;
    series_id: number;
    series_name: string;
    created_at: string;
}

export interface TrackCarCombo {
    id?: number;
    series_id: number;
    track_id: number;
    car_id: number;
    track_name: string;
    config_name: string;
    car_name: string;
    last_updated: string;
}

export interface RaceResult {
    id?: number;
    subsession_id: number;
    discord_id: string;
    iracing_customer_id: number;
    iracing_username: string;
    series_id: number;
    series_name: string;
    track_id: number;
    track_name: string;
    config_name: string;
    car_id: number;
    car_name: string;
    start_time: string;
    finish_position: number;
    starting_position?: number;
    incidents: number;
    irating_before?: number;
    irating_after?: number;
    license_level_before?: number;
    license_level_after?: number;
    event_type: string;
    official_session: boolean;
    created_at: string;
    last_updated: string;
}

export interface RaceLogChannel {
    channel_id: string;
    guild_id: string;
    created_at: string;
}

export class Database {
    private db: sqlite3.Database;
    private dbPath: string;

    constructor(dbPath: string = 'data/data.db') {
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
            CREATE TABLE IF NOT EXISTS race_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subsession_id INTEGER NOT NULL,
                discord_id TEXT NOT NULL,
                iracing_customer_id INTEGER NOT NULL,
                iracing_username TEXT NOT NULL,
                series_id INTEGER NOT NULL,
                series_name TEXT NOT NULL,
                track_id INTEGER NOT NULL,
                track_name TEXT NOT NULL,
                config_name TEXT NOT NULL,
                car_id INTEGER NOT NULL,
                car_name TEXT NOT NULL,
                start_time DATETIME NOT NULL,
                finish_position INTEGER NOT NULL,
                starting_position INTEGER,
                incidents INTEGER NOT NULL,
                irating_before INTEGER,
                irating_after INTEGER,
                license_level_before INTEGER,
                license_level_after INTEGER,
                event_type TEXT NOT NULL,
                official_session BOOLEAN NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(subsession_id, discord_id),
                FOREIGN KEY (discord_id) REFERENCES user_links (discord_id)
            )
        `);

        await run(`
            CREATE TABLE IF NOT EXISTS race_log_channels (
                channel_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Server-specific prompt additions prepended to AI prompts
        await run(`
            CREATE TABLE IF NOT EXISTS guild_prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    async linkUser(discordId: string, iracingUsername: string, iracingCustomerId?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO user_links (discord_id, iracing_username, iracing_customer_id) VALUES (?, ?, ?)',
                [discordId, iracingUsername, iracingCustomerId || null],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getLinkedUser(discordId: string): Promise<UserLink | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT discord_id, iracing_username, iracing_customer_id, created_at FROM user_links WHERE discord_id = ?',
                [discordId],
                (err, row: UserLink | undefined) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    async unlinkUser(discordId: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM user_links WHERE discord_id = ?', [discordId], function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    }

    async getAllLinkedUsers(): Promise<UserLink[]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT discord_id, iracing_username, iracing_customer_id, created_at FROM user_links ORDER BY created_at DESC'
        ) as UserLink[];
        
        return results;
    }

    async updateOfficialSeries(seriesList: OfficialSeries[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
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
                    this.db.run(
                        'INSERT INTO official_series (series_id, series_name, series_short_name, category, category_id) VALUES (?, ?, ?, ?, ?)',
                        [series.series_id, series.series_name, series.series_short_name, series.category, series.category_id],
                        (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            completed++;
                            if (completed === total) {
                                resolve();
                            }
                        }
                    );
                }
            });
        });
    }
    
    async getOfficialSeries(): Promise<OfficialSeries[]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT series_id, series_name, series_short_name, category, category_id, last_updated FROM official_series ORDER BY series_name'
        ) as OfficialSeries[];
        
        return results;
    }
    
    async setChannelTrack(channelId: string, guildId: string, seriesId: number, seriesName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO channel_tracks (channel_id, guild_id, series_id, series_name) VALUES (?, ?, ?, ?)',
                [channelId, guildId, seriesId, seriesName],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    async getChannelTrack(channelId: string): Promise<ChannelTrack | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT channel_id, guild_id, series_id, series_name, created_at FROM channel_tracks WHERE channel_id = ?',
                [channelId],
                (err, row: ChannelTrack | undefined) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }
    
    async removeChannelTrack(channelId: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM channel_tracks WHERE channel_id = ?', [channelId], function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    }
    
    async getGuildLinkedUsers(guildId: string): Promise<UserLink[]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT DISTINCT ul.discord_id, ul.iracing_username, ul.iracing_customer_id, ul.created_at FROM user_links ul WHERE ul.discord_id IN (SELECT DISTINCT discord_id FROM user_links)'
        ) as UserLink[];
        
        return results;
    }
    
    async getAllChannelTracks(): Promise<ChannelTrack[]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT channel_id, guild_id, series_id, series_name, created_at FROM channel_tracks'
        ) as ChannelTrack[];
        
        return results;
    }
    
    async upsertTrackCarCombo(combo: TrackCarCombo): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO track_car_combos (series_id, track_id, car_id, track_name, config_name, car_name) VALUES (?, ?, ?, ?, ?, ?)',
                [combo.series_id, combo.track_id, combo.car_id, combo.track_name, combo.config_name, combo.car_name],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
    
    async getTrackCarCombosBySeriesId(seriesId: number): Promise<TrackCarCombo[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT id, series_id, track_id, car_id, track_name, config_name, car_name, last_updated FROM track_car_combos WHERE series_id = ? ORDER BY track_name ASC, car_name ASC',
                [seriesId],
                (err, rows: TrackCarCombo[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
    
    // Race Log Channel methods
    async setRaceLogChannel(channelId: string, guildId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO race_log_channels (channel_id, guild_id) VALUES (?, ?)',
                [channelId, guildId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getRaceLogChannel(channelId: string): Promise<RaceLogChannel | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT channel_id, guild_id, created_at FROM race_log_channels WHERE channel_id = ?',
                [channelId],
                (err, row: RaceLogChannel | undefined) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    async getAllRaceLogChannels(): Promise<RaceLogChannel[]> {
        const all = promisify(this.db.all.bind(this.db));
        const results = await all(
            'SELECT channel_id, guild_id, created_at FROM race_log_channels ORDER BY created_at DESC'
        ) as RaceLogChannel[];
        
        return results;
    }

    // Guild prompt methods
    async addGuildPrompt(guildId: string, content: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO guild_prompts (guild_id, content) VALUES (?, ?)',
                [guildId, content],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getGuildPrompts(guildId: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT content FROM guild_prompts WHERE guild_id = ? ORDER BY created_at ASC, id ASC',
                [guildId],
                (err, rows: Array<{ content: string }>) => {
                    if (err) reject(err);
                    else resolve((rows || []).map(r => r.content));
                }
            );
        });
    }

    async clearGuildPrompts(guildId: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM guild_prompts WHERE guild_id = ?', [guildId], function(err) {
                if (err) reject(err);
                else resolve(this.changes || 0);
            });
        });
    }

    async removeRaceLogChannel(channelId: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM race_log_channels WHERE channel_id = ?', [channelId], function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    }

    // Race Result methods
    async upsertRaceResult(result: RaceResult): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO race_results (
                    subsession_id, discord_id, iracing_customer_id, iracing_username,
                    series_id, series_name, track_id, track_name, config_name,
                    car_id, car_name, start_time, finish_position, starting_position,
                    incidents, irating_before, irating_after, license_level_before,
                    license_level_after, event_type, official_session
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    result.subsession_id, result.discord_id, result.iracing_customer_id, result.iracing_username,
                    result.series_id, result.series_name, result.track_id, result.track_name, result.config_name,
                    result.car_id, result.car_name, result.start_time, result.finish_position, result.starting_position,
                    result.incidents, result.irating_before, result.irating_after, result.license_level_before,
                    result.license_level_after, result.event_type, result.official_session ? 1 : 0
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getRecentRaceResults(discordId: string, limit: number = 10): Promise<RaceResult[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM race_results WHERE discord_id = ? 
                 ORDER BY start_time DESC LIMIT ?`,
                [discordId, limit],
                (err, rows: RaceResult[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async getAllRaceResultsAsc(): Promise<RaceResult[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM race_results ORDER BY datetime(start_time) ASC, id ASC`,
                [],
                (err, rows: RaceResult[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    async getRaceResultsForUserAsc(discordId: string, opts?: { trackId?: number; carId?: number }): Promise<RaceResult[]> {
        const params: any[] = [discordId];
        const where: string[] = ['discord_id = ?'];
        if (opts?.trackId) { where.push('track_id = ?'); params.push(opts.trackId); }
        if (opts?.carId) { where.push('car_id = ?'); params.push(opts.carId); }
        const sql = `SELECT * FROM race_results WHERE ${where.join(' AND ')} ORDER BY datetime(start_time) ASC, id ASC`;
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows: RaceResult[]) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async getRaceResultExists(subsessionId: number, discordId: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT 1 FROM race_results WHERE subsession_id = ? AND discord_id = ?',
                [subsessionId, discordId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });
    }

    async getLatestRaceResultTime(discordId: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT start_time FROM race_results WHERE discord_id = ? ORDER BY start_time DESC LIMIT 1',
                [discordId],
                (err, row: { start_time: string } | undefined) => {
                    if (err) reject(err);
                    else resolve(row?.start_time || null);
                }
            );
        });
    }

    close(): void {
        if (this.db) {
            try {
                this.db.close();
            } catch (error) {
                // Ignore errors when closing database (it may already be closed)
                console.log('Database close error (likely already closed):', error);
            }
        }
    }
}
