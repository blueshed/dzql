export enum ErrorCode {
  PERMISSION_DENIED = "PERMISSION_DENIED",
  NOT_FOUND = "NOT_FOUND",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  CONFLICT = "CONFLICT",
  RATE_LIMITED = "RATE_LIMITED",
  INTERNAL_ERROR = "INTERNAL_ERROR"
}

export class AppError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message || code);
    this.code = code;
  }
}

export function mapDatabaseError(err: any): AppError {
  // If it's already an AppError (e.g. thrown explicitly from PL/pgSQL RAISE), pass it through
  // Postgres RAISE EXCEPTION '...' usually comes as a generic error with a message
  
  const code = err.code; // SQLSTATE
  const message = err.message || "";

  // 1. Explicit RAISE EXCEPTION from our PL/pgSQL functions
  if (message.includes("permission_denied")) {
    return new AppError(ErrorCode.PERMISSION_DENIED);
  }
  if (message.includes("not_found")) {
    return new AppError(ErrorCode.NOT_FOUND);
  }
  if (message.includes("validation_error")) {
    return new AppError(ErrorCode.VALIDATION_ERROR, message);
  }

  // 2. Standard SQLSTATE Mapping
  switch (code) {
    case "23505": // Unique violation
      return new AppError(ErrorCode.CONFLICT, "Unique constraint violation");
    case "23503": // Foreign key violation
      return new AppError(ErrorCode.VALIDATION_ERROR, "Invalid reference");
    case "23502": // Not null violation
      return new AppError(ErrorCode.VALIDATION_ERROR, "Missing required field");
    case "42P01": // Undefined table (shouldn't happen in prod if manifest is correct)
      return new AppError(ErrorCode.INTERNAL_ERROR, "Table not found");
    default:
      // Log the real error internally, return generic to client
      // console.error(err); // Done in server.ts
      return new AppError(ErrorCode.INTERNAL_ERROR);
  }
}
