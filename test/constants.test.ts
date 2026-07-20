/**
 * L0: pure-unit — type checks / constants.ts export.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTEXT_BUFFER } from '../src/constants.js';

describe('DEFAULT_CONTEXT_BUFFER', () => {
  it('is 3', () => {
    expect(DEFAULT_CONTEXT_BUFFER).toBe(3);
  });

  it('is exported as a constant', () => {
    expect(typeof DEFAULT_CONTEXT_BUFFER).toBe('number');
  });
});
