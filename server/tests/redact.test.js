import { describe, it, expect } from '@jest/globals';
import { redactSensitive } from '../src/errorHandler.js';

describe('redactSensitive', () => {
  it('masks passwords, tokens, OTPs and card fields at any depth', () => {
    const body = {
      email: 'admin@tradehub.com',
      password: 'hunter2',
      nested: { refreshToken: 'abc', cvv: '123', keep: 'ok' },
      items: [{ card_number: '4242', note: 'hello' }],
    };

    const out = redactSensitive(body);

    expect(out.email).toBe('admin@tradehub.com');
    expect(out.password).toBe('[redacted]');
    expect(out.nested.refreshToken).toBe('[redacted]');
    expect(out.nested.cvv).toBe('[redacted]');
    expect(out.nested.keep).toBe('ok');
    expect(out.items[0].card_number).toBe('[redacted]');
    expect(out.items[0].note).toBe('hello');
  });

  it('leaves non-object input untouched', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive('text')).toBe('text');
    expect(redactSensitive(42)).toBe(42);
  });

  it('does not mutate the original body', () => {
    const body = { password: 'secret', data: { api_key: 'k' } };

    redactSensitive(body);

    expect(body.password).toBe('secret');
    expect(body.data.api_key).toBe('k');
  });
});
