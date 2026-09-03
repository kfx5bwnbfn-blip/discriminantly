FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/discriminantly.db
EXPOSE 3000
CMD ["node","--no-warnings","server.js"]
