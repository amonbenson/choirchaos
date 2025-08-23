# Stage 1: Build the Vite app
FROM node:slim AS builder

ARG VITE_BASE_URL=${VITE_BASE_URL}
ARG VITE_PB_URL=${VITE_PB_URL}
ARG VITE_PB_AUTOLOGIN_EMAIL=${VITE_PB_AUTOLOGIN_EMAIL}
ARG VITE_PB_AUTOLOGIN_PASS=${VITE_PB_AUTOLOGIN_PASS}
ARG VITE_PB_AUTOLOGIN_SHOW=${VITE_PB_AUTOLOGIN_SHOW}
ARG VITE_PB_AUTOLOGIN_SONG=${VITE_PB_AUTOLOGIN_SONG}

WORKDIR /app

# Install dependencies
COPY package*.json .
RUN npm install

# Build the application
COPY . .
RUN npm run build

# Stage 2: Run nginx as a static file server
FROM nginx:alpine-slim

# Copy static files
COPY --from=builder /app/dist /usr/share/nginx/html

# Replace default nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf
