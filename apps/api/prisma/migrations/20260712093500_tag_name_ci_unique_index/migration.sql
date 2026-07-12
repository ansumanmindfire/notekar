-- Case-insensitive per-user tag name uniqueness (FR-TAG-1). Prisma cannot
-- model a functional index on lower(name), so this is a hand-written
-- --create-only migration (AGENTS.md §9, §11).
CREATE UNIQUE INDEX "tag_user_name_ci_idx" ON "Tag" ("userId", lower(name));
