export interface CourtInput {
  venue_id?: unknown;
  code?: unknown;
  name?: unknown;
  active?: unknown;
}

export interface CourtInsertPayload {
  venue_id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface CourtUpdatePayload {
  code?: string;
  name?: string;
  active?: boolean;
}

const CODE_REGEX = /^[A-Z0-9-]+$/;

function validateCode(code: unknown): { valid: boolean; error?: string } {
  if (typeof code !== 'string' || !code.trim()) {
    return { valid: false, error: 'Court code is required' };
  }
  if (!CODE_REGEX.test(code)) {
    return { valid: false, error: 'Court code must contain only uppercase letters, numbers, and hyphens' };
  }
  return { valid: true };
}

export function validateCourtInsertInput(input: CourtInput): {
  valid: boolean;
  error?: string;
  payload?: CourtInsertPayload;
} {
  if (typeof input.venue_id !== 'string' || !input.venue_id.trim()) {
    return { valid: false, error: 'Venue ID is required' };
  }

  const codeValidation = validateCode(input.code);
  if (!codeValidation.valid) {
    return { valid: false, error: codeValidation.error };
  }

  if (typeof input.name !== 'string' || !input.name.trim()) {
    return { valid: false, error: 'Court name is required' };
  }

  return {
    valid: true,
    payload: {
      venue_id: input.venue_id,
      code: (input.code as string).toUpperCase(),
      name: (input.name as string).trim(),
      active: input.active !== false,
    },
  };
}

export function validateCourtUpdateInput(input: CourtInput): {
  valid: boolean;
  error?: string;
  payload?: CourtUpdatePayload;
} {
  const payload: CourtUpdatePayload = {};

  if (input.code !== undefined) {
    const codeValidation = validateCode(input.code);
    if (!codeValidation.valid) {
      return { valid: false, error: codeValidation.error };
    }
    payload.code = (input.code as string).toUpperCase();
  }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return { valid: false, error: 'Court name is required' };
    }
    payload.name = (input.name as string).trim();
  }

  if (input.active !== undefined) {
    payload.active = input.active !== false;
  }

  return { valid: true, payload };
}
