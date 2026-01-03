# etcd-webui Frontend

React + TypeScript + Vite frontend for etcd-webui.

## Tech Stack

| Category | Technology |
|----------|------------|
| Build Tool | Vite 7.x |
| Framework | React 19 |
| Language | TypeScript 5.x |
| Styling | Tailwind CSS + ShadCN UI |
| UI Components | Radix UI primitives |
| Code Editor | CodeMirror 6 |
| Diff Viewer | diff (npm package) |
| Icons | Lucide React |

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── ui/              # ShadCN UI components
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── select.tsx
│   │   │   └── ...
│   │   ├── WordDiff.tsx     # Word diff comparison component
│   │   ├── ClusterManager.tsx
│   │   ├── ClusterStatusCard.tsx
│   │   └── WatchPanel.tsx
│   ├── hooks/
│   │   └── use-toast.tsx    # Toast notifications hook
│   ├── lib/
│   │   └── utils.ts         # Utility functions
│   ├── services/
│   │   └── etcd.ts          # API service layer
│   ├── App.tsx              # Main application component
│   └── main.tsx             # Entry point
├── public/                  # Static assets
├── index.html
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── vite.config.ts
```

## Important Notes

### Static Build Only

This frontend is designed to be **built and served by the Go backend**. It cannot run standalone because:

1. **API Dependencies**: All API calls are made to `/api/*` endpoints served by the Go backend
2. **No Mock Server**: There is no standalone API server or mock data layer
3. **Backend Integration**: The Go backend serves static files from `frontend/dist/`

### Development vs Production

| Mode | Command | API Source |
|------|---------|------------|
| Development | `npm run dev` | Requires running Go backend on :8080 |
| Production | `npm run build` | Static files served by Go backend |

## Development

### Prerequisites

1. Start the Go backend (serves API and static files):
   ```bash
   cd ../backend
   go run main.go --config config.yaml
   ```

2. Start frontend dev server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:5173 (frontend) → API calls proxied to localhost:8080 (backend)

### Building for Production

```bash
npm install
npm run build
```

Output is written to `dist/` directory, which is served by the Go backend.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server at :5173 |
| `npm run build` | Build production bundle to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests with Vitest |

## Key Components

### WordDiff

The `WordDiff` component provides word-level diff comparison for version history:

```tsx
import { WordDiff } from '@/components/WordDiff'

<WordDiff
  oldValue={leftHistory.value}
  newValue={rightHistory.value}
/>
```

- Uses `diff` npm package's `diffWords` function
- Green highlighting for added content
- Red strikethrough for removed content
- Supports dark/light theme via Tailwind classes

### API Service Layer

All API calls go through `src/services/etcd.ts`:

```typescript
import { etcdApi } from '@/services/etcd'

// Example usage
const keys = await etcdApi.getKeys('/', 100)
```

## Styling

- **Tailwind CSS**: Utility-first CSS framework
- **ShadCN UI**: Copy-paste component library based on Radix UI
- **Dark Mode**: Supported via Tailwind's `dark:` prefix and CSS variables
- **CSS Variables**: Defined in CSS for theming

## Dependencies

### Production Dependencies

```
@codemirror/lang-json     - JSON syntax highlighting
@codemirror/lang-yaml     - YAML syntax highlighting
@radix-ui/react-*         - UI component primitives
@uiw/react-codemirror     - CodeMirror wrapper
class-variance-authority   - CSS class variants
clsx                      - Class name utility
diff                      - Text diff algorithm
lucide-react              - Icon library
react / react-dom         - React framework
tailwind-merge             - Tailwind class merging
tailwindcss-animate        - Tailwind animations
```

### Development Dependencies

```
typescript                  - Type checking
vite                        - Build tool
eslint                      - Linting
tailwindcss                 - CSS framework
vitest                      - Testing
