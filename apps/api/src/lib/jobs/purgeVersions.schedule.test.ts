import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tier (mirrors purgeNotes.schedule.test.ts's convention exactly):
// `schedulePurgeVersionsJob` and its registered cron callback. This file
// mocks `node-cron`, `../prisma`, and `../logger` so the callback's
// `purgeVersions(prisma)` success and `.catch` error branches can be
// exercised without a real cron timer or a real database.

const { scheduleMock, deleteManyMock, loggerInfoMock, loggerErrorMock } = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  deleteManyMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('node-cron', () => ({
  schedule: scheduleMock,
}));

vi.mock('../prisma', () => ({
  prisma: {
    noteVersion: {
      deleteMany: deleteManyMock,
    },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: loggerInfoMock,
    error: loggerErrorMock,
  },
}));

import { schedulePurgeVersionsJob } from './purgeVersions';

function getRegisteredCallback(): () => void {
  expect(scheduleMock).toHaveBeenCalledTimes(1);
  const [expression, callback] = scheduleMock.mock.calls[0] as [string, () => void];
  expect(typeof expression).toBe('string');
  expect(callback).toEqual(expect.any(Function));
  return callback;
}

describe('schedulePurgeVersionsJob', () => {
  beforeEach(() => {
    scheduleMock.mockClear();
    deleteManyMock.mockReset();
    loggerInfoMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it('#1 registers the configured cron expression and runs purgeVersions to completion on success', async () => {
    deleteManyMock.mockResolvedValue({ count: 5 });

    schedulePurgeVersionsJob({ PURGE_CRON_SCHEDULE: '0 3 * * *' });

    expect(scheduleMock).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));

    const callback = getRegisteredCallback();

    callback();

    await vi.waitFor(() => {
      expect(deleteManyMock).toHaveBeenCalledTimes(1);
    });

    // Let the resolved purgeVersions promise (and its .then logging) fully settle.
    await vi.waitFor(() => {
      expect(loggerInfoMock).toHaveBeenCalledWith(
        '[purgeVersions] Permanently deleted 5 version(s) past the 90-day retention window',
      );
    });

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('#2 catches a rejected purgeVersions call and logs it via logger.error instead of throwing', async () => {
    const boom = new Error('deleteMany exploded');
    deleteManyMock.mockRejectedValue(boom);

    schedulePurgeVersionsJob({ PURGE_CRON_SCHEDULE: '*/5 * * * *' });

    const callback = getRegisteredCallback();

    expect(() => callback()).not.toThrow();

    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });

    expect(loggerErrorMock).toHaveBeenCalledWith({ err: boom }, '[purgeVersions] job failed');
  });
});
