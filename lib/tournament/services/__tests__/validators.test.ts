import { describe, it, expect } from 'vitest';
import { validateTournamentInsertInput } from '../tournaments';
import { validateCategoryInsertInput } from '../categories';
import { validateVenueInsertInput } from '../venues';
import { validateCourtInsertInput } from '../courts';
import { validateCategoryVenueInsertInput } from '../category-venues';

describe('Tournament Validators', () => {
  describe('tournaments', () => {
    it('should validate a valid tournament insert', () => {
      const result = validateTournamentInsertInput({
        name: 'CFYL 2025',
        slug: 'cfyl-2025',
        status: 'upcoming',
      });

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload?.name).toBe('CFYL 2025');
      expect(result.payload?.slug).toBe('cfyl-2025');
    });

    it('should reject tournament without name', () => {
      const result = validateTournamentInsertInput({ slug: 'cfyl-2025' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('name');
    });

    it('should reject invalid slug', () => {
      const result = validateTournamentInsertInput({
        name: 'CFYL 2025',
        slug: 'CFYL_2025',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('lowercase');
    });

    it('should reject date range where start > end', () => {
      const result = validateTournamentInsertInput({
        name: 'CFYL 2025',
        slug: 'cfyl-2025',
        start_date: '2025-12-31',
        end_date: '2025-01-01',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('before or equal');
    });
  });

  describe('categories', () => {
    it('should validate a valid category insert', () => {
      const result = validateCategoryInsertInput({
        tournament_id: 'tournament-123',
        code: 'B-U12',
        name: 'Boys U12',
        gender: 'male',
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.code).toBe('B-U12');
      expect(result.payload?.gender).toBe('male');
    });

    it('should reject invalid gender', () => {
      const result = validateCategoryInsertInput({
        tournament_id: 'tournament-123',
        code: 'B-U12',
        name: 'Boys U12',
        gender: 'mixed-up',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('male');
    });

    it('should uppercase the code', () => {
      const result = validateCategoryInsertInput({
        tournament_id: 'tournament-123',
        code: 'b-u12',
        name: 'Boys U12',
        gender: 'male',
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.code).toBe('B-U12');
    });
  });

  describe('venues', () => {
    it('should validate a valid venue insert', () => {
      const result = validateVenueInsertInput({
        tournament_id: 'tournament-123',
        name: 'V1',
        code: 'V1',
        slug: 'field-1',
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.code).toBe('V1');
      expect(result.payload?.slug).toBe('field-1');
      expect(result.payload?.active).toBe(true);
    });

    it('should reject invalid slug', () => {
      const result = validateVenueInsertInput({
        tournament_id: 'tournament-123',
        name: 'V1',
        code: 'V1',
        slug: 'Field-1',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('lowercase');
    });
  });

  describe('courts', () => {
    it('should validate a valid court insert', () => {
      const result = validateCourtInsertInput({
        venue_id: 'venue-123',
        code: 'COURT-A',
        name: 'Main Court',
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.code).toBe('COURT-A');
      expect(result.payload?.active).toBe(true);
    });

    it('should uppercase the code', () => {
      const result = validateCourtInsertInput({
        venue_id: 'venue-123',
        code: 'court-a',
        name: 'Main Court',
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.code).toBe('COURT-A');
    });
  });

  describe('category-venues', () => {
    it('should validate a valid mapping insert', () => {
      const result = validateCategoryVenueInsertInput({
        category_id: 'category-123',
        venue_id: 'venue-456',
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.category_id).toBe('category-123');
      expect(result.payload?.venue_id).toBe('venue-456');
      expect(result.payload?.is_primary).toBe(true);
    });

    it('should reject missing category_id', () => {
      const result = validateCategoryVenueInsertInput({ venue_id: 'venue-456' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Category');
    });
  });
});
