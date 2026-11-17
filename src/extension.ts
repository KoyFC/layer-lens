import * as vscode from 'vscode';
import { detectLayers } from './detect';
import { pickLayers } from './layerPicker';
import { FilterState, autoDetectEnabled, excludedNames, seedLayers, unique } from './state';
import { LayerLensView } from './view';

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
    if (typeof target === 'string' && target) {
      const uri = vscode.Uri.parse(target);
      return vscode.workspace.getWorkspaceFolder(uri) && (await isDirectory(uri)) ? uri : undefined;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length <= 1) return folders[0]?.uri;
    return (await vscode.window.showWorkspaceFolderPick())?.uri;
  };

  const create = async (kind: 'file' | 'folder', target?: string): Promise<void> => {
    const parent = await resolveParent(target);
    if (!parent) return;
    const where = vscode.workspace.asRelativePath(parent, false);

    const name = await vscode.window.showInputBox({
      title: kind === 'file' ? 'New file' : 'New folder',
      prompt: `Created in ${where === parent.fsPath || !where ? 'the workspace root' : where}. Use / for nested folders.`,
      validateInput: async (v) => {
        const segments = v.trim().replace(/\/+$/, '').split('/');
        if (!v.trim()) return 'Enter a name';
        if (v.includes('\\') || v.startsWith('/')) return 'Use a relative path with /';
        if (segments.some((s) => !s || s === '.' || s === '..')) return 'Invalid path segment';
        return (await exists(vscode.Uri.joinPath(parent, ...segments))) ? 'That name already exists' : undefined;
      },
    });
    if (!name) return;

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
      void vscode.window.showErrorMessage(`Layer Lens: could not create ${name}: ${(err as Error).message}`);
      return;
    }

    view.refresh();
    if (kind === 'file') await vscode.commands.executeCommand('vscode.open', uri);

    const rel = vscode.workspace.asRelativePath(uri, false).split('/');
    if (!state.isVisible(kind === 'file' ? rel.slice(0, -1) : rel)) {
      void vscode.window.showInformationMessage(
        `Layer Lens: created ${name}, but the current filters hide it. Enable its layer or "Other folders" to see it.`,
      );
    }
  };

  reg('layerLens.newFile', (target?: string) => create('file', target));
  reg('layerLens.newFolder', (target?: string) => create('folder', target));

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
