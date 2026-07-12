import { Prisma, type PrismaClient } from '@prisma/client';
import type { SearchQuery } from 'shared/schemas';
import type { Page } from 'shared/types';
import type { NoteWithTags } from './notes.service';

const TAGS_INCLUDE = { tags: { select: { tagId: true } } } as const;

// Matched terms are wrapped in <mark> tags (FR-SEARCH-2); this options string
// is a fixed literal, never derived from user input.
const HEADLINE_OPTIONS =
  'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2';

export interface SearchResultRow {
  note: NoteWithTags;
  headline: string;
}

interface MatchRow {
  id: string;
  headline: string;
}

interface CountRow {
  count: bigint;
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

export async function searchNotes(
  prisma: PrismaClient,
  userId: string,
  query: SearchQuery,
): Promise<Page<SearchResultRow>> {
  const { q, page, pageSize } = query;
  const offset = (page - 1) * pageSize;

  const [matches, countRows] = await Promise.all([
    prisma.$queryRaw<MatchRow[]>(Prisma.sql`
      SELECT "id",
             ts_headline('english', "bodyText", plainto_tsquery('english', ${q}), ${HEADLINE_OPTIONS}) AS headline
      FROM "Note"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "searchVector" @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${q})) DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT count(*) AS count
      FROM "Note"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "searchVector" @@ plainto_tsquery('english', ${q})
    `),
  ]);

  const totalItems = Number(countRows[0]?.count ?? 0n);

  if (matches.length === 0) {
    return toPage([], page, pageSize, totalItems);
  }

  const ids = matches.map((m) => m.id);
  const headlineById = new Map(matches.map((m) => [m.id, m.headline]));

  const notes = await prisma.note.findMany({
    where: { id: { in: ids } },
    include: TAGS_INCLUDE,
  });
  const noteById = new Map(notes.map((note) => [note.id, note]));

  // Re-sort to match the rank order from the raw query - findMany({ id: { in } })
  // does not preserve input-array order.
  const items: SearchResultRow[] = ids.flatMap((id) => {
    const note = noteById.get(id);
    const headline = headlineById.get(id);
    return note && headline !== undefined ? [{ note, headline }] : [];
  });

  return toPage(items, page, pageSize, totalItems);
}
