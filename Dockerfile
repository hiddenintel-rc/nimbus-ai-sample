# Image for the self-hosted deployment. The Vercel deployment doesn't use this.
#
# Build (the client ID must be passed here, not at run time — see below):
#   docker build --build-arg NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID=<client-id> -t nimbus .

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the browser bundle during `next build`,
# so this has to be set here. Passing it only at `docker run` leaves the client
# SDK disabled with no error — the live Memory badge and logo swap would simply
# never respond to flag changes, while server-side flags kept working.
ARG NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID
ENV NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID=$NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
