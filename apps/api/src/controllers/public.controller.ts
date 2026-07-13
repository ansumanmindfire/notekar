import type { NextFunction, Request, Response } from 'express';
import type { PublicShareView } from 'shared/types';
import { prisma } from '../lib/prisma';
import { viewPublicShare, type PublicShareResult } from '../services/shares.service';

function toPublicShareViewResponse(result: PublicShareResult): PublicShareView {
  return {
    title: result.note.title,
    body: result.note.body as PublicShareView['body'],
    viewCount: result.shareLink.viewCount,
    sharedAt: result.shareLink.createdAt.toISOString(),
  };
}

// Express types req.params values as `string | string[]` to account for
// repeated-segment patterns, which this single-segment route never uses.
function getTokenParam(req: Request): string {
  return req.params.token as string;
}

export function createPublicController() {
  return {
    async view(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await viewPublicShare(prisma, getTokenParam(req));
        res.status(200).json(toPublicShareViewResponse(result));
      } catch (err) {
        next(err);
      }
    },
  };
}
