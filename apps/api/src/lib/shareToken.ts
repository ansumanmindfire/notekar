import { randomBytes } from 'node:crypto';

const SHARE_TOKEN_BYTES = 24; // base64url-encoded -> 32 URL-safe chars

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}
