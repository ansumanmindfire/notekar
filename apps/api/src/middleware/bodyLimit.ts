import express from 'express';

export const notesBodyLimit = express.json({ limit: '1mb' });
export const defaultBodyLimit = express.json({ limit: '10kb' });
