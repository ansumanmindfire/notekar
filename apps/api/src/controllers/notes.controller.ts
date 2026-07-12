import type { NextFunction, Request, Response } from 'express';
import { createNoteSchema, updateNoteSchema, paginationQuerySchema } from 'shared/schemas';
import type { Note as NoteResponse, Page } from 'shared/types';
import { prisma } from '../lib/prisma';
import {
  createNote,
  getNote,
  updateNote,
  softDeleteNote,
  restoreNote,
  listNotes,
  listTrash,
} from '../services/notes.service';

// Derived from the service layer's own return type rather than importing
// @prisma/client directly, so this controller depends only on notes.service.
type PrismaNote = Awaited<ReturnType<typeof getNote>>;

function toNoteResponse(note: PrismaNote): NoteResponse {
  return {
    id: note.id,
    title: note.title,
    body: note.body as NoteResponse['body'],
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
  };
}

function toNotePageResponse(page: Page<PrismaNote>): Page<NoteResponse> {
  return { ...page, items: page.items.map(toNoteResponse) };
}

// Express types req.params values as `string | string[]` to account for
// repeated-segment patterns, which these single-`:id`-segment routes never use.
function getIdParam(req: Request): string {
  return req.params.id as string;
}

export function createNotesController() {
  return {
    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = createNoteSchema.parse(req.body);
        const note = await createNote(prisma, req.userId!, input);
        res.status(201).json(toNoteResponse(note));
      } catch (err) {
        next(err);
      }
    },

    async get(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const note = await getNote(prisma, req.userId!, getIdParam(req));
        res.status(200).json(toNoteResponse(note));
      } catch (err) {
        next(err);
      }
    },

    async update(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = updateNoteSchema.parse(req.body);
        const note = await updateNote(prisma, req.userId!, getIdParam(req), input);
        res.status(200).json(toNoteResponse(note));
      } catch (err) {
        next(err);
      }
    },

    async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await softDeleteNote(prisma, req.userId!, getIdParam(req));
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },

    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const pagination = paginationQuerySchema.parse(req.query);
        const page = await listNotes(prisma, req.userId!, pagination);
        res.status(200).json(toNotePageResponse(page));
      } catch (err) {
        next(err);
      }
    },

    async listTrash(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const pagination = paginationQuerySchema.parse(req.query);
        const page = await listTrash(prisma, req.userId!, pagination);
        res.status(200).json(toNotePageResponse(page));
      } catch (err) {
        next(err);
      }
    },

    async restore(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const note = await restoreNote(prisma, req.userId!, getIdParam(req));
        res.status(200).json(toNoteResponse(note));
      } catch (err) {
        next(err);
      }
    },
  };
}
