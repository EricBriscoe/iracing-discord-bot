import { EmbedBuilder, Colors } from 'discord.js';
import { TrackCarCombo, LapTimeRecord } from './database';

export interface LeaderboardEmbedOptions {
    trackImageUrl?: string;
    carImageUrl?: string;
    trackMapActiveUrl?: string;
}

export class LeaderboardEmbedBuilder {
    build(seriesName: string, leaderboards: { combo: TrackCarCombo; times: LapTimeRecord[] }[], options?: LeaderboardEmbedOptions): EmbedBuilder[] {
        const title = `🏁 ${seriesName} — Lap Time Leaderboards`;
        const embeds: EmbedBuilder[] = [];

        if (!leaderboards || leaderboards.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(
                    '📊 This channel is now tracking lap times for this series.\n'
                    + 'Leaderboards will appear here once lap time data becomes available.'
                )
                .setColor(Colors.Blurple)
                .setTimestamp(new Date());
            if (options?.carImageUrl) embed.setThumbnail(options.carImageUrl);
            if (options?.trackMapActiveUrl) embed.setImage(options.trackMapActiveUrl);
            else if (options?.trackImageUrl) embed.setImage(options.trackImageUrl);
            embeds.push(embed);
            return embeds;
        }

        // Build fields (max 25 per embed)
        const fields = leaderboards.map(lb => {
            const name = this.truncate(`${lb.combo.track_name} (${lb.combo.config_name}) — ${lb.combo.car_name}`, 256);
            const value = this.buildFieldValue(lb.times);
            return { name, value, inline: false } as const;
        });

        const chunkSize = 25;
        for (let i = 0; i < fields.length; i += chunkSize) {
            const chunk = fields.slice(i, i + chunkSize);
            const page = Math.floor(i / chunkSize) + 1;
            const totalPages = Math.ceil(fields.length / chunkSize);
            const embed = new EmbedBuilder()
                .setTitle(totalPages > 1 ? `${title} — Page ${page}/${totalPages}` : title)
                .addFields(chunk as any)
                .setColor(Colors.Blurple)
                .setTimestamp(new Date());
            if (page === 1) {
                if (options?.carImageUrl) embed.setThumbnail(options.carImageUrl);
                if (options?.trackMapActiveUrl) embed.setImage(options.trackMapActiveUrl);
                else if (options?.trackImageUrl) embed.setImage(options.trackImageUrl);
            }
            embeds.push(embed);
        }

        return embeds;
    }

    private buildFieldValue(times: LapTimeRecord[]): string {
        if (!times || times.length === 0) {
            return 'No lap times recorded yet.';
        }
        const lines = times.map((record, index) => {
            const position = index + 1;
            const emoji = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : '🏁';
            const lapTime = this.formatLapTime(record.lap_time_microseconds);
            return `${emoji} **${position}.** <@${record.discord_id}> — \`${lapTime}\``;
        });
        // Ensure value <= 1024 characters
        let value = lines.join('\n');
        if (value.length > 1024) {
            value = this.truncate(value, 1021) + '…';
        }
        return value;
    }

    private truncate(input: string, max: number): string {
        return input.length > max ? input.slice(0, max - 1) + '…' : input;
    }

    private formatLapTime(tenThousandths: number): string {
        const totalSeconds = tenThousandths / 10000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = (totalSeconds % 60).toFixed(3);
        return `${minutes}:${seconds.padStart(6, '0')}`;
    }
}
