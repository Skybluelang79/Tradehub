import { describe, it, expect } from 'vitest';
import {
  formatDistance,
  formatPrice,
  formatDate,
  truncateText,
  validateEmail,
  validatePhone,
} from './helpers.js';

describe('formatDistance', () => {
  it('formats sub-kilometer distances in meters', () => {
    expect(formatDistance(0.5)).toBe('500m');
  });

  it('formats kilometer distances with one decimal', () => {
    expect(formatDistance(2.35)).toBe('2.4km');
  });
});

describe('formatPrice', () => {
  it('formats whole-dollar amounts', () => {
    expect(formatPrice(25)).toBe('$25');
  });

  it('supports other currencies', () => {
    expect(formatPrice(100, 'EUR')).toBe('€100');
  });
});

describe('formatDate', () => {
  it('returns "Just now" for recent timestamps', () => {
    expect(formatDate(new Date().toISOString())).toBe('Just now');
  });

  it('returns relative minutes', () => {
    const past = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatDate(past)).toBe('5m ago');
  });
});

describe('truncateText', () => {
  it('returns short text unchanged', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('truncates long text with an ellipsis', () => {
    expect(truncateText('hello world', 5)).toBe('hello...');
  });
});

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validateEmail('user@')).toBe(false);
  });
});

describe('validatePhone', () => {
  it('accepts formatted phone numbers', () => {
    expect(validatePhone('+1 555-123-4567')).toBe(true);
  });

  it('rejects short numbers', () => {
    expect(validatePhone('123')).toBe(false);
  });
});
