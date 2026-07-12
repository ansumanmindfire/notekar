import { schedule } from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../env';
import { logger } from '../logger';
import { prisma } from '../prisma';

const NOTE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface PurgeNotesResult {
  purgedCount: number;
}

export async function purgeNotes(prismaClient: PrismaClient): Promise<PurgeNotesResult> {
  const cutoff = new Date(Date.now() - NOTE_RETENTION_MS);

  const { count } = await prismaClient.note.deleteMany({
    where: { deletedAt: { lt: cutoff } },
  });

  logger.info(`[purgeNotes] Permanently deleted ${count} note(s) past the 30-day recovery window`);

  return { purgedCount: count };
}

export function schedulePurgeNotesJob(env: Pick<Env, 'PURGE_CRON_SCHEDULE'>): void {
  schedule(env.PURGE_CRON_SCHEDULE, () => {
    purgeNotes(prisma).catch((err: unknown) => {
      logger.error({ err }, '[purgeNotes] job failed');
    });
  });
}
