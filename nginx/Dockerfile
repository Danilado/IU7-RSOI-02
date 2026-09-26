FROM node:20-alpine AS gateway-build
WORKDIR /app
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci
COPY gateway/tsconfig.json ./tsconfig.json
COPY gateway/src ./src
RUN npm run build && npm prune --omit=dev

FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
WORKDIR /app
COPY --from=gateway-build /app/node_modules ./node_modules
COPY --from=gateway-build /app/dist ./dist
COPY nginx/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["sh", "-c", "node /app/dist/index.js & exec nginx -g 'daemon off;'" ]
