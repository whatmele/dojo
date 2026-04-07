export default {
  id: 'research',
  scope: 'session',
  dir: '.dojo/sessions/${session_id}/research',
  description: 'Research notes and technical exploration.',

  async renderContext({ dir, helpers }) {
    const lines = ['## Research', ''];
    const files = helpers.listMarkdownFiles(dir);
    const main = helpers.pickPreferred(files, ['README.md', 'index.md', 'summary.md']);

    if (files.length === 0) {
      lines.push('- No files yet.');
      return lines.join('\n');
    }

    if (main) {
      lines.push(`- Primary document: ${helpers.relative(main)}`);
    }
    for (const file of files) {
      if (file === main) continue;
      lines.push(`- ${helpers.relative(file)}`);
    }

    return lines.join('\n');
  },
};
