import * as vscode from 'vscode';

const ACTIVE_KEY = 'layerLens.activeLayers';
const OTHERS_KEY = 'layerLens.showOthers';
const FLATTEN_KEY = 'layerLens.flatten';

const DEFAULT_LAYERS = ['application', 'domain', 'infrastructure'];

export function configuredLayers(): string[] {
  const raw = vscode.workspace.getConfiguration('layerLens').get<string[]>('layers', DEFAULT_LAYERS);
  return raw.map((l) => l.trim().toLowerCase()).filter(Boolean);
}

export function excludedNames(): Set<string> {
  const raw = vscode.workspace.getConfiguration('layerLens').get<string[]>('exclude', []);
  return new Set(raw);
}

export class FilterState {
  private active: Set<string>;
  showOthers: boolean;
  flatten: boolean;

  constructor(private readonly memento: vscode.Memento) {
    const stored = memento.get<string[]>(ACTIVE_KEY);
    this.active = new Set((stored ?? configuredLayers()).map((l) => l.toLowerCase()));
    this.showOthers = memento.get<boolean>(OTHERS_KEY, false);
    this.flatten = memento.get<boolean>(
      FLATTEN_KEY,
      vscode.workspace.getConfiguration('layerLens').get<boolean>('flattenLayerFolder', false),
    );
  }

  isActive(layer: string): boolean {
    return this.active.has(layer.toLowerCase());
  }

  activeLayers(): string[] {
    return [...this.active].filter((l) => configuredLayers().includes(l));
  }

  set(layer: string, on: boolean): void {
    if (on) this.active.add(layer.toLowerCase());
    else this.active.delete(layer.toLowerCase());
    this.persist();
  }

  setAll(layers: string[]): void {
    this.active = new Set(layers.map((l) => l.toLowerCase()));
    this.persist();
  }

  toggleOthers(): void {
    this.showOthers = !this.showOthers;
    this.persist();
  }

  toggleFlatten(): void {
    this.flatten = !this.flatten;
    this.persist();
  }

  private persist(): void {
    void this.memento.update(ACTIVE_KEY, [...this.active]);
    void this.memento.update(OTHERS_KEY, this.showOthers);
    void this.memento.update(FLATTEN_KEY, this.flatten);
  }
}
