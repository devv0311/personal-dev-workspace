// Domain error taxonomy (P2.7 §12). Pure — no I/O, no framework.

export type DomainErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden'
  | 'conflict';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export const validation = (m: string) => new DomainError('validation', m);
export const notFound = (m: string) => new DomainError('not_found', m);
export const forbidden = (m: string) => new DomainError('forbidden', m);
export const conflict = (m: string) => new DomainError('conflict', m);
