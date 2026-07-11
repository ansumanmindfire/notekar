import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AB-1001 / Phase 7 (T48, plan.md "Test Strategy"):
 * README completeness for a "new developer follows README from fresh clone"
 * (Scenario S14) is explicitly scoped as manual verification — simulating a
 * human reading the README isn't practical or meaningful to automate.
 *
 * However, the README's "## Everyday Commands" table documents a set of
 * literal `pnpm <script>` invocations. Whether each of those scripts
 * actually exists in the root package.json is NOT a reading-comprehension
 * check — it's a mechanical, drift-detecting assertion: if a script is
 * ever renamed/removed from package.json without updating the README, this
 * test fails immediately instead of silently shipping a broken doc.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

interface RootPackageJson {
  scripts?: Record<string, string>;
}

function readRootPackageJson(): RootPackageJson {
  const raw = readFileSync(resolve(repoRoot, 'package.json'), 'utf-8');
  return JSON.parse(raw) as RootPackageJson;
}

function readReadme(): string {
  return readFileSync(resolve(repoRoot, 'README.md'), 'utf-8');
}

/** Extracts the body of the "## Everyday Commands" markdown section (up to the next `##` heading). */
function extractEverydayCommandsSection(readme: string): string {
  const headingRe = /^##\s+Everyday Commands\s*$/m;
  const match = headingRe.exec(readme);
  if (!match) {
    throw new Error('README.md is missing an "## Everyday Commands" section');
  }
  const start = match.index + match[0].length;
  const rest = readme.slice(start);
  const nextHeadingMatch = /^##\s+/m.exec(rest);
  return nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;
}

/**
 * Parses markdown table rows of the form `| \`pnpm <script>\` | ... |`,
 * returning the literal command string from each row's first cell.
 * Skips the header row and the `|---|---|` separator row.
 */
function extractDocumentedCommands(tableSection: string): string[] {
  const rows = tableSection
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .filter((line) => !/^\|\s*-+\s*\|/.test(line));

  const commands: string[] = [];
  for (const row of rows) {
    const cellMatch = /^\|\s*`([^`]+)`\s*\|/.exec(row);
    if (cellMatch) {
      commands.push(cellMatch[1]);
    }
  }
  return commands;
}

describe('README "Everyday Commands" table matches root package.json scripts (AB-1001 Phase 7)', () => {
  const readme = readReadme();
  const tableSection = extractEverydayCommandsSection(readme);
  const documentedCommands = extractDocumentedCommands(tableSection);
  const { scripts = {} } = readRootPackageJson();

  it('parsed at least one documented command from the table (sanity check the parser itself)', () => {
    expect(documentedCommands.length).toBeGreaterThan(0);
  });

  it.each(documentedCommands)('documented command "%s" is a real "pnpm <script>" defined in root package.json', (command) => {
    const parts = command.split(/\s+/);
    expect(parts[0], `Expected "${command}" to be a "pnpm <script>" invocation`).toBe('pnpm');
    // A documented command must be "pnpm <script>" optionally followed by
    // additional flag/argument tokens (e.g. "pnpm lint --max-warnings 0").
    // The invariant that matters is token[0] === 'pnpm' and token[1] is a
    // real script name in package.json's scripts -- extra trailing tokens
    // are just flags/args passed through to the underlying script.
    expect(parts.length, `Expected "${command}" to be at least "pnpm <script>" (two or more tokens)`).toBeGreaterThanOrEqual(2);

    const scriptName = parts[1];
    expect(
      Object.prototype.hasOwnProperty.call(scripts, scriptName),
      `README documents "pnpm ${scriptName}" but no such script exists in root package.json (available scripts: ${Object.keys(scripts).join(', ')})`,
    ).toBe(true);
  });
});
