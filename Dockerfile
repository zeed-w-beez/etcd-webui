# 第一阶段：构建前端
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# 第二阶段：构建后端
FROM golang:1.22-alpine AS backend-builder

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
