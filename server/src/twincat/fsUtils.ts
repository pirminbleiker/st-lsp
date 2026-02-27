import * as fs from 'fs';
import * as path from 'path';

/**
 * Recursively collect all files matching a predicate under a directory.
 * Silently skips directories that cannot be read.
 */
export function findFilesSync(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesSync(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}
