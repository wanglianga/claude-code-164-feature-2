# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# 先拷依赖清单，充分利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷贝源码并执行类型检查 + 生产构建
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---------- 运行阶段：nginx 托管静态 SPA ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
