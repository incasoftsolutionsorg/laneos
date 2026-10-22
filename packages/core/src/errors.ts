// One error envelope everywhere (blueprint §29.1). DB functions raise P0001 with a stable code
// as the message; constraint violations map by constraint name.

export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PLAN_LIMIT: 402,
  ABOVE_MRP: 409,
  PRICE_MISMATCH: 409,
  DUPLICATE_BARCODE: 409,
  DUPLICATE_PLU: 409,
  DUPLICATE_PHONE: 409,
  ITEM_INACTIVE: 409,
  SHIFT_NOT_OPEN: 409,
  SHIFT_ALREADY_OPEN: 409,
  UNDERPAID: 409,
  NO_TENANT: 403,
  BUSY_RETRY: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiError {
  status: number;
  code: ErrorCode;
  message?: string;
  details?: unknown;
}

const CONSTRAINT_CODES: Record<string, ErrorCode> = {
  barcodes_pkey: 'DUPLICATE_BARCODE',
  items_tenant_plu: 'DUPLICATE_PLU',
  customers_tenant_phone: 'DUPLICATE_PHONE',
};

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Turn a Supabase/PostgREST error into the envelope. Unknown errors become INTERNAL without leaking SQL. */
export function mapDbError(error: DbError): ApiError {
  const msg = error.message ?? '';
  if (error.code === 'P0001') {
    const code = msg.split(':')[0]!.trim() as ErrorCode;
    if (code in ERROR_STATUS) {
      return { status: ERROR_STATUS[code], code, message: msg.slice(code.length + 1).trim() || undefined };
    }
  }
  if (error.code === '23505') {
    const name = Object.keys(CONSTRAINT_CODES).find((c) => msg.includes(c) || error.details?.includes(c));
    if (name) return { status: 409, code: CONSTRAINT_CODES[name]! };
  }
  if (error.code === '42501') return { status: 403, code: 'FORBIDDEN' };
  if (error.code === '40001' || error.code === '40P01' || error.code === '55P03') {
    return { status: 503, code: 'BUSY_RETRY' };
  }
  if (error.code === '23514' || error.code === '22P02' || error.code === '23502') {
    return { status: 400, code: 'VALIDATION_ERROR' };
  }
  return { status: 500, code: 'INTERNAL' };
}

/** Human text for codes the UI shows to staff. */
export const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Some fields are not valid. Check them and try again.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  FORBIDDEN: 'You do not have permission to do that.',
  ABOVE_MRP: 'The price is above the MRP printed on the pack.',
  PRICE_MISMATCH: 'Prices changed on the server. The basket was re-priced; check the total.',
  DUPLICATE_BARCODE: 'Another item already uses this barcode.',
  DUPLICATE_PLU: 'Another item already uses this PLU.',
  DUPLICATE_PHONE: 'A customer with this phone number already exists.',
  SHIFT_NOT_OPEN: 'Open a shift on this lane before selling.',
  UNDERPAID: 'The payment is less than the total.',
  NO_TENANT: 'This account is not linked to a shop yet.',
  BUSY_RETRY: 'The server is busy. Try again.',
  INTERNAL: 'Something went wrong. Try again.',
};
