import helmet from 'helmet';

export function createHelmetMiddleware(isProduction: boolean) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'"],
      },
    },
    frameguard: { action: 'deny' },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
}
