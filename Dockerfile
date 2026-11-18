FROM node:22-bookworm-slim

ARG VERSION=dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="pi-share-history" \
      org.opencontainers.image.description="Persistent, live Pi session sharing for a team" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION" \
      org.opencontainers.image.source="https://github.com/thoraxe/pi-share-history"

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=9080 DATA_DIR=/data
EXPOSE 9080
CMD ["node", "server/index.mjs"]
