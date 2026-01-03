# etcd-webui

A modern web UI for etcd built with Vite + React + TypeScript frontend and Golang backend.

## Architecture

This project uses a **monorepo-like structure** with frontend and backend in separate directories:

```
etcd-webui/
├── frontend/          # Vite + React + TypeScript frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   │   └── ui/       # ShadCN UI components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── lib/          # Utility functions
│   │   └── services/     # API service layer
│   ├── public/           # Static assets
│   └── package.json      # Frontend dependencies
│
├── backend/           # Golang backend
│   ├── handlers/      # HTTP handlers
│   ├── models/        # Data models
│   └── config.yaml    # Backend configuration
│
└── README.md          # This file
```

### Frontend Architecture

- **Build Tool**: Vite (fast development and optimized production builds)
- **Framework**: React 19 with TypeScript
- **UI Components**: ShadCN UI + Tailwind CSS
- **State Management**: React useState/useEffect hooks
- **HTTP Client**: Custom API service layer
- **Code Editor**: CodeMirror for JSON/YAML syntax highlighting
- **Diff Viewer**: word-diff for version comparison

**Important**: The frontend is built as a **static HTML/JS/CSS bundle** and served by the Go backend. It cannot run standalone because:

1. All API calls are proxied to the backend (`/api/*` endpoints)
2. Backend serves static files from `frontend/dist/`
3. No mock API or standalone server mode exists

### Backend Architecture

- **Framework**: Gin (Go web framework)
- **Database**: etcd v3 (key-value store)
- **Static File Serving**: Serves built frontend from `frontend/dist/`
- **API Layer**: RESTful endpoints for CRUD operations on etcd

## Deployment Model

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│                                                  │
│   http://localhost:8080 (Go backend)            │
│              │                                   │
│              ▼                                   │
│   ┌─────────────────────────────────┐           │
│   │    Go Backend (Gin)             │           │
│   │                                 │           │
│   │   /api/*  →  etcd v3            │           │
│   │   /*       →  Static Files      │           │
│   │     (frontend/dist/index.html)  │           │
│   └─────────────────────────────────┘           │
│              │                                   │
│              ▼                                   │
│      ┌─────────────────┐                         │
│      │   etcd v3       │                         │
│      │ localhost:2379  │                         │
│      └─────────────────┘                         │
└─────────────────────────────────────────────────┘
```

## Prerequisites

- Go 1.21+
- Node.js 18+
- etcd v3 running on localhost:2379

## Quick Start

### 1. Build Frontend

```bash
cd frontend
npm install
npm run build
```

### 2. Start Backend

```bash
cd backend
go mod download
go run main.go --config config.yaml
```

### 3. Access UI

Open http://localhost:8080 in your browser.

## Configuration

Edit `backend/config.yaml` to configure:

- `etcd_endpoint`: etcd server address (default: localhost:2379)
- `server_port`: web server port (default: 8080)
- `static_dir`: frontend build output directory
- `dial_timeout`: etcd connection timeout in seconds
- `username`: etcd authentication username (optional)
- `password`: etcd authentication password (optional)
