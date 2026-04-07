export default {
  id: 'product-requirement',
  scope: 'session',
  dir: '.dojo/sessions/${session_id}/product-requirements',
  description: 'Requirement documents for the active session.',

  async renderContext({ dir, helpers }) {
    const lines = ['## Product Requirements', ''];
    const files = helpers.listMarkdownFiles(dir);

    if (files.length === 0) {
      lines.push('- No files yet.');
      return lines.join('\n');
    }

    for (const file of files) {
      lines.push(`- ${helpers.relative(file)}`);
    }

    return lines.join('\n');
  },
};
