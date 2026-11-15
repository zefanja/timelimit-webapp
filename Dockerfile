# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- serve ---
FROM nginx:1.27-alpine
ENV TIMELIMIT_UPSTREAM=http://timelimit:8080
# only substitute our variable, nginx variables like $host stay untouched
ENV NGINX_ENVSUBST_FILTER=TIMELIMIT_UPSTREAM
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
