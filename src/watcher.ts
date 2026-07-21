/**
 * File-system watcher wrapper around chokidar.
 *
 * Used by `regent check --watch` (issue #26). Emits debounced events
 * for add / change / unlink so the runner can invalidate cache entries
 * and re-scan.
 *
 * Behaviour:
 *
 * - Watches `cwd` recursively.
 * - Filters out `node_modules`, `.git`, `dist`, `bin`, `obj` (the same
 *   excludes the runner uses).
 * - 100ms debounce per path: rapid editor save-then-restart events
 *   collapse into one.
 * - Emits `{ type: 'ready' }` once chokidar finishes the initial scan,
 *   so the caller knows when steady state has been reached.
 * - Cancellation (calling `.return()` on the async iterator, or Ctrl-C
 *   breaking the for-await-of) closes the underlying chokidar handle.
 */

import { watch, type FSWatcher } from 'chokidar';

import { DEFAULT_EXCLUDE_PATHS } from './core/scanner-defaults.js';

export type WatchEvent =
  | { type: 'ready' }
  | { type: 'add'; path: string }
  | { type: 'change'; path: string }
  | { type: 'unlink'; path: string }
  | { type: 'error'; err: Error };

export interface WatchOptions {
  readonly cwd: string;
  /** Per-path filter; return `true` to skip. Defaults to runner excludes. */
  readonly ignore?: (relPath: string) => boolean;
  /** Per-path debounce in ms. Default 100. */
  readonly debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Walk through path using forward slashes for comparison with the
 * runner's excludes (which use `/` regardless of OS).
 */
function toForward(p: string): string {
  return p.split('\\').join('/');
}

function defaultIgnore(relPath: string): boolean {
  const fwd = toForward(relPath);
  for (const pattern of DEFAULT_EXCLUDE_PATHS) {
    if (matchGlob(fwd, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Minimal glob matcher for double-star patterns only — supports the
 * patterns the runner's DEFAULT_EXCLUDE_PATHS uses (e.g. ** /node_modules / **,
 * ** /dist / **). Not a general-purpose globber.
 */
function matchGlob(path: string, pattern: string): boolean {
  // Translate the pattern into a RegExp. The escaping set covers every
  // regex meta-character that could appear inside our glob patterns;
  // all other characters pass through as-is.
  const META_CHARS = /[.+^$(){}|[\]\\]/g;
  const regexSource = pattern
    .replace(META_CHARS, '\\$&')
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '.*');
  return new RegExp('^' + regexSource + '$').test(path);
}

/**
 * Async generator yielding debounced watcher events. The chokidar
 * FSWatcher is closed when the generator's `.return()` is called (or
 * the for-await-of loop exits via break / Ctrl-C).
 */
export async function* watchForChanges(
  opts: WatchOptions,
): AsyncGenerator<WatchEvent> {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const ignore = opts.ignore ?? defaultIgnore;

  // chokidar FSWatcher is an EventEmitter — bridge it into an async queue.
  const queue: WatchEvent[] = [];
  const waiters: Array<(v: IteratorResult<WatchEvent>) => void> = [];
  let closed = false;

  const enqueue = (event: WatchEvent): void => {
    if (closed) {
      return;
    }
    const w = waiters.shift();
    if (w) {
      w({ value: event, done: false });
    } else {
      queue.push(event);
    }
  };

  const fsw: FSWatcher = watch(opts.cwd, {
    ignored: (relPath: string) => {
      // chokidar 4 passes an absolute path here; strip cwd prefix for
      // glob comparison against runner excludes.
      const abs = relPath;
      const rel = abs.startsWith(opts.cwd)
        ? abs.slice(opts.cwd.length).replace(/^[\\/]/, '')
        : abs;
      return ignore(rel);
    },
    // With polling on Windows, chokidar re-fires `add` events for
    // unchanged files on every poll cycle; suppress those so we only
    // see real changes. `ready` still fires once at the end of the
    // initial scan.
    ignoreInitial: true,
    persistent: true,
    // chokidar's default fs.watch backend is unreliable on Windows for
    // subsequent modifications after the initial scan; polling is the
    // portable fallback. Intervals tuned so the worst-case detection
    // latency is well under the 100ms debounce the runner expects.
    usePolling: true,
    interval: 100,
    binaryInterval: 200,
  });

  // Per-path debounce: only forward the LAST event for a path within
  // the debounce window. `awaitWriteFinish` already provides this
  // semantically (chokidar holds the event until the file stops
  // changing) — what we add on top is: if two distinct paths change
  // close together, batch them into one iterator step instead of
  // yielding N events back-to-back. Useful when an editor saves N files.
  const pendingPaths = new Set<string>();
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPending = (): void => {
    if (pendingPaths.size === 0) {
      return;
    }
    const snapshot = [...pendingPaths];
    pendingPaths.clear();
    for (const p of snapshot) {
      enqueue({ type: 'change', path: p });
    }
  };

  fsw.on('add', (path) => {
    const rel = relativePath(opts.cwd, path);
    pendingPaths.add(rel);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(flushPending, debounceMs);
  });
  fsw.on('change', (path) => {
    const rel = relativePath(opts.cwd, path);
    pendingPaths.add(rel);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(flushPending, debounceMs);
  });
  fsw.on('unlink', (path) => {
    const rel = relativePath(opts.cwd, path);
    pendingPaths.add(rel);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(flushPending, debounceMs);
  });
  fsw.on('ready', () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingPaths.clear();
    enqueue({ type: 'ready' });
  });
  fsw.on('error', (err) => {
    enqueue({ type: 'error', err: err instanceof Error ? err : new Error(String(err)) });
  });

  try {
    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      const next = await new Promise<IteratorResult<WatchEvent>>((resolve) => {
        waiters.push(resolve);
      });
      if (next.done) {
        break;
      }
      yield next.value;
    }
  } finally {
    closed = true;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    await fsw.close();
  }
}

function relativePath(cwd: string, abs: string): string {
  if (abs.startsWith(cwd)) {
    const rel = abs.slice(cwd.length);
    return rel.replace(/^[\\/]/, '');
  }
  return abs;
}