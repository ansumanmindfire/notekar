import { TAG_COLORS, type TagColor } from 'shared';

export function pickRandomTagColor(): TagColor {
  const index = Math.floor(Math.random() * TAG_COLORS.length);
  return TAG_COLORS[index] as TagColor;
}
