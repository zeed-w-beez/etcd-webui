# 第一阶段：构建前端
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# 复制 package.json
COPY frontend/package.json ./

# 安装依赖
RUN npm install --no-audit --no-fund

# 复制前端源代码
COPY frontend/ .
RUN npm run build

# 第二阶段：构建后端
FROM golang:1.24-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN go build -o etcd-webui-server main.go

# 第三阶段：最终镜像
FROM alpine:3

WORKDIR /app

# 安装必要的依赖
RUN apk --no-cache add ca-certificates

# 从前端构建阶段复制静态文件
COPY --from=frontend-builder /app/frontend/dist ./dist

# 从后端构建阶段复制可执行文件
COPY --from=backend-builder /app/backend/etcd-webui-server ./

# 复制配置文件
COPY backend/config.yaml ./backend/config.yaml

# 暴露端口
EXPOSE 8080

# 运行应用
CMD ["./etcd-webui-server", "--config", "./backend/config.yaml"]
