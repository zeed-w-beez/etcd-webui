# etcd-webui

[English](README.md) | [简体中文](README.zh-CN.md)

A modern web UI for etcd built with Vite + React + TypeScript frontend and Golang backend.

![etcd-webui screenshot](./screenshot.png)

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

## Development Mode

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

This will start the Vite development server, but please note that you still need to run the backend to handle API requests.

### Backend Development

```bash
cd backend
go mod download
go run main.go --config config.yaml
```

## Testing

### Frontend Testing

```bash
cd frontend
npm run test
```

### Backend Testing

```bash
cd backend
go test ./...
```

## Code Style Check

### Frontend

```bash
cd frontend
npm run lint
```

### Backend

```bash
cd backend
go fmt ./...
go vet ./...
```

## Build Production Version

### 1. Build Frontend

```bash
cd frontend
npm install
npm run build
```

### 2. Build Backend

```bash
cd backend
go build -o etcd-webui main.go
```

### 3. Run Production Version

```bash
./etcd-webui --config config.yaml
```

## Docker Deployment

### Build Docker Image

```bash
docker build -t etcd-webui:latest .
```

### Run with Docker

Basic usage (connects to etcd on host machine):

```bash
docker run -d \
  --name etcd-webui \
  -p 8080:8080 \
  --network host \
  etcd-webui:latest
```

Run with custom etcd endpoint (if etcd is in another container or remote):

```bash
docker run -d \
  --name etcd-webui \
  -p 8080:8080 \
  -e ETCD_ENDPOINT=etcd-server:2379 \
  etcd-webui:latest
```

Run with custom configuration file:

```bash
docker run -d \
  --name etcd-webui \
  -p 8080:8080 \
  -v /path/to/config.yaml:/app/backend/config.yaml \
  etcd-webui:latest \
  --config /app/backend/config.yaml
```

Run with Docker Compose:

```yaml
version: '3.8'
services:
  etcd-webui:
    image: etcd-webui:latest
    container_name: etcd-webui
    ports:
      - "8080:8080"
    environment:
      - ETCD_ENDPOINT=etcd:2379
    depends_on:
      - etcd
    networks:
      - etcd-network

  etcd:
    image: quay.io/coreos/etcd:v3.5.10
    container_name: etcd
    environment:
      - ETCD_ADVERTISE_CLIENT_URLS=http://etcd:2379
      - ETCD_LISTEN_CLIENT_URLS=http://0.0.0.0:2379
    networks:
      - etcd-network

networks:
  etcd-network:
    driver: bridge
```

### Environment Variables

The following environment variables can be used to configure the application:

- `ETCD_WEBUI_SERVER_PORT`: Server port (default: 8080)
- `ETCD_WEBUI_LOG_LEVEL`: Log level - debug, info, warn, error (default: info)

## Features

- ✅ Cluster status monitoring
- ✅ Key-value pair management (CRUD operations)
- ✅ JSON/YAML syntax highlighting
- ✅ Key-value history and diff comparison
- ✅ Key prefix search and filtering
- ✅ Real-time monitoring (Watch)
- ✅ Multi-cluster support
- ✅ Authentication support

## Contributing

Contributions are welcome! Please submit issues and pull requests.