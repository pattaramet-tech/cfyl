export interface CategoryInput {
  tournament_id?: unknown;
  code?: unknown;
  name?: unknown;
  gender?: unknown;
}

export interface CategoryInsertPayload {
  tournament_id: string;
  code: string;
  name: string;
  gender: string;
}

export interface CategoryUpdatePayload {
  code?: string;
  name?: string;
  gender?: string;
}

const GENDERS = ['male', 'female', 'mixed'];
const CODE_REGEX = /^[A-Z0-9-]+$/;

function validateCode(code: unknown): { valid: boolean; error?: string } {
  if (typeof code !== 'string' || !code.trim()) {
    return { valid: false, error: 'Category code is required' };
  }
  if (!CODE_REGEX.test(code)) {
    return { valid: false, error: 'Category code must contain only uppercase letters, numbers, and hyphens' };
  }
  return { valid: true };
}

function validateGender(gender: unknown): { valid: boolean; error?: string } {
  if (typeof gender !== 'string' || !GENDERS.includes(gender)) {
    return { valid: false, error: `Gender must be one of: ${GENDERS.join(', ')}` };
  }
  return { valid: true };
}

export function validateCategoryInsertInput(input: CategoryInput): {
  valid: boolean;
  error?: string;
  payload?: CategoryInsertPayload;
} {
  if (typeof input.tournament_id !== 'string' || !input.tournament_id.trim()) {
    return { valid: false, error: 'Tournament ID is required' };
  }

  const codeValidation = validateCode(input.code);
  if (!codeValidation.valid) {
    return { valid: false, error: codeValidation.error };
  }

  if (typeof input.name !== 'string' || !input.name.trim()) {
    return { valid: false, error: 'Category name is required' };
  }

  const genderValidation = validateGender(input.gender);
  if (!genderValidation.valid) {
    return { valid: false, error: genderValidation.error };
  }

  return {
    valid: true,
    payload: {
      tournament_id: input.tournament_id,
      code: (input.code as string).toUpperCase(),
      name: (input.name as string).trim(),
      gender: input.gender as string,
    },
  };
}

export function validateCategoryUpdateInput(input: CategoryInput): {
  valid: boolean;
  error?: string;
  payload?: CategoryUpdatePayload;
} {
  const payload: CategoryUpdatePayload = {};

  if (input.code !== undefined) {
    const codeValidation = validateCode(input.code);
    if (!codeValidation.valid) {
      return { valid: false, error: codeValidation.error };
    }
    payload.code = (input.code as string).toUpperCase();
  }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return { valid: false, error: 'Category name is required' };
    }
    payload.name = (input.name as string).trim();
  }

  if (input.gender !== undefined) {
    const genderValidation = validateGender(input.gender);
    if (!genderValidation.valid) {
      return { valid: false, error: genderValidation.error };
    }
    payload.gender = input.gender as string;
  }

  return { valid: true, payload };
}
