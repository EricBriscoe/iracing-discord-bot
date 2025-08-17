# iRacing Discord Bot

A Discord bot that maintains a leaderboard of iRacing drivers in your server and allows users to link their iRacing accounts.

## Features

- **Account Linking**: Users can link their iRacing accounts using `/link <username>`
- **Automatic Leaderboard**: Maintains a live leaderboard in a designated channel
- **Clean Channel Management**: Keeps the leaderboard channel clean with only the leaderboard message
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
   LEADERBOARD_CHANNEL_ID=channel_id_for_leaderboard
   ```

3. **Run with Docker**:
   ```bash
   docker-compose up -d
   ```

## Environment Variables

- `DISCORD_TOKEN`: Your Discord bot token
- `IRACING_USERNAME`: iRacing account username (for API access)
- `IRACING_PASSWORD`: iRacing account password
- `LEADERBOARD_CHANNEL_ID`: Discord channel ID where leaderboard will be posted

## Commands

- `/link <iracing_username>`: Link your iRacing account to Discord
- `/unlink`: Remove your iRacing account link

## Requirements

- iRacing account with legacy authentication enabled
- Discord bot with appropriate permissions (Send Messages, Manage Messages, Use Slash Commands)

## Docker

The bot is containerized and includes:
- Automatic restart on failure
- Persistent data storage in `./data` volume
- Environment variable configuration