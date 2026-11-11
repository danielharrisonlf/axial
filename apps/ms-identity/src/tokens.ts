import { readFile } from "node:fs/promises";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

export const issuer = process.env.IDENTITY_ISSUER ?? "http://localhost:3000/identity";
export const audience = process.env.IDENTITY_AUDIENCE ?? "axial-projects";
const passwordChangeAudience = `${audience}-password-change`;

export interface AccessClaims {
  userId: string;
  organizationId: string;
  role: "ADMIN" | "PROJECT_MANAGER" | "TEAM_LEAD" | "CONTRIBUTOR" | "VIEWER";
  teamIds: string[];
  projectIds: string[];
  assignableUserIds: string[];
  assignableTeamIds: string[];
  source: "api" | "ui" | "mcp" | "automation";
}

const claimsSchema = z
  .object({
    sub: z.uuid(),
    organizationId: z.uuid(),
    role: z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]).optional(),
    teamIds: z.array(z.uuid()).default([]),
    projectIds: z.array(z.uuid()).default([]),
    assignableUserIds: z.array(z.uuid()).default([]),
    assignableTeamIds: z.array(z.uuid()).default([]),
    source: z.enum(["api", "ui", "mcp", "automation"]).default("api"),
    purpose: z.string().optional(),
  })
  .passthrough();

export async function loadKeys(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const privatePath = process.env.IDENTITY_PRIVATE_KEY_PATH;
  const publicPath = process.env.IDENTITY_PUBLIC_KEY_PATH;
  if (!privatePath || !publicPath)
    throw new Error("IDENTITY_PRIVATE_KEY_PATH and IDENTITY_PUBLIC_KEY_PATH are required");
  const privateKey = await importPKCS8(await readFile(privatePath, "utf8"), "RS256");
  const publicKey = await importSPKI(await readFile(publicPath, "utf8"), "RS256");
  const probe = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(privateKey);
  await jwtVerify(probe, publicKey, { algorithms: ["RS256"] });
  return { privateKey, publicKey };
}

export async function signAccessToken(privateKey: CryptoKey, claims: AccessClaims): Promise<string> {
  return new SignJWT({
    organizationId: claims.organizationId,
    role: claims.role,
    teamIds: claims.teamIds,
    projectIds: claims.projectIds,
    assignableUserIds: claims.assignableUserIds,
    assignableTeamIds: claims.assignableTeamIds,
    source: claims.source,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export async function signPasswordChangeToken(
  privateKey: CryptoKey,
  userId: string,
  organizationId: string,
): Promise<string> {
  return new SignJWT({ organizationId, purpose: "password_change" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(passwordChangeAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export async function verifyAccessToken(
  publicKey: CryptoKey,
  token: string,
  options: { passwordChange?: boolean } = {},
): Promise<z.infer<typeof claimsSchema>> {
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    issuer,
    audience: options.passwordChange ? [audience, passwordChangeAudience] : audience,
    requiredClaims: ["sub", "iat", "exp"],
  });
  return claimsSchema.parse(payload);
}

export function isPasswordChangeToken(payload: { aud?: unknown; purpose?: unknown }): boolean {
  return payload.aud === passwordChangeAudience || payload.purpose === "password_change";
}
