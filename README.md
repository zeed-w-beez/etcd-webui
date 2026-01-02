# etcd-webui

A modern web UI for etcd built with Vite + React + TypeScript frontend and Golang backend.

## Architecture

- **Frontend**: Vite + React + TypeScript with ShadCN UI + Tailwind CSS
- **Backend**: Golang with Gin framework
- **Database**: etcd v3

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

## Environment Variables

Override config with environment variables:

- `ETCD_WEBUI_ETCD_ENDPOINT`
- `ETCD_WEBUI_SERVER_PORT`
- `ETCD_WEBUI_STATIC_DIR`
- `ETCD_WEBUI_DIAL_TIMEOUT`
- `ETCD_WEBUI_USERNAME`
- `ETCD_WEBUI_PASSWORD`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| GET | /api/keys | List all keys |
| GET | /api/keys/:key | Get single key |
| POST | /api/keys | Create key |
| PUT | /api/keys/:key | Update key |
| DELETE | /api/keys/:key | Delete key |
| DELETE | /api/keys | Delete multiple keys |

## Development

### Frontend Development

```bash
cd frontend
npm run dev
```

Frontend will be available at http://localhost:5173

### Backend Development

```bash
cd backend
go run main.go --config config.yaml
```
