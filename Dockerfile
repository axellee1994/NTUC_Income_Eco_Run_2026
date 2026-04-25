FROM node:22-alpine

WORKDIR /app

COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 3001

CMD ["node", "backend/server.js"]
