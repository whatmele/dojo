import chalk from 'chalk';

const BANNER = `
  ${chalk.bold.rgb(255, 130, 50)('██████╗  ██████╗      ██╗ ██████╗ ')}
  ${chalk.bold.rgb(255, 140, 60)('██╔══██╗██╔═══██╗     ██║██╔═══██╗')}
  ${chalk.bold.rgb(255, 150, 70)('██║  ██║██║   ██║     ██║██║   ██║')}
  ${chalk.bold.rgb(255, 160, 80)('██║  ██║██║   ██║██   ██║██║   ██║')}
  ${chalk.bold.rgb(255, 170, 90)('██████╔╝╚██████╔╝╚█████╔╝╚██████╔╝')}
  ${chalk.bold.rgb(255, 180, 100)('╚═════╝  ╚═════╝  ╚════╝  ╚═════╝ ')}
  ${chalk.dim('Agent Workspace CLI  v0.1.0')}
`;

export function printBanner(): void {
  console.log(BANNER);
}

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✔'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✖'), msg),
  step: (msg: string) => console.log(chalk.cyan('→'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
};
