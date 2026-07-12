import type { NextFunction, Request, Response } from 'express';
import { createTagSchema, updateTagSchema, paginationQuerySchema } from 'shared/schemas';
import type { Tag as TagResponse, TagWithCount as TagWithCountResponse, Page } from 'shared/types';
import { prisma } from '../lib/prisma';
import {
  createTag,
  updateTag,
  deleteTag,
  listTags,
  type TagWithCount,
} from '../services/tags.service';

// Derived from the service layer's own return type rather than importing
// @prisma/client directly, so this controller depends only on tags.service.
type PrismaTagRow = Awaited<ReturnType<typeof createTag>>;

function toTagResponse(tag: PrismaTagRow): TagResponse {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color as TagResponse['color'],
  };
}

function toTagWithCountResponse(tag: TagWithCount): TagWithCountResponse {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color as TagWithCountResponse['color'],
    noteCount: tag._count.notes,
  };
}

function toTagPageResponse(page: Page<TagWithCount>): Page<TagWithCountResponse> {
  return { ...page, items: page.items.map(toTagWithCountResponse) };
}

// Express types req.params values as `string | string[]` to account for
// repeated-segment patterns, which these single-`:id`-segment routes never use.
function getIdParam(req: Request): string {
  return req.params.id as string;
}

export function createTagsController() {
  return {
    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = createTagSchema.parse(req.body);
        const tag = await createTag(prisma, req.userId!, input);
        res.status(201).json(toTagResponse(tag));
      } catch (err) {
        next(err);
      }
    },

    async update(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = updateTagSchema.parse(req.body);
        const tag = await updateTag(prisma, req.userId!, getIdParam(req), input);
        res.status(200).json(toTagResponse(tag));
      } catch (err) {
        next(err);
      }
    },

    async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await deleteTag(prisma, req.userId!, getIdParam(req));
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },

    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const pagination = paginationQuerySchema.parse(req.query);
        const page = await listTags(prisma, req.userId!, pagination);
        res.status(200).json(toTagPageResponse(page));
      } catch (err) {
        next(err);
      }
    },
  };
}
