FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist

ENV NODE_ENV=production
ENV PORT=8088
ENV HOST=0.0.0.0

EXPOSE 8088

CMD ["node", "dist/index.js"]
