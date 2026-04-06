import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJSON<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function writeJSON(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function listDirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d: fs.Dirent) => d.isDirectory())
    .map((d: fs.Dirent) => d.name);
}

export function listFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d: fs.Dirent) => d.isFile())
    .map((d: fs.Dirent) => d.name);
}

export function createSymlink(target: string, linkPath: string): void {
  ensureDir(path.dirname(linkPath));
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    } else {
      fs.rmSync(linkPath, { recursive: true });
    }
  }
  fs.symlinkSync(path.resolve(target), linkPath, 'dir');
}

/** 创建指向文件的软链；目标路径尽量用相对路径，便于工作区整体搬迁。 */
export function createFileSymlink(targetFile: string, linkPath: string): void {
  const absTarget = path.resolve(targetFile);
  const absLink = path.resolve(linkPath);
  ensureDir(path.dirname(absLink));
  if (fs.existsSync(absLink)) {
    const stat = fs.lstatSync(absLink);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(absLink);
    } else {
      fs.rmSync(absLink, { recursive: true });
    }
  }
  let symlinkTarget = absTarget;
  const rel = path.relative(path.dirname(absLink), absTarget);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    symlinkTarget = rel.split(path.sep).join('/');
  }
  fs.symlinkSync(symlinkTarget, absLink, 'file');
}
