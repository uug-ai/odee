FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26.10-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOWORK=off go build -trimpath -ldflags="-s -w" -o /odee ./cmd/odee

FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata poppler-utils tesseract-ocr \
      tesseract-ocr-data-eng tesseract-ocr-data-nld tesseract-ocr-data-fra \
    && addgroup -g 10001 odee \
    && adduser -D -u 10001 -G odee odee \
    && mkdir -p /app/web/dist \
    && chown odee:odee /app
WORKDIR /app
COPY --from=server /odee /usr/local/bin/odee
COPY --from=web /src/web/dist /app/web/dist
USER 10001:10001
ENV ODEE_ADDR=:8098 ODEE_WEB_DIR=/app/web/dist ODEE_AUTH_MODE=github ODEE_DEV_MODE=false ODEE_DEMO=false
EXPOSE 8098
ENTRYPOINT ["/usr/local/bin/odee"]
