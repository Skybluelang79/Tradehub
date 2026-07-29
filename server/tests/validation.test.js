import { describe, it, expect } from '@jest/globals';
import {
  signupSchema, loginSchema, createItemSchema,
  createReviewSchema, createReportSchema,
  createDisputeSchema, createPromotionSchema,
  changePasswordSchema, forgotPasswordSchema,
} from '../src/validation.js';

describe('Auth Validation', () => {
  it('signupSchema - valid data', () => {
    const r = signupSchema.safeParse({ name: 'Test', email: 'test@test.com', password: '123456' });
    expect(r.success).toBe(true);
  });

  it('signupSchema - short password', () => {
    const r = signupSchema.safeParse({ name: 'Test', email: 'test@test.com', password: '123' });
    expect(r.success).toBe(false);
  });

  it('signupSchema - invalid email', () => {
    const r = signupSchema.safeParse({ name: 'Test', email: 'bad', password: '123456' });
    expect(r.success).toBe(false);
  });

  it('signupSchema - empty name', () => {
    const r = signupSchema.safeParse({ name: '', email: 'test@test.com', password: '123456' });
    expect(r.success).toBe(false);
  });

  it('loginSchema - valid data', () => {
    const r = loginSchema.safeParse({ email: 'test@test.com', password: 'secret' });
    expect(r.success).toBe(true);
  });

  it('loginSchema - missing password', () => {
    const r = loginSchema.safeParse({ email: 'test@test.com' });
    expect(r.success).toBe(false);
  });

  it('changePasswordSchema - valid', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'newpass' });
    expect(r.success).toBe(true);
  });

  it('changePasswordSchema - short new password', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: '123' });
    expect(r.success).toBe(false);
  });

  it('forgotPasswordSchema - invalid email', () => {
    const r = forgotPasswordSchema.safeParse({ email: 'not-email' });
    expect(r.success).toBe(false);
  });
});

describe('Item Validation', () => {
  it('createItemSchema - valid data', () => {
    const r = createItemSchema.safeParse({
      title: 'Test Item',
      price: 10.99,
      category: 'electronics',
    });
    expect(r.success).toBe(true);
  });

  it('createItemSchema - missing title', () => {
    const r = createItemSchema.safeParse({ price: 10.99, category: 'electronics' });
    expect(r.success).toBe(false);
  });

  it('createItemSchema - negative price', () => {
    const r = createItemSchema.safeParse({ title: 'Test', price: -5, category: 'test' });
    expect(r.success).toBe(false);
  });

  it('createItemSchema - zero price', () => {
    const r = createItemSchema.safeParse({ title: 'Test', price: 0, category: 'test' });
    expect(r.success).toBe(false);
  });

  it('createItemSchema - with variants', () => {
    const r = createItemSchema.safeParse({
      title: 'Test',
      price: 25,
      category: 'clothing',
      variants: [{ name: 'Size', values: ['S', 'M', 'L'] }],
    });
    expect(r.success).toBe(true);
  });

  it('createItemSchema - with sale price', () => {
    const r = createItemSchema.safeParse({
      title: 'Test',
      price: 100,
      sale_price: 75,
      category: 'electronics',
    });
    expect(r.success).toBe(true);
  });
});

describe('Review Validation', () => {
  it('createReviewSchema - valid', () => {
    const r = createReviewSchema.safeParse({ revieweeId: 'user123', rating: 5, text: 'Great!' });
    expect(r.success).toBe(true);
  });

  it('createReviewSchema - rating out of range', () => {
    const r = createReviewSchema.safeParse({ revieweeId: 'user123', rating: 6 });
    expect(r.success).toBe(false);
  });

  it('createReviewSchema - rating too low', () => {
    const r = createReviewSchema.safeParse({ revieweeId: 'user123', rating: 0 });
    expect(r.success).toBe(false);
  });
});

describe('Report Validation', () => {
  it('createReportSchema - valid', () => {
    const r = createReportSchema.safeParse({ itemId: 'item123', reason: 'Spam' });
    expect(r.success).toBe(true);
  });

  it('createReportSchema - missing reason', () => {
    const r = createReportSchema.safeParse({ itemId: 'item123' });
    expect(r.success).toBe(false);
  });
});

describe('Dispute Validation', () => {
  it('createDisputeSchema - valid', () => {
    const r = createDisputeSchema.safeParse({ transactionId: 'txn123', reason: 'Item not received' });
    expect(r.success).toBe(true);
  });

  it('createDisputeSchema - missing fields', () => {
    const r = createDisputeSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('Promotion Validation', () => {
  it('createPromotionSchema - percentage discount', () => {
    const r = createPromotionSchema.safeParse({
      code: 'SAVE20', discount_type: 'percentage', discount_value: 20,
    });
    expect(r.success).toBe(true);
  });

  it('createPromotionSchema - fixed discount', () => {
    const r = createPromotionSchema.safeParse({
      code: 'SAVE5', discount_type: 'fixed', discount_value: 5,
    });
    expect(r.success).toBe(true);
  });

  it('createPromotionSchema - invalid type', () => {
    const r = createPromotionSchema.safeParse({
      code: 'BAD', discount_type: 'invalid', discount_value: 10,
    });
    expect(r.success).toBe(false);
  });

  it('createPromotionSchema - short code', () => {
    const r = createPromotionSchema.safeParse({
      code: 'AB', discount_type: 'percentage', discount_value: 10,
    });
    expect(r.success).toBe(false);
  });
});
