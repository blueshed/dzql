import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "default_dev_secret";
const SECRET_KEY = new TextEncoder().encode(JWT_SECRET);

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