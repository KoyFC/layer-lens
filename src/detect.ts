import * as vscode from 'vscode';

const MAX_DEPTH = 6;
const MAX_READS = 4000;

/**
 * Finds folder names that repeat as direct subfolders of two or more sibling folders,
 * e.g. `contexts/{users,orders}/{application,domain}`. Returns name -> number of folders repeating it.
 */
export async function detectLayers(exclude: Set<string>): Promise<Map<string, number>> {
  const dirCache = new Map<string, string[]>();
  let reads = 0;

  const subdirs = async (dir: vscode.Uri): Promise<string[]> => {
    const key = dir.toString();
    const hit = dirCache.get(key);
    if (hit) return hit;
    let names: string[] = [];
    if (++reads <= MAX_READS) {
      try {
        names = (await vscode.workspace.fs.readDirectory(dir))
          .filter(
            ([name, type]) =>
              (type & vscode.FileType.Directory) !== 0 &&
              (type & vscode.FileType.SymbolicLink) === 0 &&
              !exclude.has(name) &&
              !name.startsWith('.'),
          )
          .map(([name]) => name);
      } catch {
        names = [];
      }
    }
    dirCache.set(key, names);
    return names;
  };

  const counts = new Map<string, number>();

  const visit = async (dir: vscode.Uri, depth: number): Promise<void> => {
    const children = await subdirs(dir);
    const seen = new Map<string, number>();
    for (const child of children) {
      for (const name of new Set(await subdirs(vscode.Uri.joinPath(dir, child)))) {
        const lower = name.toLowerCase();
        seen.set(lower, (seen.get(lower) ?? 0) + 1);
      }
    }
    for (const [name, n] of seen) if (n >= 2) counts.set(name, (counts.get(name) ?? 0) + n);

    if (depth < MAX_DEPTH) {
      for (const child of children) await visit(vscode.Uri.joinPath(dir, child), depth + 1);
    }
  };

  for (const folder of vscode.workspace.workspaceFolders ?? []) await visit(folder.uri, 0);

  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
