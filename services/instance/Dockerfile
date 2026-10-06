# mise.toml の go と揃える（CI で一致を検証する）
ARG GO_VERSION=1.27.1
FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go vet ./... && go test ./...
RUN CGO_ENABLED=0 go build -trimpath -o /instance ./cmd/instance
FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /instance /usr/local/bin/ubichill-instance
USER 65532:65532
EXPOSE 3002
ENTRYPOINT ["ubichill-instance", "--listen=:3002"]
