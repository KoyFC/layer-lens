import * as vscode from 'vscode';
import { IconTheme } from './iconTheme';
import { LayerModel } from './layerTree';
import { FilterState } from './state';

const LAYER_COLORS: Record<string, string> = {
  application: '#4d9de0',
  domain: '#3fb68b',
  infrastructure: '#e8a33d',
};
const FALLBACK_COLORS = ['#a77bd9', '#e0607e', '#2ec4c4', '#c9b037', '#8c9bd6', '#d98a6c'];

const COMMANDS = new Set([
  'layerLens.newFile',
  'layerLens.newFolder',
  'layerLens.editLayers',
  'layerLens.editColor',
  'layerLens.rescan',
]);

export function defaultColor(layer: string, index: number): string {
  return LAYER_COLORS[layer] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export class LayerLensView implements vscode.WebviewViewProvider {
  static readonly viewType = 'layerLens.tree';
  private view?: vscode.WebviewView;
  private readonly model: LayerModel;
  private theme: IconTheme | undefined;
  private themeLoaded = false;
  private roots = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: FilterState,
  ) {
    this.model = new LayerModel(state);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.setRoots([media]);
    view.webview.html = this.html(view.webview, media);

    view.webview.onDidReceiveMessage((msg) => void this.onMessage(msg));
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.post();
    });
    view.onDidDispose(() => (this.view = undefined));
  }

  refresh(): void {
    this.model.invalidate();
    void this.post();
  }

  /** Call when the icon theme, the color theme or the installed extensions change. */
  themeChanged(): void {
    this.themeLoaded = false;
    void this.post();
  }

  private setRoots(roots: vscode.Uri[]): void {
    if (!this.view) return;
    const key = roots.map((r) => r.toString()).join('|');
    if (key === this.roots) return;
    this.roots = key;
    this.view.webview.options = { enableScripts: true, localResourceRoots: roots };
  }

  /** Re-posts using cached directory reads (filter changes only). */
  rerender(): void {
    void this.post();
  }

  private async post(): Promise<void> {
    if (!this.view) return;
    const layers = this.state.layers().map((name, i) => ({
      name,
      color: this.state.customColor(name) ?? defaultColor(name, i),
      active: this.state.isActive(name),
    }));
    if (!this.themeLoaded) {
      this.theme = await IconTheme.load();
      this.themeLoaded = true;
    }
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.setRoots(this.theme ? [media, this.theme.root] : [media]);
    const tree = await this.model.build();
    const icons = this.theme?.annotate(tree, this.view.webview) ?? { defs: {}, fonts: [] };
    void this.view.webview.postMessage({
      type: 'model',
      layers,
      showOthers: this.state.showOthers,
      flatten: this.state.flatten,
      tree,
      icons,
      truncated: this.model.truncated,
      colors: Object.fromEntries(layers.map((l) => [l.name, l.color])),
    });
  }

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready':
        return this.post();
      case 'toggleLayer':
        this.state.set(String(msg.layer), !this.state.isActive(String(msg.layer)));
        return this.post();
      case 'toggleOthers':
        this.state.toggleOthers();
        return this.post();
      case 'toggleFlatten':
        this.state.toggleFlatten();
        return this.post();
      case 'command':
        // Only the view's own commands can be triggered from the page.
        if (COMMANDS.has(String(msg.id))) await vscode.commands.executeCommand(String(msg.id), msg.layer ?? msg.uri);
        return;
      case 'open':
      case 'reveal':
      case 'copy': {
        const uri = vscode.Uri.parse(String(msg.uri));
        if (!vscode.workspace.getWorkspaceFolder(uri)) return; // ignore anything outside the workspace
        if (msg.type === 'open') await vscode.commands.executeCommand('vscode.open', uri);
        else if (msg.type === 'reveal') await vscode.commands.executeCommand('revealInExplorer', uri);
        else await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(uri, false));
      }
    }
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'main.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'main.js'));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div class="chips" id="chips" role="group" aria-label="Layer filters"></div>
<div class="chips options" id="options" role="group" aria-label="View options"></div>
<div class="message" id="message" hidden></div>
<div class="tree" id="tree" role="tree"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
