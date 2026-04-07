import { input, search, select } from '@inquirer/prompts';
import type { BranchSource } from '../types.js';
import { branchExists, listBranchCandidates } from '../core/git.js';
import { log } from '../utils/logger.js';

const MANUAL_BRANCH_VALUE = '__manual_branch__';
const EDIT_BRANCH_MODE = '__edit_branch_mode__';
const EDIT_BASE_BRANCH = '__edit_base_branch__';
const EDIT_TARGET_BRANCH = '__edit_target_branch__';
const CONFIRM_BRANCH_PLAN = '__confirm_branch_plan__';

function previewSuggestions(values: string[], limit = 8): string {
  if (values.length === 0) return '';
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} ...`;
}

function formatBranchPlanSummary(
  source: BranchSource,
  baseBranch: string,
  targetBranch: string,
): string {
  return source === 'created'
    ? `  Planned: create "${targetBranch}" from "${baseBranch}"`
    : `  Planned: use existing branch "${targetBranch}"`;
}

function buildSearchChoices(
  term: string | undefined,
  defaultValue: string | undefined,
  suggestions: string[],
): Array<{ name: string; value: string; description?: string }> {
  const inputValue = term?.trim() ?? '';
  const filteredSuggestions = inputValue
    ? suggestions.filter((branch) => branch.toLowerCase().includes(inputValue.toLowerCase()))
    : suggestions;
  const uniqueSuggestions = [...new Set(filteredSuggestions)];
  const choices: Array<{ name: string; value: string; description?: string }> = [];

  if (!inputValue && defaultValue?.trim()) {
    choices.push({
      name: defaultValue.trim(),
      value: defaultValue.trim(),
      description: 'Recommended branch',
    });
  }

  for (const branch of uniqueSuggestions.slice(0, 12)) {
    if (!inputValue && defaultValue?.trim() === branch) {
      continue;
    }
    if (inputValue && inputValue === branch) {
      continue;
    }
    choices.push({
      name: branch,
      value: branch,
      description: 'Git branch candidate',
    });
  }

  if (inputValue) {
    choices.push({
      name: inputValue,
      value: inputValue,
      description: uniqueSuggestions.length > 0
        ? 'Use exactly what you typed'
        : 'No known branch matched; use exactly what you typed',
    });
  }

  return choices;
}

async function promptManualBranchName(
  message: string,
  options: {
    defaultValue?: string;
    suggestions: string[];
    validate: (value: string) => Promise<true | string>;
  },
): Promise<string> {
  const value = await search({
    message: `${message} (type to search, Tab to complete)`,
    source: async (term: string | undefined) => buildSearchChoices(term, options.defaultValue, options.suggestions),
    validate: async (raw: string) => options.validate(raw.trim()),
    theme: {
      style: {
        keysHelpTip: (keys: [string, string][]) => [
          ...keys,
          ['Tab', 'autocomplete'],
        ]
          .map(([key, action]) => `${key} ${action}`)
          .join('  '),
      },
    },
  });

  return value.trim();
}

async function promptDirectBranchInput(
  message: string,
  options: {
    defaultValue?: string;
    validate: (value: string) => Promise<true | string>;
  },
): Promise<string> {
  const value = await input({
    message,
    default: options.defaultValue,
    validate: async (raw: string) => options.validate(raw.trim()),
  });

  return value.trim();
}

export async function promptBranchName(
  message: string,
  options: {
    defaultValue?: string;
    repoPath?: string;
    requireExisting?: boolean;
    forbidExisting?: boolean;
    preferManualInput?: boolean;
    missingMessage?: string;
    existingMessage?: string;
  } = {},
): Promise<string> {
  const suggestions = options.repoPath
    ? await listBranchCandidates(options.repoPath).catch(() => null)
    : null;
  const branchSuggestions = suggestions?.suggestions ?? [];
  const validate = async (raw: string): Promise<true | string> => {
    const value = raw.trim();
    if (value.length === 0) {
      return 'Branch cannot be empty';
    }
    if (!options.repoPath) {
      return true;
    }

    const exists = await branchExists(options.repoPath, value);
    if (options.requireExisting && !exists) {
      return options.missingMessage ?? `Branch "${value}" does not exist locally or remotely`;
    }
    if (options.forbidExisting && exists) {
      return options.existingMessage ?? `Branch "${value}" already exists locally or remotely`;
    }
    return true;
  };

  if (branchSuggestions.length > 0) {
    if (options.preferManualInput) {
      return promptDirectBranchInput(message, {
        defaultValue: options.defaultValue,
        validate,
      });
    }

    log.dim(`  Branch suggestions: ${previewSuggestions(branchSuggestions)}`);

    const limitedSuggestions = branchSuggestions.slice(0, 12);
    const choice = await select({
      message,
      choices: [
        ...limitedSuggestions.map((branch) => ({
          name: branch === options.defaultValue ? `${branch} (recommended)` : branch,
          value: branch,
        })),
        {
          name: `Manual input${options.defaultValue ? ` (${options.defaultValue})` : ''}`,
          value: MANUAL_BRANCH_VALUE,
        },
      ],
      default: limitedSuggestions.includes(options.defaultValue ?? '')
        ? options.defaultValue
        : MANUAL_BRANCH_VALUE,
    });

    if (choice !== MANUAL_BRANCH_VALUE) {
      const result = await validate(choice.trim());
      if (result === true) {
        return choice.trim();
      }
      log.error(result);
    }

    return promptManualBranchName(message, {
      defaultValue: options.defaultValue,
      suggestions: branchSuggestions,
      validate,
    });
  }

  const value = await input({
    message,
    default: options.defaultValue,
    validate,
  });

  return value.trim();
}

export async function promptBranchPlan(
  label: string,
  options: {
    repoPath?: string;
    defaultCreatedTarget: string;
    defaultExistingTarget: string;
    defaultBase: string;
    defaultSource?: BranchSource;
  },
): Promise<{
  target_branch: string;
  base_branch: string;
  branch_source: BranchSource;
}> {
  let branchSource = options.defaultSource ?? 'created';
  let baseBranch = options.defaultBase;
  let targetBranch = branchSource === 'created'
    ? options.defaultCreatedTarget
    : options.defaultExistingTarget;
  let nextEdit: typeof EDIT_BRANCH_MODE | typeof EDIT_BASE_BRANCH | typeof EDIT_TARGET_BRANCH = EDIT_BRANCH_MODE;

  while (true) {
    if (nextEdit === EDIT_BRANCH_MODE) {
      branchSource = await select({
        message: `${label}: branch mode`,
        choices: [
          { name: 'Create branch from a base branch', value: 'created' as BranchSource },
          { name: 'Use an existing local/remote branch', value: 'existing' as BranchSource },
        ],
        default: branchSource,
      });
      targetBranch = branchSource === 'created'
        ? options.defaultCreatedTarget
        : options.defaultExistingTarget;
      baseBranch = options.defaultBase;
    }

    if (branchSource === 'created') {
      if (nextEdit === EDIT_BRANCH_MODE || nextEdit === EDIT_BASE_BRANCH) {
        baseBranch = await promptBranchName(`${label}: base branch`, {
          defaultValue: baseBranch || options.defaultBase,
          repoPath: options.repoPath,
          requireExisting: true,
          missingMessage: 'Choose a base branch that already exists locally or remotely',
        });
        nextEdit = EDIT_TARGET_BRANCH;
      }

      if (nextEdit === EDIT_TARGET_BRANCH) {
        targetBranch = await promptBranchName(`${label}: target branch`, {
          defaultValue: targetBranch || options.defaultCreatedTarget,
          repoPath: options.repoPath,
          forbidExisting: true,
          preferManualInput: true,
          existingMessage: 'That branch already exists. Switch to "Use an existing local/remote branch" if you want to resume it',
        });
      }
    } else {
      baseBranch = options.defaultBase;
      targetBranch = await promptBranchName(`${label}: target branch`, {
        defaultValue: targetBranch || options.defaultExistingTarget,
        repoPath: options.repoPath,
        requireExisting: true,
        missingMessage: 'Choose an existing local or remote branch',
      });
    }

    log.dim(formatBranchPlanSummary(branchSource, baseBranch, targetBranch));

    const reviewChoice = await select({
      message: `${label}: confirm branch setup`,
      choices: branchSource === 'created'
        ? [
          { name: 'Use this branch setup', value: CONFIRM_BRANCH_PLAN },
          { name: 'Edit target branch', value: EDIT_TARGET_BRANCH },
          { name: 'Edit base branch', value: EDIT_BASE_BRANCH },
          { name: 'Edit branch mode', value: EDIT_BRANCH_MODE },
        ]
        : [
          { name: 'Use this branch setup', value: CONFIRM_BRANCH_PLAN },
          { name: 'Edit target branch', value: EDIT_TARGET_BRANCH },
          { name: 'Edit branch mode', value: EDIT_BRANCH_MODE },
        ],
      default: CONFIRM_BRANCH_PLAN,
    });

    if (reviewChoice === CONFIRM_BRANCH_PLAN) {
      return {
        target_branch: targetBranch,
        base_branch: baseBranch,
        branch_source: branchSource,
      };
    }

    nextEdit = reviewChoice as typeof EDIT_BRANCH_MODE | typeof EDIT_BASE_BRANCH | typeof EDIT_TARGET_BRANCH;
  }
}
