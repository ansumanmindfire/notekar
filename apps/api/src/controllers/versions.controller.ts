import type { NextFunction, Request, Response } from 'express';
import type { NoteVersionDetail, NoteVersionSummary } from 'shared/types';
import { prisma } from '../lib/prisma';
import { toNoteResponse } from './notes.controller';
import { listVersions, getVersion, restoreVersion } from '../services/versions.service';

// Derived from the service layer's own return type rather than importing
// @prisma/client directly, so this controller depends only on versions.service.
type PrismaNoteVersion = Awaited<ReturnType<typeof getVersion>>;

function toVersionSummaryResponse(version: PrismaNoteVersion): NoteVersionSummary {
  return {
    id: version.id,
    version: version.version,
    title: version.title,
    savedAt: version.savedAt.toISOString(),
  };
}

function toVersionDetailResponse(version: PrismaNoteVersion): NoteVersionDetail {
  return {
    ...toVersionSummaryResponse(version),
    body: version.body as NoteVersionDetail['body'],
  };
}

// Express types req.params values as `string | string[]` to account for
// repeated-segment patterns, which these single-segment routes never use.
function getIdParam(req: Request): string {
  return req.params.id as string;
}

function getVersionIdParam(req: Request): string {
  return req.params.versionId as string;
}

export function createVersionsController() {
  return {
    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const versions = await listVersions(prisma, req.userId!, getIdParam(req));
        res.status(200).json(versions.map(toVersionSummaryResponse));
      } catch (err) {
        next(err);
      }
    },

    async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const version = await getVersion(prisma, req.userId!, getIdParam(req), getVersionIdParam(req));
        res.status(200).json(toVersionDetailResponse(version));
      } catch (err) {
        next(err);
      }
    },

    async restore(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const note = await restoreVersion(prisma, req.userId!, getIdParam(req), getVersionIdParam(req));
        res.status(200).json(toNoteResponse(note));
      } catch (err) {
        next(err);
      }
    },
  };
}
