import { Prisma, type PrismaClient, type Note, type ShareLink } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreateShareLinkInput } from 'shared/schemas';
import { AppError } from '../lib/AppError';
import { generateShareToken } from '../lib/shareToken';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 30;

interface ViewShareRow {
  id: string;
  noteId: string;
  token: string;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

function noteNotFound(): AppError {
  return new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
}

function shareNotFound(): AppError {
  return new AppError(404, ErrorCodes.SHARE_NOT_FOUND, 'Share link not found');
}

function goneLinkInvalid(): AppError {
  return new AppError(410, ErrorCodes.GONE_LINK_INVALID, 'Share link is invalid, expired, or revoked');
}

function invalidExpiresAt(): AppError {
  return new AppError(
    400,
    ErrorCodes.VALIDATION_FAILED,
    'expiresAt must be strictly after now and no more than 30 days from now',
    ['expiresAt'],
  );
}

// Format is already validated by createShareLinkSchema (Zod). This resolves
// the FRS's "1 to 30 days" business rule as a range check against `now()` at
// request time - a time-dependent rule that doesn't belong in a Zod schema.
function resolveExpiresAt(expiresAt: string | undefined): Date {
  const now = Date.now();

  if (expiresAt === undefined) {
    return new Date(now + DEFAULT_EXPIRY_DAYS * DAY_MS);
  }

  const parsed = new Date(expiresAt);
  const deltaMs = parsed.getTime() - now;

  if (deltaMs <= 0 || deltaMs > MAX_EXPIRY_DAYS * DAY_MS) {
    throw invalidExpiresAt();
  }

  return parsed;
}

export async function createShareLink(
  prisma: PrismaClient,
  userId: string,
  noteId: string,
  input: CreateShareLinkInput,
): Promise<ShareLink> {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });

  if (!note) {
    throw noteNotFound();
  }

  const expiresAt = resolveExpiresAt(input.expiresAt);

  return prisma.shareLink.create({
    data: {
      noteId,
      token: generateShareToken(),
      expiresAt,
    },
  });
}

export async function listShareLinks(
  prisma: PrismaClient,
  userId: string,
  noteId: string,
): Promise<ShareLink[]> {
  // No `deletedAt` filter: an owner can still review a note's share history
  // during its 30-day Trash recovery window (mirrors FR-VER-1's precedent).
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });

  if (!note) {
    throw noteNotFound();
  }

  return prisma.shareLink.findMany({
    where: { noteId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeShareLink(
  prisma: PrismaClient,
  userId: string,
  noteId: string,
  token: string,
): Promise<void> {
  const existing = await prisma.shareLink.findFirst({
    where: { token, noteId, note: { userId } },
  });

  if (!existing) {
    throw shareNotFound();
  }

  if (existing.revokedAt !== null) {
    return; // Already revoked - idempotent no-op, not an error.
  }

  await prisma.shareLink.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
}

export interface PublicShareResult {
  note: Note;
  shareLink: ViewShareRow;
}

export async function viewPublicShare(prisma: PrismaClient, token: string): Promise<PublicShareResult> {
  // Atomic UPDATE ... RETURNING (SDS §11): avoids a read-then-write race
  // under concurrent public views. If no row is returned, the token is
  // missing, revoked, expired, or its parent note is soft-deleted.
  const rows = await prisma.$queryRaw<ViewShareRow[]>(Prisma.sql`
    UPDATE "ShareLink" sl
    SET "viewCount" = sl."viewCount" + 1
    FROM "Note" n
    WHERE sl.token = ${token}
      AND sl."revokedAt" IS NULL
      AND sl."expiresAt" > now()
      AND sl."noteId" = n.id
      AND n."deletedAt" IS NULL
    RETURNING sl.*
  `);

  const shareLink = rows[0];

  if (!shareLink) {
    throw goneLinkInvalid();
  }

  const note = await prisma.note.findUniqueOrThrow({ where: { id: shareLink.noteId } });

  return { note, shareLink };
}
