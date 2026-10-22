# The app in a container: `bun start`, on the Bun package.json's packageManager names (keep the two
# in step). Production sets DATABASE_URL: PGlite is for development and the tests. The environment,
# the database and the platforms: the dzql-app skill's reference/deploy.md.
FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production

# the dependencies first, so a change to the app's code alone reuses this layer; no scripts (prepare
# installs the skills, which a server has no use for)
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

COPY . .

# the server runs as bun, not root, and the app's folder is not its to write: the pid file goes to /tmp
ENV PID_FILE=/tmp/server.pid
USER bun
EXPOSE 3000
CMD ["bun", "start"]
