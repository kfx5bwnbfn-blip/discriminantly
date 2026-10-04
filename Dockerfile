FROM node:22-alpine
WORKDIR /app
# v2.67: one runtime dependency (sharp, for image renditions). Installed in its
# own layer so it is cached between deploys; npm picks the Alpine (musl) build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/discriminantly.db
EXPOSE 3000
CMD ["node","--no-warnings","server.js"]
