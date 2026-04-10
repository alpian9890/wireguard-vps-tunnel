export class AppError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

