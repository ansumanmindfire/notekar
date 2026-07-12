import { Prisma, type PrismaClient, type Tag as PrismaTag } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreateTagInput, UpdateTagInput, PaginationQuery } from 'shared/schemas';
import type { Page } from 'shared/types';
import { AppError } from '../lib/AppError';

export type TagWithCount = PrismaTag & { _count: { notes: number } };

function notFound(): AppError {
  return new AppError(404, ErrorCodes.TAG_NOT_FOUND, 'Tag not found');
}

function duplicateName(): AppError {
  return new AppError(409, ErrorCodes.TAG_NAME_DUPLICATE, 'A tag with this name already exists');
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function toPage<T>(items: T[], page: number, pageSize: number, totalItems: number): Page<T> {
  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  };
}

export async function createTag(
  prisma: PrismaClient,
  userId: string,
  input: CreateTagInput,
): Promise<PrismaTag> {
  try {
    return await prisma.tag.create({
      data: { userId, name: input.name, color: input.color },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw duplicateName();
    }
    throw err;
  }
}

export async function updateTag(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: UpdateTagInput,
): Promise<PrismaTag> {
  const data: Prisma.TagUpdateManyMutationInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.color !== undefined && { color: input.color }),
  };

  let count: number;
  try {
    ({ count } = await prisma.tag.updateMany({ where: { id, userId }, data }));
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw duplicateName();
    }
    throw err;
  }

  if (count === 0) {
    throw notFound();
  }

  const tag = await prisma.tag.findFirst({ where: { id, userId } });

  if (!tag) {
    throw notFound();
  }

  return tag;
}

export async function deleteTag(prisma: PrismaClient, userId: string, id: string): Promise<void> {
  // Scoped deleteMany (not findFirst+delete) closes the TOCTOU gap between two
  // concurrent requests racing against the same row. Cascades to NoteTag via
  // the FK; the notes themselves are untouched (FR-TAG-2).
  const { count } = await prisma.tag.deleteMany({ where: { id, userId } });

  if (count === 0) {
    throw notFound();
  }
}

export async function listTags(
  prisma: PrismaClient,
  userId: string,
  pagination: PaginationQuery,
): Promise<Page<TagWithCount>> {
  const { page, pageSize } = pagination;
  const where = { userId };

  const [items, totalItems] = await Promise.all([
    prisma.tag.findMany({
      where,
      include: {
        _count: {
          select: { notes: { where: { note: { deletedAt: null } } } },
        },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tag.count({ where }),
  ]);

  return toPage(items, page, pageSize, totalItems);
}
