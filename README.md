# iRacing Discord Bot - Race Result Tracker

A Discord bot that integrates with iRacing to automatically track and post race results for linked Discord users. This bot monitors race activity and posts results to designated channels in real-time.

## Features

- **Account Linking**: Link Discord accounts to iRacing profiles using Customer ID
- **Race Result Tracking**: Automatic monitoring of race results for all linked users
- **Real-time Notifications**: Posts race results to designated channels as they happen
- **Admin Controls**: Server administrator controls for managing linked accounts and race log channels
- **Rich Embeds**: Beautiful race result embeds with position colors, iRating changes, and incident counts

## Commands

### User Commands
- `/link <customer_id>` - Link your Discord account to an iRacing profile using your Customer ID
- `/unlink` - Unlink your Discord account from iRacing

### Admin Commands (Server Administrator Only)
- `/link <customer_id> <discord_user>` - Link another user's account to iRacing
- `/unlink <discord_user>` - Unlink another user's account
- `/race-log` - Configure the current channel to receive race result notifications

## How It Works

1. **Link Accounts**: Users (or admins) link Discord accounts to iRacing profiles using their Customer ID
2. **Configure Channels**: Admins use `/race-log` to designate channels for race result notifications
3. **Automatic Tracking**: The bot continuously monitors iRacing for new race results from linked users
4. **Real-time Posts**: When new results are found, rich embeds are posted to all configured race log channels

## Race Result Information

Each race result post includes:
- **Driver**: Discord mention and iRacing username
- **Position**: Final finishing position with ordinal suffix (1st, 2nd, 3rd, etc.)
- **Track**: Track name and configuration
- **Car**: Vehicle used in the race
- **Incidents**: Total incident count
- **Event Type**: Race, Qualifying, Time Trial, or Practice
- **iRating Change**: Before/after iRating with change indicator (if available)
- **Color Coding**: Gold for 1st place, silver for podium, bronze for top 10, gray for others

## Setup

### Prerequisites
- Node.js 18 or higher
- Docker (optional, for containerized deployment)
- Discord Bot Token
- iRacing account credentials

### Environment Variables
Create a `.env` file based on `.env.example`:

```env
DISCORD_TOKEN=your_discord_bot_token_here
IRACING_USERNAME=your_iracing_username
IRACING_PASSWORD=your_iracing_password
```

**Note**: You can use either your raw iRacing password or pre-hash it and use `IRACING_HASHWORD` instead of `IRACING_PASSWORD`.

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

3. Start the bot:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### Docker Deployment

1. Build the Docker image:
```bash
docker build -t iracing-discord-bot .
```

2. Run with docker-compose:
```bash
docker-compose up -d
```

## Architecture

The bot is built with:
- **TypeScript** for type safety and better development experience
- **Discord.js v14** for Discord API interactions
- **SQLite3** for local data storage and race result history
- **Axios** for HTTP requests to iRacing API
- **Automated Polling** for checking new race results every 10 minutes

### Project Structure
```
src/
├── bot.ts           # Main bot implementation with race result tracking
├── database.ts      # SQLite database operations for users, race results, and channels
└── iracing-client.ts # iRacing API client with race result search capabilities
```

## Database Schema

### User Links Table
- `discord_id` (TEXT PRIMARY KEY) - Discord user ID
- `iracing_username` (TEXT) - iRacing display name
- `iracing_customer_id` (INTEGER) - iRacing customer ID
- `created_at` (DATETIME) - Link creation timestamp

### Race Results Table
- `id` (INTEGER PRIMARY KEY) - Unique result ID
- `subsession_id` (INTEGER) - iRacing subsession ID
- `discord_id` (TEXT) - Discord user ID
- `iracing_customer_id` (INTEGER) - iRacing customer ID
- `series_id`, `series_name` - Series information
- `track_id`, `track_name`, `config_name` - Track information
- `car_id`, `car_name` - Car information
- `start_time` (DATETIME) - Race start time
- `finish_position` (INTEGER) - Final position
- `starting_position` (INTEGER) - Starting position
- `incidents` (INTEGER) - Total incidents
- `irating_before`, `irating_after` - iRating before/after race
- `event_type` (TEXT) - Race, Qualifying, etc.
- `official_session` (BOOLEAN) - Whether it was an official session

### Race Log Channels Table
- `channel_id` (TEXT PRIMARY KEY) - Discord channel ID for race result posts
- `guild_id` (TEXT) - Discord guild ID
- `created_at` (DATETIME) - Configuration timestamp

### Official Series Table
- `series_id` (INTEGER PRIMARY KEY) - iRacing series ID
- `series_name` (TEXT) - Full series name
- `series_short_name` (TEXT) - Short series name
- `category` (TEXT) - Racing category (Road, Oval, etc.)
- `category_id` (INTEGER) - Category ID

## Race Result Monitoring

The bot performs the following monitoring cycle:

1. **User Polling**: Every 10 minutes, check all linked users for new race results
2. **API Queries**: Use iRacing's series search API to find recent results
3. **Deduplication**: Compare against stored results to avoid posting duplicates
4. **Result Processing**: Fetch detailed subsession data for complete race information
5. **Channel Broadcasting**: Post rich embeds to all configured race log channels

## Finding Your Customer ID

To link your account, you need your iRacing Customer ID (not your username). You can find this:
1. Log into members.iracing.com
2. Go to your profile or account settings
3. Your Customer ID is displayed as a number (e.g., 123456)

## Privacy & Data

- The bot only stores Discord IDs, iRacing Customer IDs, usernames, and race result data
- No sensitive iRacing account information is stored
- Race results are public information available through iRacing's official API
- Data is stored locally in SQLite database files

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes following TypeScript best practices
4. Test thoroughly with actual iRacing integration
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Migration Notes

This version completely replaces the previous leaderboard-based functionality with race result tracking. If upgrading from an older version, you may need to:

1. Update your Discord bot commands (old `/track` and `/untrack` commands are removed)
2. Reconfigure channels using the new `/race-log` command
3. Re-link users if needed (the linking system has been improved)
