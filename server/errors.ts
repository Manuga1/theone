export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const notFound = (what: string) => new HttpError(404, `${what} not found`, 'not_found');
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');
export const forbidden = (msg: string) => new HttpError(403, msg, 'forbidden');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');
