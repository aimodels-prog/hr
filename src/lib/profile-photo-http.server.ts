import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getPortalPrincipalForRequest } from "./auth/portal-auth-http.server.ts";
import { getDatabaseClient } from "./db/client.ts";
import { employees } from "./db/schema/employee.ts";
import { employeeProfilePhotos } from "./db/schema/profile-photos.ts";
import { auditEvents } from "./db/schema/system.ts";
import { saveObjectFile, readObjectFile, deleteObjectFile } from "./db/object-storage.server.ts";
import {
  canChangeProfilePhoto,
  profilePhotoMime,
  MAX_PROFILE_PHOTO_BYTES,
} from "./profile-photo.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
export async function resolveProfilePhotoRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/employee-photo") return undefined;
  const principal = await getPortalPrincipalForRequest(request);
  if (!principal) return new Response(null, { status: 401, headers });
  const parsed = z.string().uuid().safeParse(url.searchParams.get("employeeId"));
  if (!parsed.success) return new Response(null, { status: 400, headers });
  const employeeId = parsed.data;
  const organisationId = principal.organisationId;
  const db = getDatabaseClient();
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organisationId, organisationId),
        isNull(employees.archivedAt),
      ),
    );
  if (!employee) return new Response(null, { status: 404, headers });
  const actor = {
    userId: principal.user.id,
    employeeId: principal.employee.id,
    displayName: principal.user.displayName,
    activeRole: principal.user.roles.includes("HR")
      ? ("HR" as const)
      : principal.user.roles.includes("Super Admin")
        ? ("Super Admin" as const)
        : ("Employee" as const),
    roles: principal.user.roles,
  };
  try {
    if (request.method === "GET") {
      const [photo] = await db
        .select()
        .from(employeeProfilePhotos)
        .where(
          and(
            eq(employeeProfilePhotos.employeeId, employeeId),
            eq(employeeProfilePhotos.organisationId, organisationId),
          ),
        );
      if (!photo) return new Response(null, { status: 404, headers });
      const file = await readObjectFile(
        organisationId,
        photo.fileId,
        actor,
        "View colleague profile photo",
        "Low",
      );
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          ...headers,
          "content-type": file.metadata.mimeType,
          "content-disposition": "inline",
        },
      });
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers });
    const origin = process.env["APP_ORIGIN"];
    if (
      !origin ||
      request.headers.get("origin") !== new URL(origin).origin ||
      !canChangeProfilePhoto(principal.employee.id, employeeId, principal.user.roles)
    )
      return new Response(null, { status: 403, headers });
    if (Number(request.headers.get("content-length")) > MAX_PROFILE_PHOTO_BYTES + 20_000)
      return Response.json(
        { error: "Choose a photo smaller than 5 MB." },
        { status: 413, headers },
      );
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_PROFILE_PHOTO_BYTES + 20_000) {
        await reader.cancel();
        return Response.json(
          { error: "Choose a photo smaller than 5 MB." },
          { status: 413, headers },
        );
      }
      chunks.push(part.value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size > MAX_PROFILE_PHOTO_BYTES)
      return Response.json(
        { error: "Choose a JPG or PNG photo smaller than 5 MB." },
        { status: 400, headers },
      );
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const mimeType = profilePhotoMime(bytes);
    const fileId = randomUUID();
    await saveObjectFile({
      id: fileId,
      organisationId,
      bytes,
      name: `profile.${mimeType === "image/png" ? "png" : "jpg"}`,
      mimeType,
      owner: { entityType: "employee-profile-photo", entityId: employeeId },
      actor,
    });
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(employeeProfilePhotos)
          .values({ employeeId, organisationId, fileId })
          .onConflictDoUpdate({
            target: employeeProfilePhotos.employeeId,
            set: { fileId, updatedAt: new Date() },
          });
        await tx.insert(auditEvents).values({
          organisationId,
          actorUserId: actor.userId,
          actorEmployeeId: actor.employeeId,
          actorDisplayName: actor.displayName,
          activeRole: actor.activeRole,
          actorRoles: actor.roles,
          action: "update",
          module: "core-hr",
          entityType: "employee-profile-photo",
          entityId: employeeId,
          afterSummary: { fileId },
          reason: "Updated profile photo",
          riskLevel: "Low",
        });
      });
    } catch (error) {
      await deleteObjectFile(
        organisationId,
        fileId,
        actor,
        "Removed unattached photo after save failed",
      ).catch(() => undefined);
      throw error;
    }
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "The photo could not be saved or loaded. Please try again." },
      { status: 503, headers },
    );
  }
}
