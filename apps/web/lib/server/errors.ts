import 'server-only';
import { ERROR_TEXT, mapDbError, type ApiError, type ErrorCode } from '@laneos/core';

export function apiError(status: number, code: ErrorCode, details?: unknown) {
  return Response.json({ error: { code, message: ERROR_TEXT[code], details } }, { status });
}

export function dbErrorResponse(error: Parameters<typeof mapDbError>[0]) {
  const mapped: ApiError = mapDbError(error);
  return Response.json(
    { error: { code: mapped.code, message: ERROR_TEXT[mapped.code] ?? mapped.message, details: mapped.message } },
    { status: mapped.status },
  );
}

/** Text for a form error after a server action. */
export function dbErrorText(error: Parameters<typeof mapDbError>[0]): string {
  const mapped = mapDbError(error);
  return ERROR_TEXT[mapped.code] ?? mapped.message ?? 'Something went wrong.';
}
