#!/usr/bin/env bash
# Isolated CI services only. Never use this script against production containers.
set -euo pipefail

: "${VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID:?CI object-storage access key required}"
: "${VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY:?CI object-storage secret required}"
minio_port="${VIA_HR_CI_MINIO_PORT:-9000}"
cv_port="${VIA_HR_CI_CV_PORT:-8080}"

# Same release as production, built from a pinned upstream commit. No dependency
# on the former anonymous MinIO binary registries. Production is unaffected.
minio_image='via-hr-ci-minio:7ced966'

diagnostics() {
  for name in via-hr-ci-minio via-hr-ci-cv-processor; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      docker inspect --format '{{json .State}}' "$name"
      docker logs --tail 100 "$name" 2>&1
    fi
  done
}
trap diagnostics ERR

docker build --tag "$minio_image" scripts/ci-minio

export MINIO_ROOT_USER="$VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID"
export MINIO_ROOT_PASSWORD="$VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY"
docker run --detach --name via-hr-ci-minio --label via-hr.ci=true \
  --publish "127.0.0.1:$minio_port:9000" \
  --env MINIO_ROOT_USER --env MINIO_ROOT_PASSWORD "$minio_image" server /data

wait_ready() {
  local name="$1" endpoint="$2"
  for attempt in {1..60}; do
    if curl --fail --silent --show-error --max-time 3 "$endpoint" >/dev/null 2>&1; then
      echo "$name is ready."
      return 0
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]; then
      echo "$name exited before readiness." >&2
      return 1
    fi
    sleep 2
  done
  echo "$name did not become ready within the startup deadline." >&2
  return 1
}
wait_ready via-hr-ci-minio "http://127.0.0.1:$minio_port/minio/health/ready"

docker build --tag via-hr-ci-cv-processor:local services/cv-processor
docker run --detach --name via-hr-ci-cv-processor --label via-hr.ci=true \
  --publish "127.0.0.1:$cv_port:8080" via-hr-ci-cv-processor:local
wait_ready via-hr-ci-cv-processor "http://127.0.0.1:$cv_port/health"
