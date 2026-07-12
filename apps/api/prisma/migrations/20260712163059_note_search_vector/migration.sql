-- Full-text search column (FR-SEARCH-1). Prisma cannot model a STORED
-- generated column, so this is a hand-written --create-only migration
-- (AGENTS.md §9, §11), applied to both notes_dev and notes_test.
ALTER TABLE "Note"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce("bodyText", ''))
  ) STORED;

CREATE INDEX "note_search_idx" ON "Note" USING GIN ("searchVector");
