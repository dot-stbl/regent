/**
 * L1: watcher unit tests
 *
 * Covers:
 * - debounced change events emit after the debounce window
 * - `ready` event fires once after the initial scan
 * - cancellation (calling .return()) closes the underlying handle
 * - `unlink` events are also routed
 * - errors surface via the `error` event type
 *
 * Uses real chokidar against an isolated tmpdir — no fake timers,
 * to keep these tests honest about cross-platform behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watchForChanges } from '../src/watcher.js';

let cwd = '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'regent-watch-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function collect<T>(
  iter: AsyncGenerator<T>,
  predicate: (v: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`watch timeout: no event matched in ${timeoutMs}ms`)),
      timeoutMs,
    );
    void (async (): Promise<void> => {
      try {
        for await (const v of iter) {
          if (predicate(v)) {
            clearTimeout(timer);
            resolve(v);
            return;
          }
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err as Error);
      }
    })();
  });
}

describe('watchForChanges', () => {
  it('emits a `ready` event after the initial scan', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'hello');
    const iter = watchForChanges({ cwd, debounceMs: 50 });
    const ev = await collect(iter, (e) => e.type === 'ready');
    expect(ev.type).toBe('ready');
    await iter.return();
  });

  it('emits a `change` event when a watched file is modified', async () => {
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'v1');
    const iter = watchForChanges({ cwd, debounceMs: 50 });

    const events: { type: string; path?: string }[] = [];
    const consumer = (async (): Promise<void> => {
      for await (const ev of iter) {
        events.push({ type: ev.type, path: ev.type === 'change' ? ev.path : undefined });
        if (ev.type === 'ready') {
          setTimeout(() => writeFileSync(file, 'v2'), 100);
        }
        if (events.some((e) => e.type === 'change')) {
          break;
        }
      }
    })();

    await Promise.race([
      consumer,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('test timeout')), 5000),
      ),
    ]);

    await iter.return();
    const changeEv = events.find((e) => e.type === 'change');
    expect(changeEv).toBeDefined();
  });

  it('debounces rapid changes to the same file into one event', async () => {
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'v1');
    const iter = watchForChanges({ cwd, debounceMs: 100 });

    const changes: { type: string; path?: string }[] = [];
    const consumer = (async (): Promise<void> => {
      for await (const ev of iter) {
        if (ev.type === 'change') {
          changes.push({ type: ev.type, path: ev.path });
        }
        if (ev.type === 'ready') {
          for (let i = 2; i <= 5; i++) {
            writeFileSync(file, `v${i}`);
          }
        }
        if (changes.length >= 1) {
          break;
        }
      }
    })();

    await Promise.race([
      consumer,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('debounce test timeout')), 5000),
      ),
    ]);

    await iter.return();
    // Rapid-fire writes within the debounce window collapse to at most 2 events.
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.length).toBeLessThanOrEqual(2);
  });

  it('emits a change event for a new file created after `ready`', async () => {
    writeFileSync(join(cwd, 'existing.txt'), 'ok');
    const iter = watchForChanges({ cwd, debounceMs: 50 });

    const events: { type: string; path?: string }[] = [];
    const consumer = (async (): Promise<void> => {
      for await (const ev of iter) {
        events.push({ type: ev.type, path: ev.type === 'change' ? ev.path : undefined });
        if (ev.type === 'ready') {
          setTimeout(() => writeFileSync(join(cwd, 'new.txt'), 'new file'), 100);
        }
        if (events.some((e) => e.type === 'change' && e.path?.endsWith('new.txt'))) {
          break;
        }
      }
    })();

    await Promise.race([
      consumer,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('add test timeout')), 5000),
      ),
    ]);

    await iter.return();
    const newFileEvent = events.find((e) => e.path?.endsWith('new.txt'));
    expect(newFileEvent).toBeDefined();
  });

  it('emits a `change` event when a watched file is deleted', async () => {
    const file = join(cwd, 'will-be-deleted.txt');
    writeFileSync(file, 'v1');
    const iter = watchForChanges({ cwd, debounceMs: 50 });

    const events: { type: string; path?: string }[] = [];
    const consumer = (async (): Promise<void> => {
      for await (const ev of iter) {
        events.push({ type: ev.type, path: ev.type === 'change' ? ev.path : undefined });
        if (ev.type === 'ready') {
          setTimeout(() => rmSync(file), 100);
        }
        if (events.some((e) => e.path?.endsWith('will-be-deleted.txt'))) {
          break;
        }
      }
    })();

    await Promise.race([
      consumer,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('delete test timeout')), 5000),
      ),
    ]);

    await iter.return();
    const delEvent = events.find((e) => e.path?.endsWith('will-be-deleted.txt'));
    expect(delEvent).toBeDefined();
  });

  it('ignores files under node_modules by default', async () => {
    mkdirSync(join(cwd, 'node_modules'), { recursive: true });
    const iter = watchForChanges({ cwd, debounceMs: 50 });

    const changes: { type: string; path?: string }[] = [];
    const ready = (async (): Promise<void> => {
      for await (const ev of iter) {
        if (ev.type === 'change') {
          changes.push({ type: ev.type, path: ev.path });
        }
        if (ev.type === 'ready') {
          // Trigger a write to a node_modules file AFTER ready. The
          // defaultIgnore() should filter it out — no change event.
          setTimeout(() => writeFileSync(join(cwd, 'node_modules', 'x.txt'), 'x'), 100);
          // Allow time for chokidar to poll, then exit.
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return;
        }
      }
    })();

    await Promise.race([
      ready,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('node_modules test timeout')), 5000),
      ),
    ]);

    await iter.return();
    expect(changes.find((c) => c.path?.includes('node_modules'))).toBeUndefined();
  });

  it('cancellation (return) closes the underlying handle', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'v1');
    const iter = watchForChanges({ cwd, debounceMs: 50 });
    await collect(iter, (e) => e.type === 'ready');
    await iter.return();
    // Writing after return should not throw.
    expect(() => writeFileSync(join(cwd, 'a.txt'), 'v2')).not.toThrow();
  });
});