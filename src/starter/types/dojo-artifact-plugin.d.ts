export interface ArtifactPluginHelpers {
  resolveArtifactDir(id: string): string | null;
  listMarkdownFiles(dir: string | null): string[];
  listDirs(dir: string | null): string[];
  readText(filePath: string, maxChars?: number): string;
  readJSON<T>(filePath: string): T | null;
  relative(filePath: string): string;
  pickPreferred(files: string[], preferredNames: string[]): string | null;
}

export interface ArtifactPlugin {
  id: string;
  scope: 'workspace' | 'session' | 'mixed';
  dir: string | null;
  description?: string;
  renderContext(input: {
    dir: string | null;
    helpers: ArtifactPluginHelpers;
    session: {
      id: string;
      description: string;
      status: string;
      external_link?: string;
    };
  }): Promise<string | null> | string | null;
}
