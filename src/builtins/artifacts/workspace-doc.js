export default {
  id: 'workspace-doc',
  scope: 'workspace',
  dir: 'docs',
  description: 'Workspace-level long-form docs.',

  async renderContext({ dir, helpers }) {
    const files = helpers.listMarkdownFiles(dir);

    if (files.length === 0) {
      return null;
    }

    const lines = ['## Workspace Docs', ''];
    for (const file of files) {
      lines.push(`- ${helpers.relative(file)}`);
    }

    return lines.join('\n');
  },
};
