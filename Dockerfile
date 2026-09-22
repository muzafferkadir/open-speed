# Build the static site, then hand it to nginx. Vite writes to build/dist (see vite.config.ts).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build/dist /usr/share/nginx/html
EXPOSE 80
