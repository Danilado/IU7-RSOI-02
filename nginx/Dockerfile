FROM node:20-alpine AS gateway
WORKDIR /app
COPY gateway/package.json ./package.json
RUN npm install --omit=dev
COPY gateway/index.js ./index.js
COPY shared/rules.js ./rules.js
FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
COPY --from=gateway /app /app
COPY nginx/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["sh", "-c", "node /app/index.js & exec nginx -g 'daemon off;'" ]
