import * as vscode from 'vscode';

const ACTIVE_KEY = 'layerLens.activeLayers';
const OTHERS_KEY = 'layerLens.showOthers';
const FLATTEN_KEY = 'layerLens.flatten';
const LAYERS_KEY = 'layerLens.layerList';
const COLORS_KEY = 'layerLens.colors';

const DEFAULT_LAYERS = ['application', 'domain', 'infrastructure'];

export function unique(list: string[]): string[] {
  return [...new Set(list.map((l) => l.trim().toLowerCase()).filter(Boolean))];
}

/** Layer names from the `layerLens.layers` setting; they seed every workspace's list. */
export function seedLayers(): string[] {
  const raw = vscode.workspace.getConfiguration('layerLens').get<string[]>('layers', DEFAULT_LAYERS);
  return unique(raw);
}

export function autoDetectEnabled(): boolean {
  return vscode.workspace.getConfiguration('layerLens').get<boolean>('autoDetect', true);
}

export function excludedNames(): Set<string> {
  const raw = vscode.workspace.getConfiguration('layerLens').get<string[]>('exclude', []);
  return new Set(raw);
}

export class FilterState {
  private list: string[] | undefined;
  private active: Set<string>;
  private colors: Record<string, string>;
  showOthers: boolean;
  flatten: boolean;
  /** Names found by the last scan with how many places repeat them (not persisted). */
  candidates = new Map<string, number>();

  constructor(private readonly memento: vscode.Memento) {
    this.list = memento.get<string[]>(LAYERS_KEY);
    this.colors = memento.get<Record<string, string>>(COLORS_KEY, {});
    const stored = memento.get<string[]>(ACTIVE_KEY);
    this.active = new Set((stored ?? this.layers()).map((l) => l.toLowerCase()));
    this.showOthers = memento.get<boolean>(OTHERS_KEY, false);
    this.flatten = memento.get<boolean>(
      FLATTEN_KEY,
      vscode.workspace.getConfiguration('layerLens').get<boolean>('flattenLayerFolder', false),
    );
  }

  /** The folder names treated as layers in this workspace: the saved list, or the settings before one exists. */
  layers(): string[] {
    return this.list ?? seedLayers();
  }

  hasSavedLayers(): boolean {
    return this.list !== undefined;
  }

  /** Replaces the list; layers that are new start visible, dropped ones are forgotten. */
  setLayers(layers: string[]): void {
    const next = unique(layers);
    const previous = new Set(this.layers());
    for (const l of next) if (!previous.has(l)) this.active.add(l);
    for (const l of [...this.active]) if (!next.includes(l)) this.active.delete(l);
    this.list = next;
    this.persist();
  }

  /** The color picked by hand for a layer, if any. */
  customColor(layer: string): string | undefined {
    return this.colors[layer.toLowerCase()];
  }

  /** Sets a color, or goes back to the default when `hex` is undefined. */
  setColor(layer: string, hex: string | undefined): void {
    const next = { ...this.colors };
    if (hex) next[layer.toLowerCase()] = hex;
    else delete next[layer.toLowerCase()];
    this.colors = next;
    this.persist();
  }

  isActive(layer: string): boolean {
    return this.active.has(layer.toLowerCase());
  }

  activeLayers(): string[] {
    return this.layers().filter((l) => this.isActive(l));
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

  /** Shows only this layer; when it is already the only one, shows every layer again. */
  solo(layer: string): void {
    const only = this.activeLayers();
    const already = only.length === 1 && only[0] === layer.toLowerCase();
    this.setAll(already ? this.layers() : [layer]);
  }

  /** Shows the hidden layers and hides the visible ones. */
  invert(): void {
    this.setAll(this.layers().filter((l) => !this.isActive(l)));
  }

  /** Hides every layer when all are visible, otherwise shows them all. */
  toggleAll(): void {
    this.setAll(this.activeLayers().length === this.layers().length ? [] : this.layers());
  }

  toggleOthers(): void {
    this.showOthers = !this.showOthers;
    this.persist();
  }

  toggleFlatten(): void {
    this.flatten = !this.flatten;
    this.persist();
  }

  /** Whether a path made of these directory segments shows up under the current filters. */
  isVisible(directorySegments: string[]): boolean {
    const layers = this.layers();
    for (const seg of directorySegments) {
      const lower = seg.toLowerCase();
      if (layers.includes(lower)) return this.isActive(lower);
    }
    return this.showOthers;
  }

  private persist(): void {
    void this.memento.update(LAYERS_KEY, this.list);
    void this.memento.update(COLORS_KEY, this.colors);
    void this.memento.update(ACTIVE_KEY, [...this.active]);
    void this.memento.update(OTHERS_KEY, this.showOthers);
    void this.memento.update(FLATTEN_KEY, this.flatten);
  }
}
