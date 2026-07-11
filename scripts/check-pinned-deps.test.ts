import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AB-1001 / T47 (Scenario S13, plan.md "Test Strategy"):
 * Every workspace package.json's dependencies/devDependencies must be
 * exact-pinned (no `^`, `~`, `*`, `latest`). The ONE explicit exception is
 * pnpm's `workspace:*` protocol, used for cross-workspace references
 * (e.g. `"shared": "workspace:*"` in apps/api and apps/web) — this is
 * pnpm's own exact-linking mechanism for a workspace sibling, not an
 * npm-registry semver range, so it is allowed per AGENTS.md §3.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const WORKSPACE_PROTOCOL = 'workspace:*';
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+$/;
const DEP_SECTIONS = ['dependencies', 'devDependencies'] as const;

interface PackageJsonTarget {
  label: string;
  path: string;
}

const targets: PackageJsonTarget[] = [
  { label: 'root package.json', path: resolve(repoRoot, 'package.json') },
  { label: 'apps/api/package.json', path: resolve(repoRoot, 'apps/api/package.json') },
  { label: 'apps/web/package.json', path: resolve(repoRoot, 'apps/web/package.json') },
  { label: 'packages/shared/package.json', path: resolve(repoRoot, 'packages/shared/package.json') },
];

function readPackageJson(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function getDepSection(pkg: Record<string, unknown>, section: string): Record<string, string> {
  const value = pkg[section];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected "${section}" to be an object in package.json, got ${typeof value}`);
  }
  return value as Record<string, string>;
}

describe('check-pinned-deps (AB-1001 Scenario S13)', () => {
  it('every workspace package.json file exists and is readable JSON', () => {
    for (const target of targets) {
      expect(() => readPackageJson(target.path), `Failed to read/parse ${target.label} at ${target.path}`).not.toThrow();
    }
  });

  describe.each(targets)('$label', ({ label, path }) => {
    it('has no unpinned dependency or devDependency versions', () => {
      const pkg = readPackageJson(path);
      const violations: string[] = [];

      for (const section of DEP_SECTIONS) {
        const deps = getDepSection(pkg, section);
        for (const [name, version] of Object.entries(deps)) {
          const isWorkspaceProtocol = version === WORKSPACE_PROTOCOL;
          const isExactVersion = EXACT_VERSION_RE.test(version);
          if (!isWorkspaceProtocol && !isExactVersion) {
            violations.push(`${section}.${name} = "${version}"`);
          }
        }
      }

      expect(
        violations,
        `${label} has unpinned dependency version(s):\n${violations.join('\n')}`,
      ).toEqual([]);
    });

    it('does not use caret (^), tilde (~), wildcard (*), or "latest" ranges (workspace:* is the sole allowed exception)', () => {
      const pkg = readPackageJson(path);

      for (const section of DEP_SECTIONS) {
        const deps = getDepSection(pkg, section);
        for (const [name, version] of Object.entries(deps)) {
          if (version === WORKSPACE_PROTOCOL) {
            // Explicitly allowed: pnpm's workspace-sibling exact-link protocol,
            // not an npm-registry semver range.
            continue;
          }

          expect(
            version.startsWith('^'),
            `${label}: ${section}.${name} uses a caret range ("${version}") — must be exact-pinned`,
          ).toBe(false);

          expect(
            version.startsWith('~'),
            `${label}: ${section}.${name} uses a tilde range ("${version}") — must be exact-pinned`,
          ).toBe(false);

          expect(
            version,
            `${label}: ${section}.${name} uses "latest" — must be exact-pinned`,
          ).not.toBe('latest');

          expect(
            version.includes('*'),
            `${label}: ${section}.${name} contains a wildcard ("${version}") — must be exact-pinned`,
          ).toBe(false);
        }
      }
    });

    it('any "workspace:" reference uses exactly the "workspace:*" protocol (not workspace:^ or workspace:~)', () => {
      const pkg = readPackageJson(path);

      for (const section of DEP_SECTIONS) {
        const deps = getDepSection(pkg, section);
        for (const [name, version] of Object.entries(deps)) {
          if (version.startsWith('workspace:')) {
            expect(
              version,
              `${label}: ${section}.${name} uses a non-exact workspace protocol ("${version}")`,
            ).toBe(WORKSPACE_PROTOCOL);
          }
        }
      }
    });
  });
});
