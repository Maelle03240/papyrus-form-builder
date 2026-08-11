# =============================================================================
# Papyrus — image de production pour Easypanel
#
# Build multi-étapes sur la sortie `standalone` de Next.js : l'image finale ne
# contient que le serveur compilé et les dépendances réellement utilisées.
#
# Les variables NEXT_PUBLIC_* sont inlinées dans le bundle navigateur AU MOMENT
# DU BUILD : elles doivent donc être passées en `--build-arg`, pas seulement à
# l'exécution. Easypanel les transmet automatiquement depuis l'onglet
# Environment si elles sont déclarées comme ARG ici.
# =============================================================================

FROM node:20-alpine AS base
# libc6-compat : requis par certaines dépendances natives sur Alpine.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---------- Dépendances ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Build ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_R2_PUBLIC_BASE_URL

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_R2_PUBLIC_BASE_URL=$NEXT_PUBLIC_R2_PUBLIC_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- Exécution ----------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Port par défaut en local. En production, Easypanel injecte PORT=80 : rien ici
# ne doit donc supposer 3000 — surtout pas la sonde de vie ci-dessous.
ENV PORT=3000

# Le serveur ne tourne pas en root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# pdf-parse charge son worker depuis node_modules à l'exécution : la trace
# `standalone` ne l'embarque pas, il faut le copier explicitement.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdfjs-dist/legacy/build ./node_modules/pdfjs-dist/legacy/build

USER nextjs
EXPOSE 3000

# Sonde de VIE, pas de disponibilité.
#
# Elle vérifie uniquement que le serveur HTTP répond, sur le port réellement
# utilisé (`$PORT`, injecté par l'orchestrateur). Deux erreurs à ne pas refaire :
#
#  · coder le port en dur — la sonde interrogeait 3000 alors que le conteneur
#    écoutait sur 80, échouait systématiquement, et Swarm arrêtait la tâche ;
#  · exiger un 200 — /api/health renvoie 503 quand Supabase ou R2 est en panne.
#    Une base momentanément indisponible ferait alors tuer et redémarrer
#    l'application en boucle, alors qu'elle doit rester debout et signaler l'état.
#
# La surveillance des dépendances revient à Uptime Kuma, qui alerte sur le 503
# sans rien redémarrer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/api/health').then(()=>process.exit(0)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
