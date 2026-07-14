export interface TournamentInput {
  name?: unknown;
  slug?: unknown;
  status?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  organizer?: unknown;
}

export interface TournamentInsertPayload {
  name: string;
  slug: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  organizer: string | null;
}

export interface TournamentUpdatePayload {
  name?: string;
  slug?: string;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  organizer?: string | null;
}

const TOURNAMENT_STATUSES = ['upcoming', 'active', 'completed', 'archived'];
const SLUG_REGEX = /^[a-z0-9-]+$/;

function validateSlug(slug: unknown): { valid: boolean; error?: string } {
  if (typeof slug !== 'string' || !slug.trim()) {
    return { valid: false, error: 'Slug is required' };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { valid: false, error: 'Slug must contain only lowercase letters, numbers, and hyphens' };
  }
  return { valid: true };
}

function validateStatus(status: unknown): { valid: boolean; error?: string } {
  if (typeof status !== 'string' || !TOURNAMENT_STATUSES.includes(status)) {
    return { valid: false, error: `Status must be one of: ${TOURNAMENT_STATUSES.join(', ')}` };
  }
  return { valid: true };
}

function validateDateRange(
  startDate: unknown,
  endDate: unknown
): { valid: boolean; error?: string } {
  if (!startDate && !endDate) {
    return { valid: true };
  }
  if (startDate && typeof startDate !== 'string') {
    return { valid: false, error: 'Start date must be a valid date string' };
  }
  if (endDate && typeof endDate !== 'string') {
    return { valid: false, error: 'End date must be a valid date string' };
  }
  if (startDate && endDate && startDate > endDate) {
    return { valid: false, error: 'Start date must be before or equal to end date' };
  }
  return { valid: true };
}

export function validateTournamentInsertInput(input: TournamentInput): {
  valid: boolean;
  error?: string;
  payload?: TournamentInsertPayload;
} {
  if (typeof input.name !== 'string' || !input.name.trim()) {
    return { valid: false, error: 'Tournament name is required' };
  }

  const slugValidation = validateSlug(input.slug);
  if (!slugValidation.valid) {
    return { valid: false, error: slugValidation.error };
  }

  const statusValidation = validateStatus(input.status || 'upcoming');
  if (!statusValidation.valid) {
    return { valid: false, error: statusValidation.error };
  }

  const dateValidation = validateDateRange(input.start_date, input.end_date);
  if (!dateValidation.valid) {
    return { valid: false, error: dateValidation.error };
  }

  return {
    valid: true,
    payload: {
      name: input.name.trim(),
      slug: input.slug as string,
      status: (input.status as string) || 'upcoming',
      start_date: typeof input.start_date === 'string' ? input.start_date : null,
      end_date: typeof input.end_date === 'string' ? input.end_date : null,
      organizer: typeof input.organizer === 'string' ? input.organizer.trim() || null : null,
    },
  };
}

export function validateTournamentUpdateInput(input: TournamentInput): {
  valid: boolean;
  error?: string;
  payload?: TournamentUpdatePayload;
} {
  const payload: TournamentUpdatePayload = {};

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return { valid: false, error: 'Tournament name is required' };
    }
    payload.name = input.name.trim();
  }

  if (input.slug !== undefined) {
    const slugValidation = validateSlug(input.slug);
    if (!slugValidation.valid) {
      return { valid: false, error: slugValidation.error };
    }
    payload.slug = input.slug as string;
  }

  if (input.status !== undefined) {
    const statusValidation = validateStatus(input.status);
    if (!statusValidation.valid) {
      return { valid: false, error: statusValidation.error };
    }
    payload.status = input.status as string;
  }

  if (input.start_date !== undefined || input.end_date !== undefined) {
    const dateValidation = validateDateRange(input.start_date, input.end_date);
    if (!dateValidation.valid) {
      return { valid: false, error: dateValidation.error };
    }
    if (input.start_date !== undefined) {
      payload.start_date = typeof input.start_date === 'string' ? input.start_date : null;
    }
    if (input.end_date !== undefined) {
      payload.end_date = typeof input.end_date === 'string' ? input.end_date : null;
    }
  }

  if (input.organizer !== undefined) {
    payload.organizer = typeof input.organizer === 'string' ? input.organizer.trim() || null : null;
  }

  return { valid: true, payload };
}
