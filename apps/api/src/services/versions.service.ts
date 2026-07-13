import { Prisma, type PrismaClient, type Note, type NoteVersion } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import { AppError } from '../lib/AppError';
import { extractPlainText } from '../lib/tiptap';
import { TAGS_INCLUDE, notFound, type NoteWithTags } from './notes.service';

function versionNotFound(): AppError {
  return new AppError(404, ErrorCodes.VERSION_NOT_FOUND, 'Version not found');
}

// No `deletedAt` filter: version history must stay viewable and restorable
// during a note's 30-day Trash window (FR-VER-1), mirroring
// shares.service.ts:listShareLinks's precedent for owner-scoped metadata.
async function findOwnedNote(prisma: PrismaClient, userId: string, noteId: string): Promise<Note> {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });

  if (!note) {
    throw notFound();
  }

  return note;
}

export async function listVersions(
  prisma: PrismaClient,
  userId: string,
  noteId: string,
): Promise<NoteVersion[]> {
  await findOwnedNote(prisma, userId, noteId);

  return prisma.noteVersion.findMany({
    where: { noteId },
    orderBy: { savedAt: 'desc' },
  });
}

export async function getVersion(
  prisma: PrismaClient,
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteVersion> {
  await findOwnedNote(prisma, userId, noteId);

  const version = await prisma.noteVersion.findFirst({ where: { id: versionId, noteId } });

  if (!version) {
    throw versionNotFound();
  }

  return version;
}

export async function restoreVersion(
  prisma: PrismaClient,
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteWithTags> {
  const existing = await findOwnedNote(prisma, userId, noteId);
  const target = await prisma.noteVersion.findFirst({ where: { id: versionId, noteId } });

  if (!target) {
    throw versionNotFound();
  }

  // Snapshot the pre-restore state and apply the historical content
  // atomically (SDS §10) - same two-step shape as notes.service.ts:updateNote,
  // just reverting to `target`'s content instead of a request body. Tags are
  // never touched (FR-VER-2): current-state metadata, unaffected by restore.
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
        title: target.title,
        body: target.body as Prisma.InputJsonValue,
        bodyText: extractPlainText(target.body),
        version: { increment: 1 },
      },
    }),
  ]);

  const restored = await prisma.note.findFirst({
    where: { id: existing.id },
    include: TAGS_INCLUDE,
  });

  if (!restored) {
    throw notFound();
  }

  return restored;
}
