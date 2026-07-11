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
