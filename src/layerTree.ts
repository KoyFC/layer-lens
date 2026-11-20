import * as vscode from 'vscode';
import { FilterState, excludedNames } from './state';

const MAX_DEPTH = 12;
const MAX_NODES = 8000;

/** Plain, serializable tree node sent to the webview. */
export interface TreeNode {
  key: string;
  uri: string;
  label: string;
  isDir: boolean;
  /** Layer this node belongs to (lowercase) when it lives inside a layer folder. */
  layer?: string;
  /** True for the layer folder itself (e.g. `application`). */
  layerRoot?: boolean;
  /** Name given in Layer Lens only; `label` is then that name and `description` the real one. */
  hasDisplayName?: boolean;
  /** The real file name, shown dimmed beside a display name. */
  description?: string;
  /** The name on disk (the label is a display name or a compacted path). */
  name?: string;
  /** True for a workspace folder shown as a root in a multi-root workspace. */
  workspaceRoot?: boolean;
  /** Icon theme definition ids, set by IconTheme.annotate. */
  icon?: string;
  iconOpen?: string;
  children?: TreeNode[];
}

interface Entry {
  name: string;
  isDir: boolean;
}

export class LayerModel {
  private readonly dirCache = new Map<string, Entry[]>();
  private readonly containsCache = new Map<string, boolean>();
  private budget = 0;
  truncated = false;
  /** Contexts seen by the last full `presentLayers` scan. */
  contexts: string[] = [];

  constructor(private readonly state: FilterState) {}

  /** The given layer names that exist as a folder anywhere in the workspace (excluded folders aside). */
  async presentLayers(names: string[], collectContexts = false): Promise<Set<string>> {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const found = new Set<string>();
    const contexts = new Set<string>();
    const exclude = excludedNames();
    let budget = MAX_NODES;

    const visit = async (dir: vscode.Uri, depth: number): Promise<void> => {
      if ((!collectContexts && found.size === wanted.size) || depth > MAX_DEPTH || budget-- <= 0) return;
      const context = this.contextOf(dir);
      for (const e of await this.read(dir)) {
        if (!e.isDir || exclude.has(e.name)) continue;
        const lower = e.name.toLowerCase();
        if (!wanted.has(lower)) continue;
        found.add(lower);
        if (context && !wanted.has(context)) contexts.add(context);
      }
      for (const e of await this.read(dir)) {
        if (!collectContexts && found.size === wanted.size) return;
        if (e.isDir && !exclude.has(e.name)) await visit(vscode.Uri.joinPath(dir, e.name), depth + 1);
      }
    };

    for (const f of vscode.workspace.workspaceFolders ?? []) await visit(f.uri, 0);
    if (collectContexts) this.contexts = [...contexts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return found;
  }

  /** The context a layer folder inside `dir` belongs to: the name of `dir`, unless it is a workspace folder. */
  private contextOf(dir: vscode.Uri): string | undefined {
    if ((vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.toString() === dir.toString())) return undefined;
    return dir.path.slice(dir.path.lastIndexOf('/') + 1).toLowerCase() || undefined;
  }

  invalidate(): void {
    this.dirCache.clear();
    this.containsCache.clear();
  }

  async build(): Promise<TreeNode[]> {
    this.budget = 0;
    this.truncated = false;
    this.containsCache.clear(); // depends on the filters, which may have changed since the last build
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) {
      return this.populate(await this.visibleChildren(folders[0].uri, undefined));
    }
    const roots: TreeNode[] = [];
    for (const f of folders) {
      const children = await this.visibleChildren(f.uri, undefined);
      if (children.length === 0) continue;
      roots.push({
        key: f.uri.toString(),
        uri: f.uri.toString(),
        label: f.name,
        isDir: true,
        workspaceRoot: true,
        children: await this.populate(children),
      });
    }
    return roots;
  }

  private async populate(nodes: TreeNode[]): Promise<TreeNode[]> {
    for (const n of nodes) {
      if (!n.isDir || n.children) continue;
      if (++this.budget > MAX_NODES) {
        this.truncated = true;
        n.children = [];
        continue;
      }
      n.children = await this.populate(await this.visibleChildren(vscode.Uri.parse(n.uri), n.layer));
    }
    return nodes;
  }

