import type { TagColor } from './schemas';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  fields?: string[];
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  createdAt: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export type TipTapDocument = Record<string, unknown>;

export interface Note {
  id: string;
  title: string;
  body: TipTapDocument;
  tagIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

export interface TagWithCount extends Tag {
  noteCount: number;
}

export interface SearchResultItem {
  note: Note;
  headline: string;
}

export interface CreatedShareLink {
  token: string;
  shareUrl: string;
  expiresAt: string;
  viewCount: number;
}

export interface ShareLink {
  id: string;
  token: string;
  shareUrl: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
}

export interface PublicShareView {
  title: string;
  body: TipTapDocument;
  viewCount: number;
  sharedAt: string;
}
