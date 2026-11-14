# Sokoni — one container, one instance (the JSON data store is not multi-server). Mount a persistent volume at /data.
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 SOKONI_DATA_DIR=/data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
