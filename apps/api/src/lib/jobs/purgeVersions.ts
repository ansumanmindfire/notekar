import { schedule } from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../env';
import { logger } from '../logger';
import { prisma } from '../prisma';

const VERSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface PurgeVersionsResult {
  purgedCount: number;
}

export async function purgeVersions(prismaClient: PrismaClient): Promise<PurgeVersionsResult> {
  const cutoff = new Date(Date.now() - VERSION_RETENTION_MS);
  const { count } = await prismaClient.noteVersion.deleteMany({
    where: { savedAt: { lt: cutoff } },
  });
  logger.info(`[purgeVersions] Permanently deleted ${count} version(s) past the 90-day retention window`);
  return { purgedCount: count };
}

export function schedulePurgeVersionsJob(env: Pick<Env, 'PURGE_CRON_SCHEDULE'>): void {
  schedule(env.PURGE_CRON_SCHEDULE, () => {
    purgeVersions(prisma).catch((err: unknown) => {
      logger.error({ err }, '[purgeVersions] job failed');
    });
  });
}
