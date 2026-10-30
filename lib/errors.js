export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export class AppError extends Error {
  constructor(message, { cause, publicStatus = 500, publicMessage = GENERIC_ERROR_MESSAGE, code } = {}) {
    super(message);
    this.name = new.target.name;
    this.cause = cause;
    this.publicStatus = publicStatus;
    this.publicMessage = publicMessage;
    if (code !== undefined) this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message, { publicStatus = 400, ...options } = {}) {
    super(message, { ...options, publicStatus, publicMessage: message });
  }
}

export class UnreadableImageError extends ValidationError {
  constructor(message, options = {}) {
    super(message, { ...options, publicStatus: 415 });
  }
}

export class UploadTooLargeError extends ValidationError {
  constructor(message, options = {}) {
    super(message, { ...options, publicStatus: 413 });
  }
}

export class LimitExceededError extends ValidationError {
  constructor(message, options = {}) {
    super(message, { ...options, publicStatus: 413 });
  }
}

export class ConflictError extends AppError {
  constructor(message, options = {}) {
    super(message, { ...options, publicStatus: 409, publicMessage: message });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid credentials', options = {}) {
    super(message, {
      ...options,
      publicStatus: 401,
      publicMessage: 'Incorrect email or password.',
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', options = {}) {
    super(message, { ...options, publicStatus: 404, publicMessage: 'Not found.' });
  }
}

export class SharingOffError extends AppError {
  constructor(message = 'Public sharing is off', options = {}) {
    super(message, { ...options, publicStatus: 403, publicMessage: 'Sharing is turned off.' });
  }
}

export function toPublicError(error, fallback = GENERIC_ERROR_MESSAGE) {
  if (error instanceof AppError) {
    return { status: error.publicStatus, message: error.publicMessage };
  }
  return { status: 500, message: fallback };
}

const FIRST_SERVER_ERROR = 500;

export const isServerError = (status) => status >= FIRST_SERVER_ERROR;
