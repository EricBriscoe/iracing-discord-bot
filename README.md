# iRacing Discord Bot - TypeScript Edition

A Discord bot that integrates with iRacing to provide leaderboards and user account linking functionality. This bot has been completely rewritten in TypeScript for better performance and maintainability.

## Features

- **Account Linking**: Link Discord accounts to iRacing profiles
- **Leaderboards**: Automatic leaderboard updates showing iRating, Safety Rating, and License levels
- **Admin Commands**: Server owner controls for managing linked accounts and leaderboard channels
- **Minimal Permissions**: Uses only the necessary Discord intents (Guilds only)

## Commands

### User Commands
- `/link <iracing_username>` - Link your Discord account to an iRacing profile
- `/unlink` - Unlink your Discord account from iRacing

### Admin Commands (Server Owner Only)
- `/link <iracing_username> <discord_user>` - Link another user's account
- `/unlink <discord_user>` - Unlink another user's account
- `/list-links` - Show all linked accounts on the server
- `/toggle-stats-channel [channel]` - Enable/disable automatic leaderboard updates in a channel

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
- **SQLite3** for local data storage
- **Axios** for HTTP requests to iRacing API
- **Node-cron** for scheduled leaderboard updates

### Project Structure
```
src/
├── bot.ts           # Main bot implementation
├── database.ts      # SQLite database operations
└── iracing-client.ts # iRacing API client
```

## Database Schema

### Users Table
- `discord_id` (TEXT PRIMARY KEY) - Discord user ID
- `iracing_username` (TEXT) - iRacing username
- `iracing_customer_id` (INTEGER) - iRacing customer ID
- `created_at` (DATETIME) - Account creation timestamp

### Guild Configs Table
- `guild_id` (TEXT PRIMARY KEY) - Discord guild ID
- `stats_channel_id` (TEXT) - Channel for leaderboard updates
- `stats_message_id` (TEXT) - Message ID of current leaderboard
- `created_at` (DATETIME) - Configuration creation timestamp
- `updated_at` (DATETIME) - Last update timestamp

## Leaderboard Updates

The bot automatically updates leaderboards every 30 minutes for configured channels. The leaderboard shows:
- Top 10 users by iRating (Road category)
- Current iRating, Safety Rating, and License level
- Real-time data from iRacing API

## Migration from Python

This TypeScript version replaces the previous Python implementation with:
- Better type safety and IDE support
- Improved error handling and logging
- More efficient Discord.js v14 implementation
- Direct iRacing API integration (no third-party library dependency)
- Enhanced Docker support with multi-stage builds

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