  private node(uri: vscode.Uri, label: string, isDir: boolean, layer?: string, layerRoot = false): TreeNode {
    const alias = this.state.displayName(uri.toString());
    return {
      key: `${uri.toString()}|${label}`,
      uri: uri.toString(),
      label: alias ?? label,
      name: label,
      hasDisplayName: alias ? true : undefined,
      description: alias ? label : undefined,
      isDir,
      layer,
      layerRoot: layerRoot || undefined,
    };
  }

  private async visibleChildren(dir: vscode.Uri, layer: string | undefined): Promise<TreeNode[]> {
    const layers = this.state.layers();
    const exclude = excludedNames();
    const activeCount = this.state.activeLayers().length;
    const context = this.contextOf(dir);
    const contextHidden = context !== undefined && !this.state.isContextActive(context);
    const out: TreeNode[] = [];

    for (const e of await this.read(dir)) {
      if (exclude.has(e.name)) continue;
      const uri = vscode.Uri.joinPath(dir, e.name);

      if (layer) {
        out.push(this.node(uri, e.name, e.isDir, layer));
        continue;
      }
      if (!e.isDir) {
        if (this.state.showOthers) out.push(this.node(uri, e.name, false));
        continue;
      }

      const lower = e.name.toLowerCase();
      if (layers.includes(lower)) {
        if (contextHidden || !this.state.isActive(lower)) continue;
        if (this.state.flatten && activeCount === 1) {
          out.push(...(await this.visibleChildren(uri, lower)));
        } else {
          out.push(this.node(uri, e.name, true, lower, true));
        }
        continue;
      }

      if (this.state.showOthers || (await this.containsActiveLayer(uri, 1))) {
        out.push(await this.compact(this.node(uri, e.name, true)));
      }
    }

    return out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  /** Merges chains of single-child plain directories ("a/b/c"), like explorer.compactFolders. */
  private async compact(node: TreeNode): Promise<TreeNode> {
    let current = node;
    for (let i = 0; i < MAX_DEPTH; i++) {
      const kids = await this.visibleChildren(vscode.Uri.parse(current.uri), undefined);
      if (kids.length !== 1) break;
      const only = kids[0];
      if (!only.isDir || only.layer) break;
      current = { ...only, key: `${only.uri}|${current.label}/${only.label}`, label: `${current.label}/${only.label}` };
    }
    return current;
  }

  private async containsActiveLayer(dir: vscode.Uri, depth: number): Promise<boolean> {
    const key = dir.toString();
    const cached = this.containsCache.get(key);
    if (cached !== undefined) return cached;
    if (depth > MAX_DEPTH) return false;

    const layers = this.state.layers();
    const exclude = excludedNames();
    const context = this.contextOf(dir);
    const contextHidden = context !== undefined && !this.state.isContextActive(context);
    let found = false;
    for (const e of await this.read(dir)) {
      if (!e.isDir || exclude.has(e.name)) continue;
      const lower = e.name.toLowerCase();
      if (layers.includes(lower)) {
        if (!contextHidden && this.state.isActive(lower)) {
          found = true;
          break;
        }
        continue;
      }
      if (await this.containsActiveLayer(vscode.Uri.joinPath(dir, e.name), depth + 1)) {
        found = true;
        break;
      }
    }
    this.containsCache.set(key, found);
    return found;
  }

  private async read(dir: vscode.Uri): Promise<Entry[]> {
    const key = dir.toString();
    const cached = this.dirCache.get(key);
    if (cached) return cached;
    let entries: Entry[] = [];
    try {
      const raw = await vscode.workspace.fs.readDirectory(dir);
      entries = raw.map(([name, type]) => ({
        name,
        // Symlinked directories are treated as files to avoid cycles.
        isDir: (type & vscode.FileType.Directory) !== 0 && (type & vscode.FileType.SymbolicLink) === 0,
      }));
    } catch {
      entries = [];
    }
    this.dirCache.set(key, entries);
    return entries;
  }
}
