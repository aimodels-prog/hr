# Release exception — 18 November 2026

Release: application and worker image `926b38f` (plus a workflow-only CI change in `fcb46de5`).

The owner explicitly authorised this release despite the failing dependency-security check. The unresolved advisory is [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), affecting `picomatch` in the background-worker dependency tree; no patched upstream version was available at release time. This is a one-release exception, not a declaration that the dependency is safe or that future releases may bypass security checks.

The owner also authorised a verified encrypted PostgreSQL and object-storage backup held only on the same Contabo VPS because off-server backup storage is not configured. Loss of that VPS may lose both production data and this backup. Do not treat the on-server copy as disaster recovery.

No database migrations are included in this release. The production switch must occur only after the independent PostgreSQL/object-storage and browser journeys pass, a verified backup exists, the previously running images remain available for rollback, and the new public and worker health checks succeed. If any non-excepted check fails, stop or roll back.

Follow-up: install an upstream fix for `picomatch` when available, restore a fully passing security gate, and configure/verify an off-server backup target.
