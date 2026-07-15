export interface CategoryVenueInput {
  category_id?: unknown;
  venue_id?: unknown;
  is_primary?: unknown;
}

export interface CategoryVenueInsertPayload {
  category_id: string;
  venue_id: string;
  is_primary: boolean;
}

export interface CategoryVenueUpdatePayload {
  venue_id?: string;
  is_primary?: boolean;
}

export function validateCategoryVenueInsertInput(input: CategoryVenueInput): {
  valid: boolean;
  error?: string;
  payload?: CategoryVenueInsertPayload;
} {
  if (typeof input.category_id !== 'string' || !input.category_id.trim()) {
    return { valid: false, error: 'Category ID is required' };
  }

  if (typeof input.venue_id !== 'string' || !input.venue_id.trim()) {
    return { valid: false, error: 'Venue ID is required' };
  }

  return {
    valid: true,
    payload: {
      category_id: input.category_id,
      venue_id: input.venue_id,
      is_primary: input.is_primary !== false,
    },
  };
}

export function validateCategoryVenueUpdateInput(input: CategoryVenueInput): {
  valid: boolean;
  error?: string;
  payload?: CategoryVenueUpdatePayload;
} {
  const payload: CategoryVenueUpdatePayload = {};

  if (input.venue_id !== undefined) {
    if (typeof input.venue_id !== 'string' || !input.venue_id.trim()) {
      return { valid: false, error: 'Venue ID is required' };
    }
    payload.venue_id = input.venue_id;
  }

  if (input.is_primary !== undefined) {
    payload.is_primary = input.is_primary !== false;
  }

  return { valid: true, payload };
}
