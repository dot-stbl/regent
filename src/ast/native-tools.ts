import type { NativeToolRequirement } from '../types.js';

export const KNOWN_NATIVE_TOOLS: ReadonlySet<string> = new Set([
  'roslyn-analyzers', 'typescript-language-server', 'rust-analyzer', 'gopls',
]);

export function validateNeedsNative(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'needsNative must be an object';
  const requirement = value as Partial<NativeToolRequirement>;
  if (typeof requirement.tool !== 'string' || !KNOWN_NATIVE_TOOLS.has(requirement.tool)) {
    return `needsNative.tool '${String(requirement.tool)}' is not a known tool id`;
  }
  if (typeof requirement.analyzer !== 'string' || requirement.analyzer.trim().length === 0) {
    return 'needsNative.analyzer must be a non-empty string';
  }
  return null;
}
