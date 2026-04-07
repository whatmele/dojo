export default {
  id: 'tasks',
  scope: 'session',
  dir: '.dojo/sessions/${session_id}/tasks',
  description: 'Task decomposition and execution state.',

  async renderContext({ dir, helpers }) {
    const lines = ['## Tasks', ''];
    const manifest = helpers.readJSON(dir ? `${dir}/manifest.json` : '');
    const taskDirs = helpers.listDirs(dir);

    if (manifest?.tasks?.length) {
      lines.push('Suggested order:', '');
      lines.push('| # | Task | Description | Depends on | Status |');
      lines.push('|---|------|-------------|------------|--------|');

      manifest.tasks.forEach((task, index) => {
        const state = helpers.readJSON(dir ? `${dir}/${task.name}/state.json` : '');
        const deps = Array.isArray(task.depends_on) && task.depends_on.length > 0 ? task.depends_on.join(', ') : '-';
        const desc = task.description || '-';
        const status = state?.is_completed ? 'Done' : 'Todo';
        lines.push(`| ${index + 1} | ${task.name} | ${desc} | ${deps} | ${status} |`);
      });

      return lines.join('\n');
    }

    if (taskDirs.length === 0) {
      lines.push('- No tasks yet.');
      return lines.join('\n');
    }

    for (const taskDir of taskDirs) {
      const state = helpers.readJSON(`${taskDir}/state.json`);
      lines.push(`- ${helpers.relative(taskDir)} (${state?.is_completed ? 'Done' : 'Todo'})`);
    }

    return lines.join('\n');
  },
};
