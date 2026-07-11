import { createHash, randomBytes } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32; // hex-encoded -> exactly 64 chars, URL-safe (0-9a-f only)

export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('hex');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
