import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveBuiltInPath(
  distRelative: string,
  sourceRelative: string,
  validate: (candidate: string) => boolean,
  notFoundMessage: string,
): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', distRelative),
    path.resolve(here, '..', '..', '..', 'src', sourceRelative),
  ];

  for (const candidate of candidates) {
    if (validate(candidate)) return candidate;
  }

  throw new Error(`${notFoundMessage}\nTried:\n${candidates.join('\n')}`);
}

export function resolveBuiltInStarterDir(): string {
  return resolveBuiltInPath(
    'starter',
    'starter',
    (candidate) => fs.existsSync(path.join(candidate, 'commands')) && fs.existsSync(path.join(candidate, 'workspace')),
    'Dojo starter asset directory not found.',
  );
}

export function resolveBuiltInArtifactsDir(): string {
  return resolveBuiltInPath(
    'builtins/artifacts',
    'builtins/artifacts',
    (candidate) => fs.existsSync(candidate) && fs.readdirSync(candidate).some(file => /\.(js|mjs|ts|mts)$/.test(file)),
    'Dojo built-in artifact directory not found.',
  );
}

export function resolveBuiltInSkillsDir(): string {
  return resolveBuiltInPath(
    'skills',
    'skills',
    (candidate) => fs.existsSync(candidate) && fs.readdirSync(candidate).length > 0,
    'Dojo built-in skills directory not found.',
  );
}
