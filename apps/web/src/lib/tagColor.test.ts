import { describe, expect, it } from 'vitest';
import { TAG_COLORS } from 'shared';
import { pickRandomTagColor } from './tagColor';

describe('pickRandomTagColor', () => {
  it('always returns a member of TAG_COLORS across repeated calls', () => {
    for (let i = 0; i < 50; i++) {
      expect(TAG_COLORS).toContain(pickRandomTagColor());
    }
  });
});
