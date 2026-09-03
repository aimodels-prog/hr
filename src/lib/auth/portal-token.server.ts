import "@tanstack/react-start/server-only";

import { jwtVerify, type JWTPayload } from "jose";

import {
  getPortalSsoSecret,
  loadPortalSsoConfig,
  type PortalSsoConfig,
} from "./portal-sso-config.server.ts";
import type { Role } from "../data/types.ts";

export interface VerifiedPortalIdentity {
  email: string;
  name: string;
  portalRole: string;
  mappedRole: Role;
  expiresAt: number;
}

export class PortalTokenError extends Error {
  constructor(message = "The portal sign-in link is invalid or has expired.") {
    super(message);
    this.name = "PortalTokenError";
  }
}

/** Portal roles may establish only the baseline employee role. Elevated HR roles remain local. */
export function mapPortalRole(role: unknown): Role {
  if (typeof role !== "string") return "Employee";
  const normalized = role.trim().toLowerCase();
  if (normalized === "user" || normalized === "employee") return "Employee";
  return "Employee";
}

function textClaim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || !value.trim()) throw new PortalTokenError();
  return value.trim();
}

export async function verifyPortalToken(
  token: string,
  options?: { config?: PortalSsoConfig; nowSeconds?: number },
): Promise<VerifiedPortalIdentity> {
  if (!token || token.length > 16_384) throw new PortalTokenError();
  const config = options?.config ?? loadPortalSsoConfig();
  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);

  try {
    const result = await jwtVerify(token, getPortalSsoSecret(), {
      algorithms: ["HS256"],
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: 5,
      currentDate: new Date(nowSeconds * 1000),
      requiredClaims: ["exp"],
    });
    const payload = result.payload;
    if (payload["appSlug"] !== config.appSlug) throw new PortalTokenError();
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds - 5) {
      throw new PortalTokenError();
    }
    if (payload.exp > nowSeconds + config.tokenLifetimeSeconds + 5) {
      throw new PortalTokenError();
    }

    const email = textClaim(payload, "email").toLowerCase();
    const domainSuffix = `@${config.allowedEmailDomain}`;
    if (!email.endsWith(domainSuffix) || email.length <= domainSuffix.length) {
      throw new PortalTokenError();
    }
    const name = textClaim(payload, "name");
    const portalRole = textClaim(payload, "role");
    return {
      email,
      name,
      portalRole,
      mappedRole: mapPortalRole(portalRole),
      expiresAt: payload.exp,
    };
  } catch (error) {
    if (error instanceof PortalTokenError) throw error;
    throw new PortalTokenError();
  }
}
