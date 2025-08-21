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

export interface LapTimeRecord {
    id?: number;
    combo_id: number;
    discord_id: string;
    iracing_customer_id: number;
    iracing_username: string;
    lap_time_microseconds: number;
    subsession_id: number;
    event_type: string;
    recorded_at: string;
    last_updated: string;
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
                'SELECT id, series_id, track_id, car_id, track_name, config_name, car_name, last_updated FROM track_car_combos WHERE series_id = ?',
                [seriesId],
                (err, rows: TrackCarCombo[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
    
    async upsertLapTimeRecord(record: LapTimeRecord): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO lap_time_records (combo_id, discord_id, iracing_customer_id, iracing_username, lap_time_microseconds, subsession_id, event_type, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [record.combo_id, record.discord_id, record.iracing_customer_id, record.iracing_username, record.lap_time_microseconds, record.subsession_id, record.event_type, record.recorded_at],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    async getTopLapTimesForCombo(comboId: number, limit: number = 10): Promise<LapTimeRecord[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT id, combo_id, discord_id, iracing_customer_id, iracing_username, lap_time_microseconds, subsession_id, event_type, recorded_at, last_updated FROM lap_time_records WHERE combo_id = ? ORDER BY lap_time_microseconds ASC LIMIT ?',
                [comboId, limit],
                (err, rows: LapTimeRecord[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    close(): void {
        this.db.close();
    }
}
