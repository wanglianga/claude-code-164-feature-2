# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先拷依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json* ./
# 使用项目内缓存目录，规避全局 npm 缓存的 root 属主问题
RUN npm ci --cache /tmp/npm-cache || npm install --cache /tmp/npm-cache

# 拷贝源码并构建（vue-tsc 类型检查 + vite 产物到 dist/）
COPY . .
RUN npm run build

# ---- 运行阶段：nginx 提供静态文件 ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
