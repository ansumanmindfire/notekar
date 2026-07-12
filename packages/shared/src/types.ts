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
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
