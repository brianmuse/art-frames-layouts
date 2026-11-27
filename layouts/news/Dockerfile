FROM node:24-slim AS build
ENV ASTRO_TELEMETRY_DISABLED=1
WORKDIR /website
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY public ./public
COPY astro.config.mjs tsconfig.json ./
RUN npm run build
FROM node:24-slim
# Host protocol name: keep 'dayframe' (see the host repo's names.py).
ENV NODE_ENV=production ASTRO_TELEMETRY_DISABLED=1 DAYFRAME_SITE_CONFIG=/site-config/config.json DAYFRAME_SITE_STATE=/site-state
WORKDIR /website
COPY --from=build /website/dist ./dist
COPY --from=build /website/node_modules ./node_modules
COPY package.json server.mjs layout.json ./
# dist imports #server/* (package.json "imports") unbundled from src/server.
# The dev sample module reads src/fixtures; production never uses it.
COPY src/server ./src/server
COPY src/fixtures ./src/fixtures
# An empty named volume takes the owner and mode of the folder it covers. The install file
# gives each layout named volumes for /site-config and /site-state, so both belong to 10001.
RUN mkdir -p /run/dayframe-site /site-config /site-state && chown 10001:10001 /run/dayframe-site /site-config /site-state && chmod 770 /run/dayframe-site && chmod 700 /site-config /site-state
USER 10001:10001
# ulimit -u counts every process and thread of this user ID on the whole host, including
# the other Art Frames containers, so 64 could stop Node from starting. 4096 is a host-wide
# ceiling for this user ID, not a per-container limit.
# Art Frames reads this copy of layout.json in the socket folder when it runs from its install file.
CMD ["bash", "-e", "-c", "ulimit -u 4096; ulimit -c 0; cp layout.json /run/dayframe-site/layout.json; exec node --max-old-space-size=192 server.mjs"]
