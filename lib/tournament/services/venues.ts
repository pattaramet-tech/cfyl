export interface VenueInput {
  tournament_id?: unknown;
  name?: unknown;
  code?: unknown;
  slug?: unknown;
  address?: unknown;
  active?: unknown;
}

export interface VenueInsertPayload {
  tournament_id: string;
  name: string;
  code: string;
  slug: string;
  address: string | null;
  active: boolean;
}

export interface VenueUpdatePayload {
  name?: string;
  code?: string;
  slug?: string;
  address?: string | null;
  active?: boolean;
}

const CODE_REGEX = /^[A-Z0-9-]+$/;
const SLUG_REGEX = /^[a-z0-9-]+$/;

function validateCode(code: unknown): { valid: boolean; error?: string } {
  if (typeof code !== 'string' || !code.trim()) {
    return { valid: false, error: 'Venue code is required' };
  }
  if (!CODE_REGEX.test(code)) {
    return { valid: false, error: 'Venue code must contain only uppercase letters, numbers, and hyphens' };
  }
  return { valid: true };
}

function validateSlug(slug: unknown): { valid: boolean; error?: string } {
  if (typeof slug !== 'string' || !slug.trim()) {
    return { valid: false, error: 'Venue slug is required' };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { valid: false, error: 'Venue slug must contain only lowercase letters, numbers, and hyphens' };
  }
  return { valid: true };
}

export function validateVenueInsertInput(input: VenueInput): {
  valid: boolean;
  error?: string;
  payload?: VenueInsertPayload;
} {
  if (typeof input.tournament_id !== 'string' || !input.tournament_id.trim()) {
    return { valid: false, error: 'Tournament ID is required' };
  }

  if (typeof input.name !== 'string' || !input.name.trim()) {
    return { valid: false, error: 'Venue name is required' };
  }

  const codeValidation = validateCode(input.code);
  if (!codeValidation.valid) {
    return { valid: false, error: codeValidation.error };
  }

  const slugValidation = validateSlug(input.slug);
  if (!slugValidation.valid) {
    return { valid: false, error: slugValidation.error };
  }

  return {
    valid: true,
    payload: {
      tournament_id: input.tournament_id,
      name: (input.name as string).trim(),
      code: (input.code as string).toUpperCase(),
      slug: input.slug as string,
      address: typeof input.address === 'string' ? input.address.trim() || null : null,
      active: input.active !== false,
    },
  };
}

export function validateVenueUpdateInput(input: VenueInput): {
  valid: boolean;
  error?: string;
  payload?: VenueUpdatePayload;
} {
  const payload: VenueUpdatePayload = {};

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return { valid: false, error: 'Venue name is required' };
    }
    payload.name = (input.name as string).trim();
  }

  if (input.code !== undefined) {
    const codeValidation = validateCode(input.code);
    if (!codeValidation.valid) {
      return { valid: false, error: codeValidation.error };
    }
    payload.code = (input.code as string).toUpperCase();
  }

  if (input.slug !== undefined) {
    const slugValidation = validateSlug(input.slug);
    if (!slugValidation.valid) {
      return { valid: false, error: slugValidation.error };
    }
    payload.slug = input.slug as string;
  }

  if (input.address !== undefined) {
    payload.address = typeof input.address === 'string' ? input.address.trim() || null : null;
  }

  if (input.active !== undefined) {
    payload.active = input.active !== false;
  }

  return { valid: true, payload };
}
