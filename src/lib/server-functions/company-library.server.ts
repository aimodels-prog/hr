import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  libraryList,
  libraryUpload,
  libraryDownload,
  libraryPrepare,
  libraryPages,
  libraryPublish,
  libraryWithdraw,
  libraryAsk,
} from "../db/repositories/company-library.repository.server.ts";
import { Pages } from "../integrations/policy-ai.server.ts";
const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const org = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(org, actor.actorId, undefined, actor.actorEmail);
  if (!result.verified || !result.actor?.userId || !result.actor.roles.includes(actor.activeRole))
    throw new Error("Sign in with an authorised VIA account.");
  return { org, actor: { ...result.actor, activeRole: actor.activeRole } };
}
export const getCompanyLibraryFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryList(v.org, v.actor);
  });
export const uploadCompanyDocumentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        title: z.string().trim().min(3).max(200),
        category: z.string().trim().min(2).max(100),
        kind: z.enum(["Library", "Company"]),
        audience: z.enum(["All staff", "HR only"]),
        familyId: z.string().uuid().optional(),
        issueDate: z.string().date().optional(),
        expiryDate: z.string().date().optional(),
        name: z.string().min(1).max(255),
        bytes: z
          .array(z.number().int().min(0).max(255))
          .min(5)
          .max(10 * 1024 * 1024),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryUpload(v.org, { ...data, bytes: Uint8Array.from(data.bytes) }, v.actor);
  });
const Doc = z.object({ actor: Actor, id: z.string().uuid() }).strict();
export const downloadCompanyDocumentFn = createServerFn({ method: "GET" })
  .validator((input) => Doc.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const file = await libraryDownload(v.org, data.id, v.actor);
    return { name: file.metadata.name, bytes: Array.from(file.bytes) };
  });
export const prepareCompanyDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => Doc.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryPrepare(v.org, data.id, v.actor);
  });
export const getCompanyDocumentPagesFn = createServerFn({ method: "GET" })
  .validator((input) => Doc.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryPages(v.org, data.id, v.actor);
  });
export const publishCompanyDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => Doc.extend({ pages: Pages.optional() }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryPublish(v.org, data.id, v.actor, data.pages);
  });
export const withdrawCompanyDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => Doc.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryWithdraw(v.org, data.id, v.actor);
  });
export const askCompanyPoliciesFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, question: z.string().trim().min(5).max(2000) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return libraryAsk(v.org, data.question, v.actor);
  });
