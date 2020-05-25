export class RequestError<T extends number> extends Error {
  constructor(public code: T, message?: string) {
    super(message);
  }
}

export type SerializedError = [number] | [number, string];
