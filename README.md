# iRacing Discord Bot

A Discord bot that maintains a leaderboard of iRacing drivers in your server and allows users to link their iRacing accounts.

## Features

- **Account Linking**: Users can link their iRacing accounts using `/link <username>`
- **Admin Account Management**: Server owners can link accounts for other users
- **Per-Guild Leaderboards**: Each Discord server gets its own leaderboard
- **Configurable Stats Channels**: Server owners can set which channel displays the leaderboard
- **Clean Channel Management**: Keeps the stats channel clean with only the leaderboard message
- **Periodic Updates**: Updates leaderboard every 30 minutes

## Setup

1. **Clone and Configure**:
   ```bash
   git clone <repository>
   cd iracing-discord-bot
   cp .env.example .env
   ```

2. **Edit `.env` file** with your credentials:
   ```
   DISCORD_TOKEN=your_bot_token_here
   IRACING_USERNAME=your_iracing_username
   IRACING_PASSWORD=your_iracing_password
   ```

3. **Run with Docker**:
   ```bash
   docker-compose up -d
   ```

## Environment Variables

- `DISCORD_TOKEN`: Your Discord bot token
- `IRACING_USERNAME`: iRacing account username (for API access)
- `IRACING_PASSWORD`: iRacing account password

## Commands

### User Commands
- `/link <iracing_username> [discord_user]`: Link an iRacing account to Discord
  - Self-service: `/link myusername`
  - Admin: `/link someusername @otheruser` (server owners only)
- `/unlink [discord_user]`: Remove iRacing account link
  - Self-service: `/unlink`
  - Admin: `/unlink @otheruser` (server owners only)

### Admin Commands (Server Owners Only)
- `/add-stats-channel <channel>`: Set a channel for leaderboard updates
- `/remove-stats-channel`: Disable leaderboard updates for this server
- `/list-links`: View all linked accounts in the server

## Requirements

- iRacing account with legacy authentication enabled
- Discord bot with appropriate permissions (Send Messages, Manage Messages, Use Slash Commands)

## Docker

The bot is containerized and includes:
- Automatic restart on failure
- Persistent data storage in `./data` volume
- Environment variable configuration