/**
 * L1: review reporter — markdown + JSON output for `regent review` subcommand.
 */

import { describe, expect, it } from 'vitest';
import type { AcceptEntry, Finding } from '../src/types.js';
import { renderReview, renderReviewJson } from '../src/reporter/review.js';

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: 'csharp.no-todo-without-owner',
  severity: 'warning',
  path: '/abs/src/Baz.cs',
  match: {
    startLine: 41,
    startColumn: 0,
    endLine: 41,
    endColumn: 24,
    matchText: '    // TODO follow-up',
  },
  context: {
    startLine: 38,
    endLine: 44,
    lines: ['public void Foo() {', '// TODO follow-up', '}'],
  },
  message: 'TODO без owner',
  source: 'code-shape.md#todo',
  status: 'pending',
  review: {
    guidance: 'add ticket ref',
    exitBehavior: 'unreviewed-fails',
  },
  ...overrides,
});

describe('renderReview', () => {
  it('returns empty when no pending findings', () => {
    const out = renderReview([], [], { cwd: '/abs' });
    expect(out).toBe('');
  });

  it('renders markdown with heading + body + guidance for each pending', () => {
    const out = renderReview([baseFinding()], [], { cwd: '/abs' });
    expect(out).toContain('# regent review candidates');
    expect(out).toContain('## `src/Baz.cs:42`');
    expect(out).toContain('csharp.no-todo-without-owner');
    expect(out).toContain('TODO follow-up');
    expect(out).toContain('add ticket ref');
    expect(out).toContain('unreviewed-fails');
  });

  it('--include-accepted renders audit view with accepted + accept-entries', () => {
    const accepted = baseFinding({
      status: 'accepted',
      acceptedReason: 'tracked in ANL-200',
    });
    const accepts: AcceptEntry[] = [
      {
        ruleId: 'csharp.no-todo-without-owner',
        path: '/abs/src/Old.cs',
        reason: 'legacy, see migration plan',
      },
    ];
    const out = renderReview([accepted], accepts, {
      cwd: '/abs',
      includeAccepted: true,
    });
    expect(out).toContain('# regent audit');
    expect(out).toContain('## Accepted');
    expect(out).toContain('tracked in ANL-200');
    expect(out).toContain('## Accept entries (configured)');
    expect(out).toContain('legacy, see migration plan');
  });
});

describe('renderReviewJson', () => {
  it('emits structured entry per pending finding', () => {
    const out = renderReviewJson([baseFinding()], [], { cwd: '/abs' });
    const parsed = JSON.parse(out);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].ruleId).toBe('csharp.no-todo-without-owner');
    expect(parsed.entries[0].path).toBe('src/Baz.cs');
    expect(parsed.entries[0].line).toBe(42);
    expect(parsed.entries[0].guidance).toBe('add ticket ref');
    expect(parsed.entries[0].exitBehavior).toBe('unreviewed-fails');
    expect(parsed.entries[0].status).toBe('pending');
  });

  it('excludes accepted findings by default', () => {
    const out = renderReviewJson([
      baseFinding(),
      baseFinding({ status: 'accepted', acceptedReason: 'audit' }),
    ], [], { cwd: '/abs' });
    const parsed = JSON.parse(out);
    expect(parsed.entries).toHaveLength(1);
  });

  it('includes accepted + accepts when --include-accepted', () => {
    const accepts: AcceptEntry[] = [{
      ruleId: 'csharp.no-todo-without-owner',
      path: '/abs/src/Old.cs',
      reason: 'legacy',
    }];
    const out = renderReviewJson([
      baseFinding({ status: 'accepted', acceptedReason: 'audit' }),
    ], accepts, { cwd: '/abs', includeAccepted: true });
    const parsed = JSON.parse(out);
    expect(parsed.entries.some((e: { status: string }) => e.status === 'accepted')).toBe(true);
  });
});
