# One Linux image for the same-rules comparison (README "Rust (oxc) vs Go vs JS"): the official rust
# image with Node and Go copied in from their official images, so all three variants run on the same
# kernel, CPU allotment and file system. Tags are pinned here; the digests used are in the README.
FROM node:24-bookworm-slim AS node
FROM golang:1.24-bookworm AS go
FROM rust:1-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH \
    CARGO_HOME=/cache/cargo CARGO_TARGET_DIR=/cache/target GOMODCACHE=/cache/gomod GOCACHE=/cache/gobuild \
    GOFLAGS=-modcacherw npm_config_cache=/cache/npm
WORKDIR /work
