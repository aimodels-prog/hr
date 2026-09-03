import assert from "node:assert/strict";
import test from "node:test";

import { expectedRequestOrigin, resolveAppSurfaceRequest } from "../src/lib/app-surface.server.ts";

const baseEnvironment = {
  APP_ORIGIN: "https://hr.via-int.com",
  VIA_HR_CAREERS_ORIGIN: "https://careers.via-int.com",
} as const;

async function withSurface<T>(surface: "careers" | "staff", operation: () => T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries({ ...baseEnvironment, VIA_HR_APP_SURFACE: surface })) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return operation();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("careers surface serves only public recruitment and sends staff browsers to HR", async () => {
  await withSurface("careers", () => {
    assert.equal(
      resolveAppSurfaceRequest(new Request("https://careers.via-int.com/jobs/example")),
      undefined,
    );
    assert.equal(
      resolveAppSurfaceRequest(new Request("https://careers.via-int.com/api/public/vacancies")),
      undefined,
    );
    const staff = resolveAppSurfaceRequest(
      new Request("https://careers.via-int.com/staff/me/profile?tab=personal"),
    );
    assert.equal(staff?.status, 308);
    assert.equal(
      staff?.headers.get("location"),
      "https://hr.via-int.com/staff/me/profile?tab=personal",
    );
    const privateApi = resolveAppSurfaceRequest(
      new Request("https://careers.via-int.com/api/private", {
        headers: { accept: "application/json" },
      }),
    );
    assert.equal(privateApi?.status, 404);
  });
});

test("staff surface refuses public APIs and sends public pages to careers", async () => {
  await withSurface("staff", () => {
    const careers = resolveAppSurfaceRequest(
      new Request("https://hr.via-int.com/jobs/example?source=portal"),
    );
    assert.equal(careers?.status, 308);
    assert.equal(
      careers?.headers.get("location"),
      "https://careers.via-int.com/jobs/example?source=portal",
    );
    const publicApi = resolveAppSurfaceRequest(
      new Request("https://hr.via-int.com/api/public/vacancies"),
    );
    assert.equal(publicApi?.status, 404);
    assert.equal(
      resolveAppSurfaceRequest(new Request("https://hr.via-int.com/auth/portal/callback")),
      undefined,
    );
    assert.equal(resolveAppSurfaceRequest(new Request("https://hr.via-int.com/staff")), undefined);
  });
});

test("each surface rejects the other hostname and uses its own mutation origin", async () => {
  await withSurface("careers", () => {
    assert.equal(
      resolveAppSurfaceRequest(new Request("https://hr.via-int.com/jobs/example"))?.status,
      404,
    );
    assert.equal(
      expectedRequestOrigin(new Request("https://careers.via-int.com/api/public/applications")),
      "https://careers.via-int.com",
    );
  });
  await withSurface("staff", () => {
    assert.equal(
      resolveAppSurfaceRequest(new Request("https://careers.via-int.com/staff"))?.status,
      404,
    );
    assert.equal(
      expectedRequestOrigin(new Request("https://hr.via-int.com/_serverFn/action")),
      "https://hr.via-int.com",
    );
  });
});

test("health checks and immutable assets remain available on both containers", async () => {
  for (const surface of ["careers", "staff"] as const) {
    await withSurface(surface, () => {
      assert.equal(
        resolveAppSurfaceRequest(new Request("http://127.0.0.1:3000/health/ready")),
        undefined,
      );
      assert.equal(
        resolveAppSurfaceRequest(new Request("http://127.0.0.1:3000/assets/app.js")),
        undefined,
      );
    });
  }
});

test("reviewed reverse-proxy protocol is accepted without weakening hostname checks", async () => {
  const previousTrust = process.env["VIA_HR_TRUST_PROXY"];
  process.env["VIA_HR_TRUST_PROXY"] = "true";
  try {
    await withSurface("careers", () => {
      assert.equal(
        resolveAppSurfaceRequest(
          new Request("http://careers.via-int.com/jobs/example", {
            headers: { "x-forwarded-proto": "https" },
          }),
        ),
        undefined,
      );
      assert.equal(
        resolveAppSurfaceRequest(
          new Request("http://hr.via-int.com/jobs/example", {
            headers: { "x-forwarded-proto": "https" },
          }),
        )?.status,
        404,
      );
    });
  } finally {
    if (previousTrust === undefined) delete process.env["VIA_HR_TRUST_PROXY"];
    else process.env["VIA_HR_TRUST_PROXY"] = previousTrust;
  }
});
