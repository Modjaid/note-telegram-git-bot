# NoteAgent runtime image (gateway + agent worker). Built by host CLI (P1-T06).
FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json LLmModels.json ./
COPY dist/config ./dist/config
COPY dist/paths ./dist/paths
COPY dist/git ./dist/git
COPY dist/messenger ./dist/messenger
COPY dist/runtime ./dist/runtime
COPY docker/entrypoint.mjs ./docker/entrypoint.mjs

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3711/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "/app/docker/entrypoint.mjs"]
