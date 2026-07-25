import { isAbsolute, resolve } from 'node:path';
import type { Command } from 'commander';

import { loadRules, type LoaderRuleSet } from '../loader.js';
import { flushAndExit } from '../logging/index.js';
import { renderFinding } from '../reporter/text.js';
import { detectFile } from '../runner.js';
import type { CompiledRule, Finding } from '../types.js';
import { buildParameterisedRuleInfo } from './describe.js';

export type ExplainFormat = 'text' | 'json';

export interface ExplainOptions {
  readonly cwd?: string;
  readonly format?: ExplainFormat;
}

interface RuleExplanation {
  readonly id: string;
  readonly severity: string;
  readonly description: string;
  readonly message: string;
  readonly exampleMatch: string;
  readonly exampleFix: string;
  readonly references: readonly string[];
  readonly configure?: string;
}

type FindingLocator = { readonly path: string; readonly line: number; readonly column: number };

const RULE_ID = /^[\w.-]+$/;
const FINDING_LOCATOR = /^(.+):(\d+):(\d+)$/;
export async function runExplain(target: string, options: ExplainOptions): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const format = options.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    process.stderr.write(`regent: unsupported explain format '${format}'; use text or json.\n`);
    return 2;
  }

  let loaded: LoaderRuleSet;
  try {
    loaded = await loadRules({ repoRoot: cwd });
  } catch (error) {
    process.stderr.write(`regent: ${(error as Error).message}\n`);
    return 2;
  }

  if (RULE_ID.test(target)) {
    return explainRule(target, loaded, format);
  }

  const locator = parseFindingLocator(target);
  if (locator === null) {
    process.stderr.write(
      `regent: invalid explain target '${target}'; use a rule id or file:line:column.\n`,
    );
    return 2;
  }
  return explainFinding(target, locator, cwd, loaded, format);
}

function explainRule(ruleId: string, loaded: LoaderRuleSet, format: ExplainFormat): number {
  const rule = loaded.rules.find((candidate) => candidate.spec.id === ruleId);
  if (rule === undefined) {
    process.stderr.write(
      `regent: no rule with id '${ruleId}'. Try \`regent list\` for the full list.\n`,
    );
    return 2;
  }

  const explanation = buildRuleExplanation(rule, loaded);
  process.stdout.write(
    format === 'json'
      ? `${JSON.stringify({ mode: 'rule', rule: explanation }, null, 2)}\n`
      : renderRuleExplanation(explanation),
  );
  return 0;
}

async function explainFinding(
  target: string,
  locator: FindingLocator,
  cwd: string,
  loaded: LoaderRuleSet,
  format: ExplainFormat,
): Promise<number> {
  const file = isAbsolute(locator.path) ? locator.path : resolve(cwd, locator.path);
  const findings = await detectFile(file, loaded.rules, {
    acceptList: loaded.acceptList,
    astRules: loaded.astRules,
    contextBuffer: 2,
  });
  const finding = findings.find((candidate) =>
    candidate.match.startLine + 1 === locator.line
    && candidate.match.startColumn + 1 === locator.column,
  );
  if (finding === undefined) {
    process.stderr.write(
      `no finding at ${target} in last run; run \`regent check\` to refresh\n`,
    );
    return 1;
  }

  const rule = loaded.rules.find((candidate) => candidate.spec.id === finding.ruleId);
  const explanation = rule === undefined ? undefined : buildRuleExplanation(rule, loaded);
  const description = explanation?.description ?? finding.rationale ?? finding.message;
  const remediation = explanation?.exampleFix ?? description;
  const suppress = renderSuppression(finding, locator.path);

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({
      mode: 'finding',
      locator: target,
      ruleId: finding.ruleId,
      description,
      finding: {
        severity: finding.severity,
        path: locator.path,
        match: {
          line: finding.match.startLine + 1,
          column: finding.match.startColumn + 1,
          text: finding.match.matchText,
        },
        context: {
          startLine: finding.context.startLine + 1,
          endLine: finding.context.endLine + 1,
          lines: finding.context.lines,
        },
      },
      remediation,
      suppress,
    }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderFinding(finding, { cwd, useColor: false }));
  process.stdout.write(`  Description: ${description}\n`);
  process.stdout.write(`  Remediation: ${remediation}\n`);
  process.stdout.write(`  Suppress: ${suppress}\n`);
  return 0;
}

