import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tier (coverage-gap follow-up for AB-1004 T11): `schedulePurgeNotesJob`
// and its registered cron callback had zero coverage. This file mocks
// `node-cron`, `../prisma`, and `../logger` so the callback's `purgeNotes(prisma)`
// success and `.catch` error branches (lines 26-28 of purgeNotes.ts) can be
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
    note: {
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

import { schedulePurgeNotesJob } from './purgeNotes';

function getRegisteredCallback(): () => void {
  expect(scheduleMock).toHaveBeenCalledTimes(1);
  const [expression, callback] = scheduleMock.mock.calls[0] as [string, () => void];
  expect(typeof expression).toBe('string');
  expect(callback).toEqual(expect.any(Function));
  return callback;
}

describe('schedulePurgeNotesJob', () => {
  beforeEach(() => {
    scheduleMock.mockClear();
    deleteManyMock.mockReset();
    loggerInfoMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it('#1 registers the configured cron expression and runs purgeNotes to completion on success', async () => {
    deleteManyMock.mockResolvedValue({ count: 3 });

    schedulePurgeNotesJob({ PURGE_CRON_SCHEDULE: '0 3 * * *' });

    expect(scheduleMock).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));

    const callback = getRegisteredCallback();

    callback();

    await vi.waitFor(() => {
      expect(deleteManyMock).toHaveBeenCalledTimes(1);
    });

    // Let the resolved purgeNotes promise (and its .then logging) fully settle.
    await vi.waitFor(() => {
      expect(loggerInfoMock).toHaveBeenCalledWith(
        '[purgeNotes] Permanently deleted 3 note(s) past the 30-day recovery window',
      );
    });

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('#2 catches a rejected purgeNotes call and logs it via logger.error instead of throwing', async () => {
    const boom = new Error('deleteMany exploded');
    deleteManyMock.mockRejectedValue(boom);

    schedulePurgeNotesJob({ PURGE_CRON_SCHEDULE: '*/5 * * * *' });

    const callback = getRegisteredCallback();

    expect(() => callback()).not.toThrow();

    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });

    expect(loggerErrorMock).toHaveBeenCalledWith({ err: boom }, '[purgeNotes] job failed');
  });
});
