import * as vscode from 'vscode';
import { detectLayers } from './detect';
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

  /** Adds every repeated folder name found in the workspace; never removes a layer. */
  const rescan = async (announce: boolean): Promise<void> => {
    const found = await detectLayers(excludedNames());
    state.candidates = found;
    const before = state.layers();
    state.setLayers([...before, ...seedLayers(), ...found.keys()]);
    const added = state.layers().filter((l) => !before.includes(l));
    view.rerender();
    if (!announce) return;
    void vscode.window.showInformationMessage(
      added.length
        ? `Layer Lens: added ${added.join(', ')}.`
        : 'Layer Lens: no new layers found. Use "Edit layers" to remove or re-add names.',
    );
  };

  reg('layerLens.rescan', () => rescan(true));

  reg('layerLens.editLayers', async () => {
    const current = state.layers();
    const names = unique([...current, ...state.candidates.keys()]);
    const items = names.map((name) => {
      const n = state.candidates.get(name);
      return { label: name, description: n ? `repeated in ${n} folders` : undefined, picked: current.includes(name) };
    });
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Layer Lens: folder names treated as layers',
      placeHolder: 'Use "Add layer" for a name that is not listed',
    });
    if (!picked) return;
    state.setLayers(picked.map((p) => p.label));
    view.rerender();
  });

  reg('layerLens.addLayer', async () => {
    const name = await vscode.window.showInputBox({
      title: 'Layer Lens: add a layer',
      prompt: 'Folder name to treat as a layer (case-insensitive)',
      validateInput: (v) => {
        const t = v.trim();
        if (!t) return 'Enter a folder name';
        if (/[\\/]/.test(t)) return 'Use a single folder name, without slashes';
        if (state.layers().includes(t.toLowerCase())) return 'That layer already exists';
        return undefined;
      },
    });
    if (!name) return;
    state.setLayers([...state.layers(), name]);
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

  // First time in this workspace: look for repeated folders once.
  if (!state.hasSavedLayers() && autoDetectEnabled()) void rescan(false);

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
