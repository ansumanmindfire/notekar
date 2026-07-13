import type { NextFunction, Request, Response } from 'express';
import { createShareLinkSchema } from 'shared/schemas';
import type { CreatedShareLink, ShareLink as ShareLinkResponse } from 'shared/types';
import type { Env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { createShareLink, listShareLinks, revokeShareLink } from '../services/shares.service';

export type SharesControllerEnv = Pick<Env, 'WEB_ORIGIN'>;

// Derived from the service layer's own return type rather than importing
// @prisma/client directly, so this controller depends only on shares.service.
type PrismaShareLink = Awaited<ReturnType<typeof createShareLink>>;

function shareUrlFor(token: string, webOrigin: string): string {
  return `${webOrigin}/shares/${token}`;
}

function toCreatedShareLinkResponse(shareLink: PrismaShareLink, webOrigin: string): CreatedShareLink {
  return {
    token: shareLink.token,
    shareUrl: shareUrlFor(shareLink.token, webOrigin),
    expiresAt: shareLink.expiresAt.toISOString(),
    viewCount: shareLink.viewCount,
  };
}

function toShareLinkResponse(shareLink: PrismaShareLink, webOrigin: string): ShareLinkResponse {
  return {
    id: shareLink.id,
    token: shareLink.token,
    shareUrl: shareUrlFor(shareLink.token, webOrigin),
    expiresAt: shareLink.expiresAt.toISOString(),
    revokedAt: shareLink.revokedAt ? shareLink.revokedAt.toISOString() : null,
    viewCount: shareLink.viewCount,
    createdAt: shareLink.createdAt.toISOString(),
  };
}

// Express types req.params values as `string | string[]` to account for
// repeated-segment patterns, which these single-segment routes never use.
function getIdParam(req: Request): string {
  return req.params.id as string;
}

function getTokenParam(req: Request): string {
  return req.params.token as string;
}

export function createSharesController(env: SharesControllerEnv) {
  return {
    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = createShareLinkSchema.parse(req.body);
        const shareLink = await createShareLink(prisma, req.userId!, getIdParam(req), input);
        res.status(201).json(toCreatedShareLinkResponse(shareLink, env.WEB_ORIGIN));
      } catch (err) {
        next(err);
      }
    },

    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const shareLinks = await listShareLinks(prisma, req.userId!, getIdParam(req));
        res.status(200).json(shareLinks.map((s) => toShareLinkResponse(s, env.WEB_ORIGIN)));
      } catch (err) {
        next(err);
      }
    },

    async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await revokeShareLink(prisma, req.userId!, getIdParam(req), getTokenParam(req));
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  };
}
