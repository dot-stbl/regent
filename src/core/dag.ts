// DAG (directed acyclic graph) utilities for inter-rule dependencies.
//
// Used by the runner to:
//   - topologically sort rules so that `dependsOn` runs first
//   - detect cycles at startup (fail-fast, not at first match)
//
// API:
//   topologicalSort(nodes, deps) — returns nodes in dependency order
//   detectCycles(nodes, deps) — returns the cycle path, or null
//   validateAcyclic(nodes, deps) — throws on cycle

/**
 * Adjacency representation of a dependency graph: each node maps to
 * the list of nodes it depends on. Used as input to every helper in
 * this module.
 */
export type DependencyMap<T> = ReadonlyMap<T, readonly T[]>;

/**
 * Result of `detectCycles` when a cycle exists. `cycle` is the path
 * that closes back on itself: the first and last node are equal, and
 * every consecutive pair is a dependency edge.
 */
export interface CycleError<T> {
  readonly cycle: readonly T[];
}

/**
 * Detect cycles in a dependency graph. Returns the cycle path
 * (starting and ending with the same node) if one exists; otherwise
 * null.
 *
 * Uses iterative DFS with a color map (white/grey/black) — no
 * recursion, safe on graphs up to several thousand nodes.
 */
export function detectCycles<T>(
  nodes: readonly T[],
  deps: DependencyMap<T>,
): CycleError<T> | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<T, number>();
  for (const node of nodes) {
    color.set(node, WHITE);
  }

  for (const start of nodes) {
    if (color.get(start) !== WHITE) {
      continue;
    }
    const stack: Array<{ node: T; childIdx: number; children: readonly T[] }> = [
      { node: start, childIdx: 0, children: deps.get(start) ?? [] },
    ];
    color.set(start, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = frame.children;
      if (frame.childIdx >= children.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const child = children[frame.childIdx]!;
      frame.childIdx++;
      const childColor = color.get(child) ?? WHITE;
      if (childColor === GREY) {
        // Found a cycle — reconstruct from the back-edge target to
        // the current frame, then close the loop with the target.
        const startIdx = stack.findIndex((f) => f.node === child);
        const cycle = stack.slice(startIdx).map((f) => f.node);
        return { cycle: [...cycle, child] };
      }
      if (childColor === WHITE) {
        color.set(child, GREY);
        stack.push({
          node: child,
          childIdx: 0,
          children: deps.get(child) ?? [],
        });
      }
    }
  }

  return null;
}

/**
 * Topologically sort nodes by their dependencies. Returns the nodes
 * in an order where every dependency comes before its dependents.
 *
 * Uses Kahn's algorithm — O(V + E). Throws on cycle (caller should
 * run `detectCycles` first for a friendly error message).
 */
export function topologicalSort<T>(
  nodes: readonly T[],
  deps: DependencyMap<T>,
): T[] {
  const inDegree = new Map<T, number>();
  const forward = new Map<T, T[]>();

  for (const node of nodes) {
    inDegree.set(node, 0);
    forward.set(node, []);
  }
  for (const [node, nodeDeps] of deps) {
    const unique = new Set(nodeDeps);
    inDegree.set(node, unique.size);
    for (const dep of unique) {
      const fwd = forward.get(dep) ?? [];
      fwd.push(node);
      forward.set(dep, fwd);
    }
  }

  const queue: T[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) {
      queue.push(node);
    }
  }
  const out: T[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    out.push(node);
    for (const next of forward.get(node) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) {
        queue.push(next);
      }
    }
  }

  if (out.length !== nodes.length) {
    throw new Error(
      `topologicalSort: cycle detected — sorted ${out.length}/${nodes.length} nodes`,
    );
  }
  return out;
}

/**
 * Convenience: validate a graph is acyclic and return a friendly
 * error message naming the cycle path if not.
 */
export function validateAcyclic<T>(
  nodes: readonly T[],
  deps: DependencyMap<T>,
): void {
  const cycle = detectCycles(nodes, deps);
  if (cycle !== null) {
    const path = cycle.cycle.map(String).join(' -> ');
    throw new Error(
      `dependency cycle detected: ${path}`,
    );
  }
}