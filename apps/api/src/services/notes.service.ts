import { Prisma, type Note, type PrismaClient } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  PaginationQuery,
  ListNotesQuery,
  NoteSort,
} from 'shared/schemas';
import type { Page } from 'shared/types';
import { AppError } from '../lib/AppError';
import { extractPlainText } from '../lib/tiptap';

const SORT_ORDER_BY: Record<NoteSort, Prisma.NoteOrderByWithRelationInput> = {
  'createdAt:asc': { createdAt: 'asc' },
  'createdAt:desc': { createdAt: 'desc' },
  'updatedAt:asc': { updatedAt: 'asc' },
  'updatedAt:desc': { updatedAt: 'desc' },
};

export const TAGS_INCLUDE = { tags: { select: { tagId: true } } } as const;

export type NoteWithTags = Note & { tags: { tagId: string }[] };

export function notFound(): AppError {
  return new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
}

function invalidTag(): AppError {
  return new AppError(
    422,
    ErrorCodes.INVALID_TAG,
    'One or more tags do not exist or are not owned by the requesting user',
  );
}

// Backstop for the narrow TOCTOU window between assertOwnedTagIds's ownership
// check and the write below: if a tag is deleted in between, the NoteTag
// foreign key rejects the insert (P2003) instead of silently succeeding.
function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
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

// Dedupes the requested tagIds and confirms every one of them belongs to the
// caller before any note mutation is attempted (FR-NOTE-1/FR-NOTE-6).
async function assertOwnedTagIds(
  prisma: PrismaClient,
  userId: string,
  tagIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(tagIds)];

  if (uniqueIds.length === 0) {
    return uniqueIds;
  }

  const count = await prisma.tag.count({ where: { id: { in: uniqueIds }, userId } });

  if (count !== uniqueIds.length) {
    throw invalidTag();
  }

  return uniqueIds;
}

export async function createNote(
  prisma: PrismaClient,
  userId: string,
  input: CreateNoteInput,
): Promise<NoteWithTags> {
  const bodyText = extractPlainText(input.body);
  const tagIds = await assertOwnedTagIds(prisma, userId, input.tagIds ?? []);

  try {
    return await prisma.note.create({
      data: {
        userId,
        title: input.title,
        body: input.body as Prisma.InputJsonValue,
        bodyText,
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      include: TAGS_INCLUDE,
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw invalidTag();
    }
    throw err;
  }
}

export async function getNote(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<NoteWithTags> {
  const note = await prisma.note.findFirst({
    where: { id, userId, deletedAt: null },
    include: TAGS_INCLUDE,
  });

  if (!note) {
    throw notFound();
  }

  return note;
}

export async function updateNote(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: UpdateNoteInput,
): Promise<NoteWithTags> {
  const existing = await prisma.note.findFirst({ where: { id, userId, deletedAt: null } });

  if (!existing) {
    throw notFound();
  }

  const nextTitle = input.title ?? existing.title;
  const nextBody = (input.body ?? existing.body) as Prisma.InputJsonValue;
  const nextBodyText = input.body ? extractPlainText(input.body) : existing.bodyText;

  // undefined means "tagIds omitted" (leave tags untouched); [] means
  // "clear all tags" - both are distinct from a non-empty replacement set.
  const tagIds =
    input.tagIds !== undefined ? await assertOwnedTagIds(prisma, userId, input.tagIds) : undefined;

  // Snapshot the pre-update state and apply the update atomically (SDS §10),
  // so a crash mid-update can never leave a stale version count or a missing
  // snapshot. Tag replacement (delete-all-then-recreate) rides in the same
  // transaction only when tagIds was provided in the request.
  const tagOps =
    tagIds === undefined
      ? []
      : [
          prisma.noteTag.deleteMany({ where: { noteId: existing.id } }),
          ...(tagIds.length > 0
            ? [
                prisma.noteTag.createMany({
                  data: tagIds.map((tagId) => ({ noteId: existing.id, tagId })),
                }),
              ]
            : []),
        ];

  try {
    await prisma.$transaction([
      prisma.noteVersion.create({
        data: {
          noteId: existing.id,
          version: existing.version,
          title: existing.title,
          body: existing.body as Prisma.InputJsonValue,
        },
      }),
      prisma.note.update({
        where: { id: existing.id },
        data: {
          title: nextTitle,
          body: nextBody,
          bodyText: nextBodyText,
          version: { increment: 1 },
        },
      }),
      ...tagOps,
    ]);
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw invalidTag();
    }
    throw err;
  }

  const updated = await prisma.note.findFirst({
    where: { id: existing.id },
    include: TAGS_INCLUDE,
  });

  if (!updated) {
    throw notFound();
  }

  return updated;
}

export async function softDeleteNote(prisma: PrismaClient, userId: string, id: string): Promise<void> {
  // Scoped updateMany (not findFirst+update) closes the TOCTOU gap between
  // two concurrent requests racing against the same row.
  const { count } = await prisma.note.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (count === 0) {
    throw notFound();
  }
}

export async function restoreNote(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<NoteWithTags> {
  const { count } = await prisma.note.updateMany({
    where: { id, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  if (count === 0) {
    throw notFound();
  }

  const note = await prisma.note.findFirst({ where: { id, userId }, include: TAGS_INCLUDE });

  if (!note) {
    throw notFound();
  }

  return note;
}

export async function listNotes(
  prisma: PrismaClient,
  userId: string,
  query: ListNotesQuery,
): Promise<Page<NoteWithTags>> {
  const { page, pageSize, sort, tagIds } = query;
  const where: Prisma.NoteWhereInput = {
    userId,
    deletedAt: null,
    // AND semantics (FR-NOTE-6): the note must carry every listed tag, not
    // just any one of them.
    ...(tagIds && tagIds.length > 0
      ? { AND: tagIds.map((tagId) => ({ tags: { some: { tagId } } })) }
      : {}),
  };

  const [items, totalItems] = await Promise.all([
    prisma.note.findMany({
      where,
      include: TAGS_INCLUDE,
      orderBy: SORT_ORDER_BY[sort],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.note.count({ where }),
  ]);

  return toPage(items, page, pageSize, totalItems);
}

export async function listTrash(
  prisma: PrismaClient,
  userId: string,
  pagination: PaginationQuery,
): Promise<Page<NoteWithTags>> {
  const { page, pageSize } = pagination;
  const where = { userId, deletedAt: { not: null } };

  const [items, totalItems] = await Promise.all([
    prisma.note.findMany({
      where,
      include: TAGS_INCLUDE,
      orderBy: { deletedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.note.count({ where }),
  ]);

  return toPage(items, page, pageSize, totalItems);
}
