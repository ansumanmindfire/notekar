export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields: string[] | undefined;

  constructor(statusCode: number, code: string, message: string, fields?: string[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}
