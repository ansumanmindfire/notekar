import type { Note, Prisma, PrismaClient } from '@prisma/client';
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

function notFound(): AppError {
  return new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
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

export async function createNote(
  prisma: PrismaClient,
  userId: string,
  input: CreateNoteInput,
): Promise<Note> {
  const bodyText = extractPlainText(input.body);

  return prisma.note.create({
    data: {
      userId,
      title: input.title,
      body: input.body as Prisma.InputJsonValue,
      bodyText,
    },
  });
}

export async function getNote(prisma: PrismaClient, userId: string, id: string): Promise<Note> {
  const note = await prisma.note.findFirst({ where: { id, userId, deletedAt: null } });

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
): Promise<Note> {
  const existing = await prisma.note.findFirst({ where: { id, userId, deletedAt: null } });

  if (!existing) {
    throw notFound();
  }

  const nextTitle = input.title ?? existing.title;
  const nextBody = (input.body ?? existing.body) as Prisma.InputJsonValue;
  const nextBodyText = input.body ? extractPlainText(input.body) : existing.bodyText;

  // Snapshot the pre-update state and apply the update atomically (SDS §10),
  // so a crash mid-update can never leave a stale version count or a missing
  // snapshot.
  const [, updated] = await prisma.$transaction([
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
  ]);

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

export async function restoreNote(prisma: PrismaClient, userId: string, id: string): Promise<Note> {
  const { count } = await prisma.note.updateMany({
    where: { id, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  if (count === 0) {
    throw notFound();
  }

  const note = await prisma.note.findFirst({ where: { id, userId } });

  if (!note) {
    throw notFound();
  }

  return note;
}

export async function listNotes(
  prisma: PrismaClient,
  userId: string,
  query: ListNotesQuery,
): Promise<Page<Note>> {
  const { page, pageSize, sort } = query;
  const where = { userId, deletedAt: null };

  const [items, totalItems] = await Promise.all([
    prisma.note.findMany({
      where,
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
): Promise<Page<Note>> {
  const { page, pageSize } = pagination;
  const where = { userId, deletedAt: { not: null } };

  const [items, totalItems] = await Promise.all([
    prisma.note.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.note.count({ where }),
  ]);

  return toPage(items, page, pageSize, totalItems);
}
