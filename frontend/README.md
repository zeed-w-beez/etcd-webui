# etcd-webui Frontend

React + TypeScript + Vite 构建的 etcd-webui 前端界面。

## 技术栈

| 分类 | 技术 |
|------|------|
| 构建工具 | Vite 7.x |
| 框架 | React 19 |
| 语言 | TypeScript 5.x |
| 样式 | Tailwind CSS + ShadCN UI |
| UI 组件 | Radix UI 组件库 |
| 代码编辑器 | CodeMirror 6 |
| 差异查看器 | diff (npm 包) |
| 图标 | Lucide React |

## 项目结构

```
frontend/
├── src/
│   ├── assets/            # 静态资源
│   ├── components/        # 组件
│   │   ├── ui/            # ShadCN UI 组件
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   └── ...
│   │   ├── ClusterManager.tsx      # 集群管理组件
│   │   ├── ClusterStatusCard.tsx   # 集群状态卡片
│   │   ├── SplitDiff.tsx           # 分屏差异查看器
│   │   ├── WatchPanel.tsx          # 实时监控面板
│   │   └── WordDiff.tsx            # 文本差异对比组件
│   ├── hooks/             # 自定义 Hooks
│   │   └── use-toast.ts   # Toast 通知 Hook
│   ├── lib/               # 工具函数
│   │   └── utils.ts
│   ├── services/          # API 服务层
│   │   ├── cluster.ts     # 集群服务
│   │   ├── etcd.ts        # etcd 操作服务
│   │   └── etcd.test.ts   # 测试文件
│   ├── App.css
│   ├── App.tsx            # 主应用组件
│   ├── index.css
│   └── main.tsx           # 入口文件
├── public/                # 静态资源
├── types/                 # TypeScript 类型定义
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── eslint.config.js
```

## 重要说明

### 仅静态构建

本前端设计为**由 Go 后端构建并提供服务**，无法独立运行，原因如下：

1. **API 依赖**：所有 API 调用都指向 `/api/*` 端点，由 Go 后端提供
2. **无模拟服务器**：没有独立的 API 服务器或模拟数据层
3. **后端集成**：Go 后端从 `frontend/dist/` 目录提供静态文件

### 开发与生产模式

| 模式 | 命令 | API 来源 |
|------|------|----------|
| 开发 | `npm run dev` | 需要运行 Go 后端在 :8080 |
| 生产 | `npm run build` | 静态文件由 Go 后端提供 |

## 开发

### 前置条件

1. 启动 Go 后端（提供 API 和静态文件服务）：
   ```bash
   cd ../backend
   go run main.go --config config.yaml
   ```

2. 启动前端开发服务器：
   ```bash
   npm install
   npm run dev
   ```

3. 打开 http://localhost:5173（前端）→ API 调用会代理到 localhost:8080（后端）

### 生产构建

```bash
npm run build
```

构建输出将写入 `dist/` 目录，由 Go 后端提供服务。

### 可用脚本

| 脚本 | 描述 |
|------|------|
| `npm run dev` | 在 :5173 启动开发服务器 |
| `npm run build` | 构建生产版本到 `dist/` |
| `npm run preview` | 本地预览生产构建 |
| `npm run lint` | 运行 ESLint 检查 |
| `npm run test` | 使用 Vitest 运行测试 |

## 核心组件

### WordDiff

`WordDiff` 组件提供文本级别的差异对比，用于版本历史查看：

```tsx
import { WordDiff } from '@/components/WordDiff'

<WordDiff
  oldValue={leftHistory.value}
  newValue={rightHistory.value}
/>
```

- 使用 `diff` npm 包的 `diffWords` 函数
- 绿色高亮表示新增内容
- 红色删除线表示删除内容
- 支持通过 Tailwind 类实现暗色/亮色主题

### SplitDiff

`SplitDiff` 组件提供分屏式差异对比视图，支持左右两侧对比不同版本的内容。

### API 服务层

所有 API 调用通过 `src/services/etcd.ts` 进行：

```typescript
import { etcdApi } from '@/services/etcd'

// 示例用法
const keys = await etcdApi.getKeys('/', 100)
```

## 样式

- **Tailwind CSS**：基于工具类的 CSS 框架
- **ShadCN UI**：基于 Radix UI 构建的可复用组件库
- **暗色模式**：通过 Tailwind 的 `dark:` 前缀和 CSS 变量支持
- **CSS 变量**：在 CSS 中定义用于主题定制

## 依赖

### 生产依赖

- `@codemirror/lang-json` - JSON 语法高亮
- `@codemirror/lang-yaml` - YAML 语法高亮
- `@radix-ui/react-*` - UI 组件基础库
- `@uiw/react-codemirror` - CodeMirror 包装组件
- `class-variance-authority` - CSS 类变体管理
- `clsx` - 类名工具函数
- `diff` - 文本差异算法
- `lucide-react` - 图标库
- `react / react-dom` - React 框架
- `tailwind-merge` - Tailwind 类合并工具
- `tailwindcss-animate` - Tailwind 动画效果

### 开发依赖

- `typescript` - 类型检查
- `vite` - 构建工具
- `eslint` - 代码检查
- `tailwindcss` - CSS 框架
- `vitest` - 测试框架
- `postcss` - CSS 处理工具
- `autoprefixer` - CSS 前缀自动添加