#!/usr/bin/env bash
# Isolated CI services only. Never use this script against production containers.
set -euo pipefail

: "${VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID:?CI object-storage access key required}"
: "${VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY:?CI object-storage secret required}"
minio_port="${VIA_HR_CI_MINIO_PORT:-9000}"
cv_port="${VIA_HR_CI_CV_PORT:-8080}"

# Same release as production, fetched from the upstream registry rather than the
# now-unavailable Docker Hub repository. Pin the verified multi-platform digest.
minio_image='quay.io/minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0'

diagnostics() {
  for name in via-hr-ci-minio via-hr-ci-cv-processor; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      docker inspect --format '{{json .State}}' "$name"
      docker logs --tail 100 "$name" 2>&1
    fi
  done
}
trap diagnostics ERR

pull_ok=false
for attempt in 1 2 3; do
  if docker pull "$minio_image"; then pull_ok=true; break; fi
  echo "MinIO image pull failed (attempt $attempt/3)."
  if [ "$attempt" -lt 3 ]; then sleep 5; fi
done
if [ "$pull_ok" != true ]; then
  echo 'Unable to pull the pinned MinIO image; integration tests cannot run.' >&2
  exit 1
fi

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
