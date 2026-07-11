import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new Error('Invalid access token payload');
  }

  return { sub: payload.sub };
}