function buildRuleExplanation(rule: CompiledRule, loaded: LoaderRuleSet): RuleExplanation {
  const metadata = rule.spec as unknown as {
    readonly description?: unknown;
    readonly references?: unknown;
  };
  const references = normalizeReferences(metadata.references);
  if (rule.source.length > 0 && !references.includes(rule.source)) {
    references.push(rule.source);
  }
  const parameterised = buildParameterisedRuleInfo(loaded)
    .find((candidate) => candidate.id === rule.spec.id);

  return {
    id: rule.spec.id,
    severity: rule.spec.severity,
    description: typeof metadata.description === 'string'
      ? metadata.description
      : rule.spec.rationale ?? rule.spec.message,
    message: rule.spec.message,
    exampleMatch: rule.spec.pattern,
    exampleFix: renderFix(rule),
    references,
    ...(parameterised !== undefined
      ? { configure: parameterised.sampleConfigure || '{}' }
      : {}),
  };
}

function renderFix(rule: CompiledRule): string {
  const fix = rule.spec.fix;
  if (fix === undefined) {
    return rule.spec.rationale ?? `Rewrite the code so it no longer matches ${rule.spec.pattern}.`;
  }
  const guidance = fix.guidance === undefined ? '' : ` ${fix.guidance}`;
  if (fix.kind === 'replace') {
    return `${fix.title}; replace the matched text with ${JSON.stringify(fix.template)}.${guidance}`.trim();
  }
  if (fix.kind === 'delete-line') {
    return `${fix.title}; delete the matched line.${guidance}`.trim();
  }
  return `${fix.title}.${guidance}`.trim();
}

function renderRuleExplanation(explanation: RuleExplanation): string {
  const lines = [
    `=== ${explanation.id} ===`,
    '',
    `severity: ${explanation.severity}`,
    `description: ${explanation.description}`,
    `message: ${explanation.message}`,
    '',
    'example match:',
    `  ${explanation.exampleMatch}`,
    'example fix:',
    `  ${explanation.exampleFix}`,
  ];
  if (explanation.references.length > 0) {
    lines.push('', 'references:', ...explanation.references.map((reference) => `  ${reference}`));
  }
  if (explanation.configure !== undefined) {
    lines.push('', 'rules.configure:', `  '${explanation.id}': ${explanation.configure}`);
  }
  return `${lines.join('\n')}\n`;
}

function normalizeReferences(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((reference): reference is string => typeof reference === 'string');
  }
  return [];
}

function parseFindingLocator(target: string): FindingLocator | null {
  const match = FINDING_LOCATOR.exec(target);
  if (match === null) {
    return null;
  }
  return {
    path: match[1]!,
    line: Number.parseInt(match[2]!, 10),
    column: Number.parseInt(match[3]!, 10),
  };
}

function renderSuppression(finding: Finding, path: string): string {
  if (finding.status === 'pending') {
    return `regent accept ${finding.ruleId} ${path}:${finding.match.startLine + 1} --reason "<reason>"`;
  }
  return `add '${finding.ruleId}' to rules.disable, or add '${path}' to the rule's excludePaths`;
}

export function registerExplainCommand(program: Command): void {
  const explain = program
    .command('explain <target>')
    .description('Explain a rule or finding and show remediation guidance.')
    .option('--cwd <path>', 'project root', process.cwd())
    .option('--format <text|json>', 'output format', 'text');
  explain.action(async (target: string, options: ExplainOptions) => {
    const code = await runExplain(target, options);
    await flushAndExit(code);
  });
}
