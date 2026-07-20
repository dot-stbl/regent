/**
 * L0: safeLogPayload redacts forbidden keys (matchText, pattern, path)
 * before they reach pino. Defence-in-depth: pino redact also configured
 * in createLogger — this layer catches cases where redact isn't applied.
 */

import { describe, expect, it } from 'vitest';

import { safeLog, safeLogPayload } from '../src/logging/levels.js';

describe('safeLogPayload', () => {
  it('passes through safe keys', () => {
    const out = safeLogPayload({
      ruleId: 'csharp.no-region',
      count: 3,
      durationMs: 42,
    });
    expect(out).toEqual({
      ruleId: 'csharp.no-region',
      count: 3,
      durationMs: 42,
    });
  });

  it('redacts matchText, pattern, and path at the top level', () => {
    const out = safeLogPayload({
      ruleId: 'csharp.no-region',
      matchText: '    #region Properties',
      pattern: '^\\s*#region',
      path: '/secret/path/to/file.cs',
    });
    expect(out['ruleId']).toBe('csharp.no-region');
    expect(out['matchText']).toBe('<redacted>');
    expect(out['pattern']).toBe('<redacted>');
    expect(out['path']).toBe('<redacted>');
  });

  it('redacts nested forbidden keys', () => {
    const out = safeLogPayload({
      runner: {
        ruleId: 'csharp.no-region',
        matchText: 'leak',
      },
    });
    const runner = out['runner'] as Record<string, unknown>;
    expect(runner['matchText']).toBe('<redacted>');
    expect(runner['ruleId']).toBe('csharp.no-region');
  });

  it('does not mutate the input object', () => {
    const input = { ruleId: 'x', matchText: 'leak' };
    const out = safeLogPayload(input);
    expect(input['matchText']).toBe('leak'); // unchanged
    expect(out['matchText']).toBe('<redacted>');
  });

  it('preserves arrays', () => {
    const out = safeLogPayload({
      ruleIds: ['a', 'b', 'c'],
      matchText: 'leak',
    });
    expect(out['ruleIds']).toEqual(['a', 'b', 'c']);
    expect(out['matchText']).toBe('<redacted>');
  });
});

describe('safeLog', () => {
  it('dispatches to the right logger level with redacted payload', () => {
    const calls: Array<{ level: string; obj: unknown; msg?: string }> = [];
    const fakeLogger = {
      trace: (obj: unknown, msg?: string) => calls.push({ level: 'trace', obj, msg }),
      debug: (obj: unknown, msg?: string) => calls.push({ level: 'debug', obj, msg }),
      info:  (obj: unknown, msg?: string) => calls.push({ level: 'info', obj, msg }),
      warn:  (obj: unknown, msg?: string) => calls.push({ level: 'warn', obj, msg }),
      error: (obj: unknown, msg?: string) => calls.push({ level: 'error', obj, msg }),
      fatal: (obj: unknown, msg?: string) => calls.push({ level: 'fatal', obj, msg }),
    };

    safeLog(fakeLogger, 'info', { ruleId: 'x', matchText: 'leak' }, 'hello');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.level).toBe('info');
    expect(calls[0]!.msg).toBe('hello');
    expect((calls[0]!.obj as Record<string, unknown>)['matchText']).toBe('<redacted>');
  });

  it('dispatches each log level', () => {
    const seen: string[] = [];
    const fakeLogger = {
      trace: () => seen.push('trace'),
      debug: () => seen.push('debug'),
      info:  () => seen.push('info'),
      warn:  () => seen.push('warn'),
      error: () => seen.push('error'),
      fatal: () => seen.push('fatal'),
    };

    for (const lvl of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      safeLog(fakeLogger, lvl, { ruleId: 'x' });
    }
    expect(seen).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });
});