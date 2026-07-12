import type { NextFunction, Request, Response } from 'express';
import { searchQuerySchema } from 'shared/schemas';
import type { Page, SearchResultItem } from 'shared/types';
import { prisma } from '../lib/prisma';
import { searchNotes, type SearchResultRow } from '../services/search.service';
import { toNoteResponse } from './notes.controller';

function toSearchResultResponse(row: SearchResultRow): SearchResultItem {
  return {
    note: toNoteResponse(row.note),
    headline: row.headline,
  };
}

function toSearchResultPageResponse(page: Page<SearchResultRow>): Page<SearchResultItem> {
  return { ...page, items: page.items.map(toSearchResultResponse) };
}

export function createSearchController() {
  return {
    async search(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const query = searchQuerySchema.parse(req.query);
        const page = await searchNotes(prisma, req.userId!, query);
        res.status(200).json(toSearchResultPageResponse(page));
      } catch (err) {
        next(err);
      }
    },
  };
}
