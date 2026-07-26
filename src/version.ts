/**
 * Single source of truth for the binary's own version string.
 *
 * Reads `package.json` at build time via a JSON import attribute so the
 * value is statically resolvable by both TypeScript (`resolveJsonModule`)
 * and the Node runtime (`with { type: 'json' }`). The cast narrows the
 * inferred type to the `{ version: string }` shape we care about; the
 * rest of the package manifest is intentionally dropped.
 */
import packageJson from '../package.json' with { type: 'json' };

export const VERSION: string = (packageJson as { version: string }).version;
