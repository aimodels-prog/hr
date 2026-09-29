# CI only: build the production MinIO release from its immutable upstream commit.
# The former public binary registries no longer allow anonymous pulls.
FROM golang:1.24.6-bookworm@sha256:ab1d1823abb55a9504d2e3e003b75b36dbeb1cbcc4c92593d85a84ee46becc6c AS build
WORKDIR /src
RUN git init . && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth 1 origin 7ced9663e6a791fef9dc6be798ff24cda9c730ac \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 7ced9663e6a791fef9dc6be798ff24cda9c730ac
RUN CGO_ENABLED=0 GOMAXPROCS=2 go build -mod=readonly -p 2 -trimpath -o /minio .

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
COPY --from=build /minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /usr/share/licenses/minio/LICENSE
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN mkdir /data && chown 10001:10001 /data
USER 10001:10001
EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data"]
