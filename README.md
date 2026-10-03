# Neko2Neko Music

Full-stack music player with React + Express, designed for local media libraries, YouTube integration, and synchronized playback experiences.

## Stack

- **Frontend**: React 18, TailwindCSS, Zustand, Framer Motion, React Router
- **Backend**: Express, Better SQLite3, WebSocket, media-engine
- **Sync Engine**: `@homelab/sync-engine` for video/subtitle synchronization
- **Database**: SQLite with FTS5 full-text search

## Features

- Local media library management with folder scanning
- YouTube search and streaming integration
- Playlist and queue management
- Lyrics display and editing
- Synchronized video playback with subtitle support
- Adaptive audio output routing
- Listening history and statistics

## Prerequisites

- Node.js >= 18
- npm >= 9
- pnpm (optional, for backend workspace)

## Quick Start

```bash
# Install dependencies
npm install

# Development mode (frontend + backend)
npm run dev

# Build frontend
npm run build

# Start backend only
npm start
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend and backend concurrently |
| `npm run frontend` | Start Vite dev server only |
| `npm run backend` | Start Express backend only |
| `npm run build` | Build frontend for production |
| `npm start` | Start backend in production |

## Project Structure

```
Music/
├── frontend/               # React + Vite + TailwindCSS
│   ├── src/
│   │   ├── app/            # App entry and routing
│   │   ├── music/          # Music player components
│   │   ├── shared/         # Shared UI components
│   │   ├── store/          # Zustand state stores
│   │   ├── utils/          # Frontend utilities
│   │   └── engines/        # Audio/video engine wrappers
│   └── package.json
├── backend/                # Express + SQLite
│   ├── src/
│   │   ├── gateway/        # Media engine and DB gateway
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   └── utils/          # Backend utilities
│   └── package.json
├── cache/                  # Runtime cache
├── logs/                   # Application logs
└── package.json            # Root workspace config
```

## Configuration

- Frontend environment: `frontend/.env`
- Backend config: `backend/src/gateway/db/config.toml`
- Media engine config: `backend/src/gateway/media-engine/config.toml`

## Tech Details

- **State Management**: Zustand stores for playback, playlists, and UI state
- **Routing**: React Router v7 with protected routes
- **Styling**: TailwindCSS with custom theme and animations
- **Virtualization**: react-window for large lists
- **Charts**: Recharts for listening statistics
- **Video**: HLS.js and custom video sync engine
- **Markdown**: react-markdown with syntax highlighting

## License

Apache 2.0
