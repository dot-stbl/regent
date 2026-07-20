/**
 * L0: DAG utilities — cycle detection + topological sort.
 */

import { describe, expect, it } from 'vitest';

import {
  detectCycles,
  topologicalSort,
  validateAcyclic,
} from '../src/core/dag.js';

describe('detectCycles', () => {
  it('returns null for an empty graph', () => {
    expect(detectCycles([], new Map())).toBeNull();
  });

  it('returns null for a DAG with no cycles', () => {
    const deps = new Map([
      ['b', ['a']],
      ['c', ['a']],
      ['d', ['b', 'c']],
    ]);
    expect(detectCycles(['a', 'b', 'c', 'd'], deps)).toBeNull();
  });

  it('returns null for a fully disconnected graph', () => {
    expect(detectCycles(['a', 'b', 'c'], new Map())).toBeNull();
  });

  it('detects a self-loop', () => {
    const deps = new Map<string, readonly string[]>([['a', ['a']]]);
    const cycle = detectCycles(['a'], deps);
    expect(cycle).not.toBeNull();
    expect(cycle!.cycle).toEqual(['a', 'a']);
  });

  it('detects a 2-node cycle (A → B → A)', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const cycle = detectCycles(['a', 'b'], deps);
    expect(cycle).not.toBeNull();
    // Cycle starts at the back-edge target (where the cycle was
    // re-entered) and returns to it.
    expect(cycle!.cycle).toEqual(['a', 'b', 'a']);
  });

  it('detects a 3-node cycle (A → B → C → A)', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycle = detectCycles(['a', 'b', 'c'], deps);
    expect(cycle).not.toBeNull();
    // Same shape: [back-edge-target, ..., target] closing the loop.
    expect(cycle!.cycle).toEqual(['a', 'b', 'c', 'a']);
  });

  it('detects a cycle nested inside a larger DAG', () => {
    // a → b → c → d, and x → y → x (cycle)
    const deps = new Map<string, readonly string[]>([
      ['b', ['a']],
      ['c', ['b']],
      ['d', ['c']],
      ['y', ['x']],
      ['x', ['y']],
    ]);
    const cycle = detectCycles(['a', 'b', 'c', 'd', 'x', 'y'], deps);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!.cycle)).toEqual(new Set(['x', 'y']));
  });

  it('handles nodes not present in the deps map', () => {
    const deps = new Map<string, readonly string[]>([['b', ['a']]]);
    expect(detectCycles(['a', 'b', 'c'], deps)).toBeNull();
  });
});

describe('topologicalSort', () => {
  it('sorts a linear chain', () => {
    const deps = new Map([
      ['b', ['a']],
      ['c', ['b']],
    ]);
    const sorted = topologicalSort(['c', 'a', 'b'], deps);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });

  it('sorts a diamond', () => {
    // a → b, a → c, b → d, c → d
    const deps = new Map([
      ['b', ['a']],
      ['c', ['a']],
      ['d', ['b', 'c']],
    ]);
    const sorted = topologicalSort(['d', 'c', 'b', 'a'], deps);
    expect(sorted[0]).toBe('a');
    expect(sorted[3]).toBe('d');
    // b and c both come after a and before d — order between them is
    // not guaranteed.
    expect(sorted.slice(1, 3)).toEqual(expect.arrayContaining(['b', 'c']));
  });

  it('throws on cycle', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    expect(() => topologicalSort(['a', 'b'], deps)).toThrow(/cycle/);
  });

  it('handles nodes with no dependencies', () => {
    const sorted = topologicalSort(['a', 'b', 'c'], new Map());
    expect(sorted).toHaveLength(3);
    expect(new Set(sorted)).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('validateAcyclic', () => {
  it('does not throw on DAG', () => {
    const deps = new Map([['b', ['a']]]);
    expect(() => validateAcyclic(['a', 'b'], deps)).not.toThrow();
  });

  it('throws with cycle path on cycle', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    expect(() => validateAcyclic(['a', 'b'], deps)).toThrow(/a.*b.*a/s);
  });
});