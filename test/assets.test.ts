/**
 * Asset structure tests — guard the .stbl header SVG against accidental
 * regressions in the brand lockup (regent mark + wordmark + canonical
 * "by .stbl" lockup + skvoznoy accent line) and the opacity hierarchy.
 *
 * These are string/regex checks, not full XML parsing. They catch:
 * - missing files (after rename/delete)
 * - viewBox change (would break README hero)
 * - missing wordmark, "by" connector, .stbl mark, "stbl" wordmark
 * - dropped accent color (#c44569)
 * - opacity level regression (e.g. someone bumps regent mark to 1.0)
 * - dark/light variant inversion (#fff vs #000)
 * - accent line shrunk below "skvoznoy" threshold (width < 1000)
 * - regent mark missing one of the 3 vertical strokes
 * - .stbl mark missing or sized wrong (must be 16×16 in header context)
 * - "by" connector missing brand-spec fill (#888) or weight (400)
 * - submodule contents missing (assets/stbl/ should exist after init)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS_DIR = join(import.meta.dirname ?? __dirname, '..', 'assets');
const STBL_ASSETS_DIR = join(ASSETS_DIR, 'stbl', 'assets');

function readAsset(name: string): string {
  const path = join(ASSETS_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`asset missing: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

const DARK = readAsset('header-dark.svg');
const LIGHT = readAsset('header-light.svg');

describe('assets/header SVGs', () => {
  describe('both variants', () => {
    it('declare viewBox 1200x200 (README hero size)', () => {
      expect(DARK).toMatch(/<svg[^>]*viewBox="0 0 1200 200"/);
      expect(LIGHT).toMatch(/<svg[^>]*viewBox="0 0 1200 200"/);
    });

    it('use JetBrains Mono font', () => {
      expect(DARK).toMatch(/font-family="'JetBrains Mono'/);
      expect(LIGHT).toMatch(/font-family="'JetBrains Mono'/);
    });

    it('render regent wordmark (primary, weight 700)', () => {
      expect(DARK).toMatch(/<text[^>]*font-weight="700"[^>]*>regent</);
      expect(LIGHT).toMatch(/<text[^>]*font-weight="700"[^>]*>regent</);
    });

    it('render canonical "by .stbl" lockup (3 separate elements)', () => {
      // by connector
      expect(DARK).toMatch(/>by</);
      expect(LIGHT).toMatch(/>by</);
      // stbl wordmark
      expect(DARK).toMatch(/>stbl</);
      expect(LIGHT).toMatch(/>stbl</);
    });

    it('"by" connector uses brand-spec #888 fill + weight 400', () => {
      expect(DARK).toMatch(/<text[^>]*font-weight="400"[^>]*fill="#888"[^>]*>by</);
      expect(LIGHT).toMatch(/<text[^>]*font-weight="400"[^>]*fill="#888"[^>]*>by</);
    });

    it('"stbl" wordmark uses weight 700 (brand spec)', () => {
      expect(DARK).toMatch(/<text[^>]*font-weight="700"[^>]*>stbl</);
      expect(LIGHT).toMatch(/<text[^>]*font-weight="700"[^>]*>stbl</);
    });

    it('render .stbl mark as 16×16 rect (header context; standalone lockup uses 32×32)', () => {
      const markMatches = DARK.match(/<rect[^>]*width="16"[^>]*height="16"/g) ?? [];
      expect(markMatches.length).toBeGreaterThanOrEqual(1);
      const lightMark = LIGHT.match(/<rect[^>]*width="16"[^>]*height="16"/g) ?? [];
      expect(lightMark.length).toBeGreaterThanOrEqual(1);
    });

    it('include the .stbl pink accent (#c44569)', () => {
      expect(DARK).toMatch(/fill="#c44569"/);
      expect(LIGHT).toMatch(/fill="#c44569"/);
    });

    it('implement the 9-level opacity hierarchy (brand refined v0.1.0)', () => {
      // 1.00 (primary wordmark), 0.85 (secondary + outer marks),
      // 0.65 (bottom accent), 0.55 (middle mark gradient valley),
      // 0.45 (top accent + separator + "by"), 0.35 (baseline accent),
      // 0.07 (ambient dot grid)
      const requiredOpacities = ['1.0', '0.85', '0.65', '0.55', '0.45', '0.35', '0.07'];
      for (const svg of [DARK, LIGHT]) {
        for (const opacity of requiredOpacities) {
          expect(svg, `missing opacity=${opacity}`).toContain(`opacity="${opacity}"`);
        }
      }
    });

    it('regent mark has 3 vertical strokes with center-fading gradient', () => {
      const strokeMatches = DARK.match(/<rect[^>]*width="3"[^>]*height="70"/g) ?? [];
      expect(strokeMatches.length).toBe(3);
      // Verify gradient opacity: outer strokes 0.85, middle 0.55
      // (attribute order may vary — match independently)
      expect(DARK).toMatch(/<rect[^>]*opacity="0\.85"[^>]*\/>/);
      expect(DARK).toMatch(/<rect[^>]*opacity="0\.55"[^>]*\/>/);
    });

    it('accent envelope: top (0.45) + bottom (0.65) lines + baseline (0.35)', () => {
      // Three horizontal accent lines in #c44569, distinct opacities
      expect(DARK).toMatch(/<rect[^>]*fill="#c44569"[^>]*opacity="0\.45"[^>]*\/>/);
      expect(DARK).toMatch(/<rect[^>]*fill="#c44569"[^>]*opacity="0\.65"[^>]*\/>/);
      expect(DARK).toMatch(/<rect[^>]*fill="#c44569"[^>]*opacity="0\.35"[^>]*\/>/);
    });

    it('background-frame encloses the lockup at 0.04 opacity', () => {
      // Subtle frame rect: rx="4", opacity 0.04, fill matches surface fg
      const darkFrame = DARK.match(/<rect[^>]*rx="4"[^>]*opacity="0\.04"/);
      const lightFrame = LIGHT.match(/<rect[^>]*rx="4"[^>]*opacity="0\.04"/);
      expect(darkFrame).toBeTruthy();
      expect(lightFrame).toBeTruthy();
      // Dark variant: fill="#fff" (white-on-black surface)
      expect(darkFrame![0]).toContain('fill="#fff"');
      // Light variant: fill="#000" (black-on-white surface)
      expect(lightFrame![0]).toContain('fill="#000"');
    });

    it('skvoznoy accent line spans at least 1000px', () => {
      const accentWidth = (svg: string): number | null => {
        const rects = svg.match(/<rect[^>]*\/>/g) ?? [];
        const accentRect = rects.find((r) => r.includes('#c44569'));
        if (!accentRect) {
          return null;
        }
        const m = accentRect.match(/width="(\d+)"/);
        return m ? Number.parseInt(m[1]!, 10) : null;
      };
      const darkWidth = accentWidth(DARK);
      const lightWidth = accentWidth(LIGHT);
      expect(darkWidth).not.toBeNull();
      expect(lightWidth).not.toBeNull();
      expect(darkWidth!).toBeGreaterThanOrEqual(1000);
      expect(lightWidth!).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('dark variant (header-dark.svg)', () => {
    it('uses #fff foreground on #000 background', () => {
      expect(DARK).toMatch(/<rect width="1200" height="200" fill="#000"/);
      // primary wordmark fill
      expect(DARK).toMatch(/fill="#fff"[^>]*opacity="1.0"[^>]*>regent|>regent[\s\S]*?fill="#fff"[^>]*opacity="1.0"/);
    });

    it('.stbl mark is white on dark surface', () => {
      // The 16×16 mark must use #fff fill
      const markMatch = DARK.match(/<rect[^>]*width="16"[^>]*height="16"[^>]*\/>/);
      expect(markMatch).toBeTruthy();
      expect(markMatch![0]).toContain('fill="#fff"');
    });
  });

  describe('light variant (header-light.svg)', () => {
    it('uses #000 foreground on #fff background', () => {
      expect(LIGHT).toMatch(/<rect width="1200" height="200" fill="#fff"/);
      expect(LIGHT).toMatch(/fill="#000"[^>]*opacity="1.0"[^>]*>regent|>regent[\s\S]*?fill="#000"[^>]*opacity="1.0"/);
    });

    it('.stbl mark is black on light surface', () => {
      const markMatch = LIGHT.match(/<rect[^>]*width="16"[^>]*height="16"[^>]*\/>/);
      expect(markMatch).toBeTruthy();
      expect(markMatch![0]).toContain('fill="#000"');
    });
  });

  describe('standalone lockup SVGs (assets/lockup-regent*.svg)', () => {
    it('both files exist', () => {
      expect(existsSync(join(ASSETS_DIR, 'lockup-regent.svg'))).toBe(true);
      expect(existsSync(join(ASSETS_DIR, 'lockup-regent-dark.svg'))).toBe(true);
    });

    it('light lockup uses 32×32 mark + brand spec colors', () => {
      const light = readAsset('lockup-regent.svg');
      expect(light).toMatch(/<rect[^>]*width="32"[^>]*height="32"[^>]*fill="#000"/);
      expect(light).toMatch(/>regent</);
      expect(light).toMatch(/>by</);
      expect(light).toMatch(/>stbl</);
    });

    it('dark lockup inverts colors to #fff for dark surface', () => {
      const dark = readAsset('lockup-regent-dark.svg');
      expect(dark).toMatch(/<rect[^>]*width="32"[^>]*height="32"[^>]*fill="#fff"/);
      // "by" still uses brand-spec #888 in both variants
      expect(dark).toMatch(/fill="#888"[^>]*>by</);
    });
  });

  describe('brand submodule (assets/stbl/)', () => {
    it('submodule directory exists with .git marker', () => {
      expect(existsSync(STBL_ASSETS_DIR)).toBe(true);
      const gitPath = join(ASSETS_DIR, 'stbl', '.git');
      expect(existsSync(gitPath)).toBe(true);
    });

    it('submodule contains canonical lockup-template.svg', () => {
      const template = join(STBL_ASSETS_DIR, 'lockup-template.svg');
      expect(existsSync(template)).toBe(true);
      const stat = statSync(template);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('submodule contains canonical logo.svg (64×64 with 32×32 white inner)', () => {
      const logo = readFileSync(join(STBL_ASSETS_DIR, 'logo.svg'), 'utf8');
      expect(logo).toMatch(/<svg[^>]*viewBox="0 0 64 64"/);
      expect(logo).toMatch(/<rect width="64" height="64" fill="#000"/);
      expect(logo).toMatch(/<rect width="32" height="32" fill="#fff"/);
    });

    it('submodule contains by-stbl.css utility class', () => {
      const css = join(STBL_ASSETS_DIR, 'by-stbl.css');
      expect(existsSync(css)).toBe(true);
    });
  });

  describe('favicon (assets/favicon.svg)', () => {
    it('exists and is theme-aware', () => {
      const favicon = readAsset('favicon.svg');
      expect(favicon).toMatch(/<svg[^>]*viewBox="0 0 32 32"/);
      expect(favicon).toContain('@media (prefers-color-scheme: dark)');
      expect(favicon).toMatch(/<rect class="outer" width="32" height="32"/);
      expect(favicon).toMatch(/<rect class="inner" x="8" y="8" width="16" height="16"/);
    });
  });

  describe('llm.txt (assets/llm.txt)', () => {
    it('exists, non-empty, contains skill sections', () => {
      const llm = readAsset('llm.txt');
      expect(llm.length).toBeGreaterThan(500);
      expect(llm).toContain('regent — agent skill');
      expect(llm).toContain('When to use');
      expect(llm).toContain('Writing a rule');
      expect(llm).toContain('Tri-state review');
      expect(llm).toContain('Anti-patterns');
    });

    it('references all key CLI commands', () => {
      const llm = readAsset('llm.txt');
      for (const cmd of ['check', 'review', 'list', 'explain', 'init', 'accept', 'reject', 'llm']) {
        expect(llm, `missing command reference: ${cmd}`).toContain(`regent ${cmd}`);
      }
    });
  });
});