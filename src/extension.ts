import * as vscode from 'vscode';
import { detectLayers } from './detect';
import { pickColor, swatch } from './colorPicker';
import { pickLayers } from './layerPicker';
import { FilterState, autoDetectEnabled, excludedNames, seedLayers, unique } from './state';
import { LayerLensView, defaultColor } from './view';

/** Commands get a plain string from the page's buttons, or the `data-vscode-context` object from a right-click menu. */
function argOf(arg: unknown, key: 'uri' | 'layer'): string | undefined {
  if (typeof arg === 'string') return arg;
  const value = arg && typeof arg === 'object' ? (arg as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const state = new FilterState(context.workspaceState);
  const view = new LayerLensView(context.extensionUri, state);

  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LayerLensView.viewType, view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // ---- layers ------------------------------------------------------------

  /**
   * Looks for repeated folder names and lets the user confirm them, uncheck false positives
   * and type in any that were missed. Never removes a layer that is already in the list.
   */
  const rescan = async (first: boolean): Promise<void> => {
    const found = await detectLayers(excludedNames());
    state.candidates = found;
    const current = state.layers();
    const names = unique([...current, ...seedLayers(), ...found.keys()]);
    const fresh = names.filter((n) => !current.includes(n));

    // The first time, anything detected is worth confirming; later, only names not yet in the list.
    if (first ? found.size === 0 : fresh.length === 0) {
      if (first) state.setLayers(names);
      else void vscode.window.showInformationMessage('Layer Lens: no new layers found. Use "Edit layers" to change the list.');
      view.rerender();
      return;
    }

    const rows = names.map((name) => {
      const n = found.get(name);
      return {
        name,
        description: n ? `repeated in ${n} folders` : !first && current.includes(name) ? 'already a layer' : 'from settings',
        checked: true,
      };
    });
    const picked = await pickLayers(
      rows,
      first ? 'Layer Lens: layers found in this workspace' : 'Layer Lens: layers found by the scan',
      'Uncheck what is not a layer. Missing one? Type its folder name above.',
    );
    // Dismissing the first prompt keeps what was found, so it does not come back on every start.
    if (picked) state.setLayers(picked);
    else if (first) state.setLayers(names);
    view.rerender();
  };

  reg('layerLens.rescan', () => rescan(false));

  reg('layerLens.editLayers', async () => {
    const current = state.layers();
    const names = unique([...current, ...state.candidates.keys()]);
    const picked = await pickLayers(
      names.map((name) => {
        const n = state.candidates.get(name);
        return { name, description: n ? `repeated in ${n} folders` : undefined, checked: current.includes(name) };
      }),
      'Layer Lens: folder names treated as layers',
      'Check the layers. Missing one? Type its folder name above.',
    );
    if (!picked) return;
    state.setLayers(picked);
    view.rerender();
  });

  reg('layerLens.editColor', async (arg?: unknown) => {
    const layers = state.layers();
    const colorOf = (name: string) => state.customColor(name) ?? defaultColor(name, layers.indexOf(name));

    let name = argOf(arg, 'layer')?.toLowerCase();
    if (!name || !layers.includes(name)) {
      const choice = await vscode.window.showQuickPick(
        layers.map((l) => ({ label: l, description: colorOf(l), iconPath: swatch(colorOf(l)) })),
        { title: 'Layer Lens: change a layer color', placeHolder: 'Choose a layer' },
      );
      if (!choice) return;
      name = choice.label;
    }

    const picked = await pickColor(name, state.customColor(name), defaultColor(name, layers.indexOf(name)));
    if (picked === undefined) return;
    state.setColor(name, picked ?? undefined);
    view.rerender();
  });

  reg('layerLens.pickLayers', async () => {
    const items = state.layers().map((l) => ({ label: l, picked: state.isActive(l) }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Layer Lens: visible layers',
    });
    if (!picked) return;
    state.setAll(picked.map((p) => p.label));
    view.rerender();
  });
  reg('layerLens.soloLayer', (arg?: unknown) => {
    const layer = argOf(arg, 'layer');
    if (!layer) return;
    state.solo(layer);
    view.rerender();
  });
  reg('layerLens.hideAll', () => {
    state.setAll([]);
    view.rerender();
  });
  reg('layerLens.invertLayers', () => {
    state.invert();
    view.rerender();
  });
  reg('layerLens.showAll', () => {
    state.setAll(state.layers());
    view.rerender();
  });
  reg('layerLens.toggleOthers', () => {
    state.toggleOthers();
    view.rerender();
  });
  reg('layerLens.toggleFlatten', () => {
    state.toggleFlatten();
    view.rerender();
  });
  reg('layerLens.refresh', () => view.refresh());

  // First time in this workspace: look for repeated folders once and ask the user to confirm them.
  if (!state.hasSavedLayers() && autoDetectEnabled()) void rescan(true);

  // ---- new files and folders --------------------------------------------

  const isDirectory = async (uri: vscode.Uri): Promise<boolean> => {
    try {
      return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
    } catch {
      return false;
    }
  };

  const exists = async (uri: vscode.Uri): Promise<boolean> => {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  };

  /** The folder to create in: the given one, or the workspace root. */
  const resolveParent = async (target?: string): Promise<vscode.Uri | undefined> => {
    if (target) {
      const uri = vscode.Uri.parse(target);
      if (!vscode.workspace.getWorkspaceFolder(uri)) return undefined;
      // Like the Explorer: for a file, create next to it.
      return (await isDirectory(uri)) ? uri : vscode.Uri.joinPath(uri, '..');
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length <= 1) return folders[0]?.uri;
    return (await vscode.window.showWorkspaceFolderPick())?.uri;
  };

  /** Why `value` cannot be created in `parent`, or undefined when it can. */
  const validateName = async (parent: vscode.Uri, value: string): Promise<string | undefined> => {
    const trimmed = value.trim();
    if (!trimmed) return 'Enter a name';
    if (trimmed.includes('\\') || trimmed.startsWith('/')) return 'Use a relative path with /';
    const segments = trimmed.replace(/\/+$/, '').split('/');
    if (segments.some((s) => !s || s === '.' || s === '..')) return 'Invalid path segment';
    return (await exists(vscode.Uri.joinPath(parent, ...segments))) ? 'That name already exists' : undefined;
  };

  /** Creates the file or folder. Resolves with an error message, or undefined on success. */
  const createAt = async (kind: 'file' | 'folder', parent: vscode.Uri, name: string): Promise<string | undefined> => {
    const problem = await validateName(parent, name);
    if (problem) return problem;

    const segments = name.trim().replace(/\/+$/, '').split('/');
    const uri = vscode.Uri.joinPath(parent, ...segments);
    try {
      if (kind === 'folder') {
        await vscode.workspace.fs.createDirectory(uri);
      } else {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      }
    } catch (err) {
      return `Could not create it: ${(err as Error).message}`;
    }

    view.refresh();
    if (kind === 'file') await vscode.commands.executeCommand('vscode.open', uri);

    const rel = vscode.workspace.asRelativePath(uri, false).split('/');
    if (!state.isVisible(kind === 'file' ? rel.slice(0, -1) : rel)) {
      void vscode.window.showInformationMessage(
        `Layer Lens: created ${name}, but the current filters hide it. Enable its layer or "Other folders" to see it.`,
      );
    }
    return undefined;
  };

  /** The fallback when the name cannot be typed in the tree: an input box at the top of the window. */
  const createWithPopup = async (kind: 'file' | 'folder', parent: vscode.Uri): Promise<void> => {
    const where = vscode.workspace.asRelativePath(parent, false);
    const name = await vscode.window.showInputBox({
      title: kind === 'file' ? 'New file' : 'New folder',
      prompt: `Created in ${where === parent.fsPath || !where ? 'the workspace root' : where}. Use / for nested folders.`,
      validateInput: (v) => validateName(parent, v),
    });
    if (!name) return;
    const error = await createAt(kind, parent, name);
    if (error) void vscode.window.showErrorMessage(`Layer Lens: ${error}`);
  };

  const create = async (kind: 'file' | 'folder', target?: string): Promise<void> => {
    const parent = await resolveParent(target);
    if (!parent) return;
    // Like the Explorer, ask for the name in the tree itself when it is showing.
    if (view.startInlineCreate(kind, parent)) return;
    await createWithPopup(kind, parent);
  };

  // Called by the page: it types the name in the tree and asks for it to be created.
  reg('layerLens.createNamed', (kind?: unknown, uri?: unknown, name?: unknown) => {
    if ((kind !== 'file' && kind !== 'folder') || typeof uri !== 'string' || typeof name !== 'string') return 'Invalid request';
    const parent = vscode.Uri.parse(uri);
    if (!vscode.workspace.getWorkspaceFolder(parent)) return 'Outside the workspace';
    return createAt(kind, parent, name);
  });
  reg('layerLens.createWithPopup', (kind?: unknown, uri?: unknown) => {
    if ((kind !== 'file' && kind !== 'folder') || typeof uri !== 'string') return;
    const parent = vscode.Uri.parse(uri);
    if (vscode.workspace.getWorkspaceFolder(parent)) return createWithPopup(kind, parent);
  });

  reg('layerLens.newFile', (arg?: unknown) => create('file', argOf(arg, 'uri')));
  reg('layerLens.newFolder', (arg?: unknown) => create('folder', argOf(arg, 'uri')));

  const inWorkspace = (arg: unknown): vscode.Uri | undefined => {
    const text = argOf(arg, 'uri');
    const uri = text ? vscode.Uri.parse(text) : undefined;
    return uri && vscode.workspace.getWorkspaceFolder(uri) ? uri : undefined;
  };
  const isWorkspaceRoot = (uri: vscode.Uri): boolean =>
    (vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.toString() === uri.toString());
  const baseName = (uri: vscode.Uri): string => uri.path.slice(uri.path.lastIndexOf('/') + 1);

  /** Renames in place through a workspace edit, so extensions can update imports like the Explorer does. */
  const renameTo = async (uri: vscode.Uri, name: string): Promise<string | undefined> => {
    const next = name.trim();
    if (!next) return 'Enter a name';
    if (/[\\/]/.test(next) || next === '.' || next === '..') return 'Names cannot contain slashes';
    const target = vscode.Uri.joinPath(uri, '..', next);
    if (target.toString() === uri.toString()) return undefined;
    if (await exists(target)) return 'That name already exists';
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(uri, target);
    if (!(await vscode.workspace.applyEdit(edit))) return 'Could not rename it';
    view.refresh();
    return undefined;
  };

  reg('layerLens.rename', async (arg?: unknown) => {
    const uri = inWorkspace(arg);
    if (!uri || isWorkspaceRoot(uri)) return;
    if (view.startInlineRename(uri)) return;
    const name = await vscode.window.showInputBox({ title: 'Rename', value: baseName(uri), validateInput: (v) => (v.trim() ? undefined : 'Enter a name') });
    if (!name) return;
    const error = await renameTo(uri, name);
    if (error) void vscode.window.showErrorMessage(`Layer Lens: ${error}`);
  });
  // Called by the page once a new name has been typed in the tree.
  reg('layerLens.renameTo', (uriText?: unknown, name?: unknown) => {
    if (typeof uriText !== 'string' || typeof name !== 'string') return 'Invalid request';
    const uri = vscode.Uri.parse(uriText);
    if (!vscode.workspace.getWorkspaceFolder(uri) || isWorkspaceRoot(uri)) return 'Outside the workspace';
    return renameTo(uri, name);
  });

  reg('layerLens.delete', async (arg?: unknown) => {
    const uri = inWorkspace(arg);
    if (!uri || isWorkspaceRoot(uri)) return;
    const name = baseName(uri);
    const settings = vscode.workspace.getConfiguration();
    const useTrash = settings.get<boolean>('files.enableTrash', true);

    // Same switches and wording as the Explorer.
    if (settings.get<boolean>('explorer.confirmDelete', true)) {
      const action = useTrash ? 'Move to Trash' : 'Delete';
      const what = (await isDirectory(uri)) ? `'${name}' and its contents` : `'${name}'`;
      const picked = await vscode.window.showWarningMessage(
        `Are you sure you want to delete ${what}?`,
        { modal: true, detail: useTrash ? 'You can restore it from the Trash.' : 'This action is irreversible!' },
        action,
      );
      if (picked !== action) return;
    }

    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash });
    } catch (err) {
      if (!useTrash) {
        void vscode.window.showErrorMessage(`Layer Lens: could not delete ${name}: ${(err as Error).message}`);
        return;
      }
      const permanent = 'Delete Permanently';
      const picked = await vscode.window.showWarningMessage(
        `Could not move '${name}' to the Trash. Delete it permanently instead?`,
        { modal: true, detail: (err as Error).message },
        permanent,
      );
      if (picked !== permanent) return;
      try {
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
      } catch (err2) {
        void vscode.window.showErrorMessage(`Layer Lens: could not delete ${name}: ${(err2 as Error).message}`);
        return;
      }
    }
    view.refresh();
  });

  // ---- copy, paste and duplicate -----------------------------------------

  /** What was copied; kept here because the API cannot put files on the system clipboard. */
  let copied: vscode.Uri | undefined;
  const setCopied = (uri: vscode.Uri | undefined): void => {
    copied = uri;
    void vscode.commands.executeCommand('setContext', 'layerLens.hasCopy', uri !== undefined);
  };
  setCopied(undefined);

  /** `name`, or `name copy`, `name copy 2`… when that is taken; the extension stays before the suffix. */
  const freeUri = async (dir: vscode.Uri, name: string, isDir: boolean): Promise<vscode.Uri> => {
    const first = vscode.Uri.joinPath(dir, name);
    if (!(await exists(first))) return first;
    const dot = name.lastIndexOf('.');
    const stem = !isDir && dot > 0 ? name.slice(0, dot) : name;
    const ext = !isDir && dot > 0 ? name.slice(dot) : '';
    for (let n = 1; n < 1000; n++) {
      const candidate = vscode.Uri.joinPath(dir, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`);
      if (!(await exists(candidate))) return candidate;
    }
    throw new Error('Too many copies of this name');
  };

  /** Copies `source` into `dir` under a free name; reports a problem instead of throwing. */
  const copyInto = async (source: vscode.Uri, dir: vscode.Uri): Promise<vscode.Uri | undefined> => {
    try {
      if (dir.toString() === source.toString() || (dir.path + '/').startsWith(source.path + '/')) {
        throw new Error('A folder cannot be pasted into itself');
      }
      const target = await freeUri(dir, baseName(source), await isDirectory(source));
      await vscode.workspace.fs.copy(source, target, { overwrite: false });
      view.refresh();
      return target;
    } catch (err) {
      void vscode.window.showErrorMessage(`Layer Lens: ${(err as Error).message}`);
      return undefined;
    }
  };

  reg('layerLens.copy', (arg?: unknown) => {
    const uri = inWorkspace(arg);
    if (!uri || isWorkspaceRoot(uri)) return;
    setCopied(uri);
    vscode.window.setStatusBarMessage(`Layer Lens: copied ${baseName(uri)}`, 2500);
  });

  reg('layerLens.paste', async (arg?: unknown) => {
    if (!copied) return;
    if (!(await exists(copied))) {
      setCopied(undefined);
      void vscode.window.showWarningMessage('Layer Lens: the copied item no longer exists.');
      return;
    }
    const dir = await resolveParent(argOf(arg, 'uri'));
    if (!dir) return;
    const target = await copyInto(copied, dir);
    if (target) vscode.window.setStatusBarMessage(`Layer Lens: pasted ${baseName(target)}`, 2500);
  });

  reg('layerLens.duplicate', async (arg?: unknown) => {
    const uri = inWorkspace(arg);
    if (!uri || isWorkspaceRoot(uri)) return;
    const target = await copyInto(uri, vscode.Uri.joinPath(uri, '..'));
    if (target) vscode.window.setStatusBarMessage(`Layer Lens: created ${baseName(target)}`, 2500);
  });

  reg('layerLens.reveal', async (arg?: unknown) => {
    const uri = inWorkspace(arg);
    if (uri) await vscode.commands.executeCommand('revealInExplorer', uri);
  });
  reg('layerLens.copyRelativePath', async (arg?: unknown) => {
    const uri = inWorkspace(arg);
    if (uri) await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(uri, false));
  });

  // ---- refreshing --------------------------------------------------------

  // Auto-refresh on file system changes (debounced).
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => view.refresh(), 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(schedule),
    watcher.onDidDelete(schedule),
    vscode.workspace.onDidChangeWorkspaceFolders(schedule),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('layerLens.layers')) state.setLayers([...state.layers(), ...seedLayers()]);
      if (e.affectsConfiguration('layerLens')) view.refresh();
      if (e.affectsConfiguration('workbench.iconTheme')) view.themeChanged();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => view.themeChanged()),
    vscode.extensions.onDidChange(() => view.themeChanged()),
    { dispose: () => timer && clearTimeout(timer) },
  );
}

export function deactivate(): void {}
