import * as vscode from 'vscode';
import { FilterState, configuredLayers } from './state';
import { LayerLensView } from './view';

export function activate(context: vscode.ExtensionContext): void {
  const state = new FilterState(context.workspaceState);
  const view = new LayerLensView(context.extensionUri, state);

  const reg = (id: string, fn: () => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LayerLensView.viewType, view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  reg('layerLens.pickLayers', async () => {
    const items = configuredLayers().map((l) => ({ label: l, picked: state.isActive(l) }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Layer Lens: visible layers',
    });
    if (!picked) return;
    state.setAll(picked.map((p) => p.label));
    view.rerender();
  });
  reg('layerLens.showAll', () => {
    state.setAll(configuredLayers());
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
      if (e.affectsConfiguration('layerLens')) view.refresh();
      if (e.affectsConfiguration('workbench.iconTheme')) view.themeChanged();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => view.themeChanged()),
    vscode.extensions.onDidChange(() => view.themeChanged()),
    { dispose: () => timer && clearTimeout(timer) },
  );
}

export function deactivate(): void {}
