import { jwtVerify, SignJWT } from "jose";

export const DEV_JWT_SECRET = "default_dev_secret";

/**
 * Resolve the JWT signing secret, failing closed in production.
 *
 * A hardcoded default secret is catastrophic: anyone can forge a token for any
 * user_id and impersonate any account. So in production (NODE_ENV=production) we
 * refuse to start unless JWT_SECRET is set to something other than the dev
 * default. Outside production we fall back to the dev secret with a loud warning
 * so local development and tests still work.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET;
  const isProd = env.NODE_ENV === "production";

  if (!secret || secret === DEV_JWT_SECRET) {
    if (isProd) {
      throw new Error(
        "JWT_SECRET must be set to a strong, unique value in production; " +
          "refusing to start with a missing or default development secret.",
      );
    }
    console.warn(
      "[dzql] JWT_SECRET is not set; using an insecure development secret. " +
        "Set JWT_SECRET to a strong value before deploying.",
    );
    return DEV_JWT_SECRET;
  }

  return secret;
}

const SECRET_KEY = new TextEncoder().encode(resolveJwtSecret());

export interface UserSession {
  userId: number;
  role?: string;
  [key: string]: any;
}

export async function verifyToken(token: string): Promise<UserSession> {
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY);
    
    // Normalize user_id vs sub
    const uid = payload.user_id || payload.sub;
    
    if (!uid) {
        throw new Error("Invalid token: missing user_id");
    }
    
    return {
      userId: Number(uid),
      role: payload.role as string,
      ...payload
    };
  } catch (err: any) {
    throw new Error(`Authentication failed: ${err.message}`);
  }
}

export async function signToken(payload: any): Promise<string> {
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(SECRET_KEY);
}