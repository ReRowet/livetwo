# RE Stream (livetwo) — 24/7 Live Streaming Web Server

RE Stream is a modern web-based stream manager powered by Node.js, Express, FFmpeg, and PM2.

## ✨ Features
- 🚀 **Multi-Channel & Multi-Stream Manager**: Schedule, organize, and stream to YouTube, Facebook, Twitch, and custom RTMP endpoints.
- 🔁 **Continuous 24/7 Streaming**: Concat demuxer with auto-reconnect, 1-hour loop options, playlist shuffling, and live status broadcasting via SSE.
- ⚡ **PM2 & Linux Optimized**: Cross-platform path normalizer, background process lifecycle, memory management, and auto-start on server boot.
- 📁 **Automated Setup Script**: 1-step installation script (`setup.sh`) for Ubuntu/Debian/CentOS Linux servers.
- 📊 **Real-time System Metrics**: Live CPU, RAM, Disk, Network I/O monitoring.

## 🚀 Quick Start (Linux VPS)

```bash
# Clone the repository
git clone https://github.com/ReRowet/livetwo.git
cd livetwo

# Run automated installer
chmod +x setup.sh
./setup.sh
```

## 🛠 Manual Management (PM2)

```bash
# Start server with PM2
npm run pm2:start

# View live streaming logs
npm run pm2:logs

# Check status
npm run pm2:status

# Restart server
npm run pm2:restart

# Stop server
npm run pm2:stop
```

## 🔒 Configuration (`.env`)

```env
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123
PORT=3002
JWT_SECRET=re_stream_jwt_secret_token_2026_super_secure
JWT_REFRESH_SECRET=re_stream_jwt_refresh_secret_2026_super_secure
```
