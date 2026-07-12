-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteVersion" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_userId_deletedAt_idx" ON "Note"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Note_userId_createdAt_idx" ON "Note"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteVersion_noteId_version_idx" ON "NoteVersion"("noteId", "version");

-- CreateIndex
CREATE INDEX "NoteVersion_savedAt_idx" ON "NoteVersion"("savedAt");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteVersion" ADD CONSTRAINT "NoteVersion_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
