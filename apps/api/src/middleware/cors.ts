import cors from 'cors';

export function createCorsMiddleware(webOrigin: string) {
  return cors({
    origin: webOrigin,
    credentials: true,
  });
}
