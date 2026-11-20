import * as vscode from 'vscode';

const ACTIVE_KEY = 'layerLens.activeLayers';
const OTHERS_KEY = 'layerLens.showOthers';
const FLATTEN_KEY = 'layerLens.flatten';
const LAYERS_KEY = 'layerLens.layerList';
const COLORS_KEY = 'layerLens.colors';
const HIDDEN_CONTEXTS_KEY = 'layerLens.hiddenContexts';
const IGNORED_CONTEXTS_KEY = 'layerLens.ignoredContexts';
const AUTO_NAMES_KEY = 'layerLens.autoNames';
const DISPLAY_NAMES_KEY = 'layerLens.displayNames';

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

/**
 * Turns a file name into a readable one: `create-user.dto.ts` -> `Create User Dto`.
 * The last extension is dropped; words split on `-`, `_`, `.`, spaces and camelCase.
 * Words already in capitals (`README`) are kept. Returns undefined when there is nothing to improve.
 */
export function autoDisplayName(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return undefined; // dotfiles such as `.gitignore`, and names without an extension, stay as they are
  const words = fileName
    .slice(0, dot)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)));
  const name = words.join(' ');
  return name && name !== fileName ? name : undefined;
}

export class FilterState {
  private list: string[] | undefined;
  private active: Set<string>;
  private colors: Record<string, string>;
  /** Contexts (folders that hold layer folders) switched off. Only the hidden ones are stored, so new contexts start visible. */
  private hiddenContexts: Set<string>;
  /** Detected contexts the user says are not contexts (e.g. `src`): no chip, and their layers follow the layer filters only. */
  private ignoredContexts: Set<string>;
  /** Names shown in the tree instead of the real ones, keyed by file URI. They never touch the disk. */
  private displayNames: Record<string, string>;
  showOthers: boolean;
  flatten: boolean;
  /** Derive a display name from every file name that has no manual one. */
  autoNames: boolean;
  /** Layer names that have a folder in this workspace right now; undefined until the view has looked. */
  present: Set<string> | undefined;
  /** Every context detected in this workspace right now (lowercase, sorted); empty until the view has looked. */
  detectedContexts: string[] = [];
  /** Names found by the last scan with how many places repeat them (not persisted). */
  candidates = new Map<string, number>();

  constructor(private readonly memento: vscode.Memento) {
    this.list = memento.get<string[]>(LAYERS_KEY);
    this.colors = memento.get<Record<string, string>>(COLORS_KEY, {});
    this.hiddenContexts = new Set(memento.get<string[]>(HIDDEN_CONTEXTS_KEY, []));
    this.ignoredContexts = new Set(memento.get<string[]>(IGNORED_CONTEXTS_KEY, []));
    this.displayNames = memento.get<Record<string, string>>(DISPLAY_NAMES_KEY, {});
    const stored = memento.get<string[]>(ACTIVE_KEY);
    this.active = new Set((stored ?? this.layers()).map((l) => l.toLowerCase()));
    this.showOthers = memento.get<boolean>(OTHERS_KEY, false);
    this.autoNames = memento.get<boolean>(
      AUTO_NAMES_KEY,
      vscode.workspace.getConfiguration('layerLens').get<boolean>('autoDisplayNames', false),
    );
    this.flatten = memento.get<boolean>(
      FLATTEN_KEY,
      vscode.workspace.getConfiguration('layerLens').get<boolean>('flattenLayerFolder', false),
    );
  }

  /** The folder names treated as layers in this workspace: the saved list, or the settings before one exists. */
  layers(): string[] {
    return this.list ?? seedLayers();
  }

  /** The layers that exist in this workspace: the ones worth showing a chip for. */
  shownLayers(): string[] {
    return this.layers().filter((l) => !this.present || this.present.has(l));
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

  /** Visible layers among those that exist here. */
  activeLayers(): string[] {
    return this.shownLayers().filter((l) => this.isActive(l));
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
    this.setShown(already ? this.shownLayers() : [layer]);
  }

  /** Shows the hidden layers and hides the visible ones. */
  invert(): void {
    this.setShown(this.shownLayers().filter((l) => !this.isActive(l)));
  }

  /** Hides every layer when all are visible, otherwise shows them all. */
  toggleAll(): void {
    const shown = this.shownLayers();
    this.setShown(this.activeLayers().length === shown.length ? [] : shown);
  }

  /**
   * Makes exactly these layers visible among those that exist here. Layers with no folder yet
   * keep their state, so they are not hidden when they show up later.
   */
  setShown(visible: string[]): void {
    const shown = new Set(this.shownLayers());
    const kept = [...this.active].filter((l) => !shown.has(l));
    this.active = new Set([...kept, ...visible.map((l) => l.toLowerCase())]);
    this.persist();
  }

  // ---- contexts ----------------------------------------------------------

  /** The contexts that get a chip: the detected ones minus the ones the user ruled out. */
  get contexts(): string[] {
    return this.detectedContexts.filter((c) => !this.ignoredContexts.has(c));
  }

  isContextIgnored(context: string): boolean {
    return this.ignoredContexts.has(context.toLowerCase());
  }

  /** Keeps exactly these detected contexts; the others stop being contexts and are never hidden. */
  setContexts(kept: string[]): void {
    const keep = new Set(kept.map((c) => c.toLowerCase()));
    for (const c of this.detectedContexts) {
      if (keep.has(c)) {
        this.ignoredContexts.delete(c);
      } else {
        this.ignoredContexts.add(c);
        this.hiddenContexts.delete(c);
      }
    }
    this.persist();
  }

  isContextActive(context: string): boolean {
    return !this.hiddenContexts.has(context.toLowerCase());
  }

  /** Visible contexts among those that exist here. */
  activeContexts(): string[] {
    return this.contexts.filter((c) => this.isContextActive(c));
  }

  setContext(context: string, on: boolean): void {
    if (on) this.hiddenContexts.delete(context.toLowerCase());
    else this.hiddenContexts.add(context.toLowerCase());
    this.persist();
  }

  /** Makes exactly these contexts visible among those that exist here; the others keep their state. */
  setShownContexts(visible: string[]): void {
    const keep = new Set(visible.map((c) => c.toLowerCase()));
    for (const c of this.contexts) {
      if (keep.has(c)) this.hiddenContexts.delete(c);
      else this.hiddenContexts.add(c);
    }
    this.persist();
  }

  /** Shows only this context; when it is already the only one, shows every context again. */
  soloContext(context: string): void {
    const only = this.activeContexts();
    const already = only.length === 1 && only[0] === context.toLowerCase();
    this.setShownContexts(already ? this.contexts : [context]);
  }

  invertContexts(): void {
    this.setShownContexts(this.contexts.filter((c) => !this.isContextActive(c)));
  }

  toggleAllContexts(): void {
    this.setShownContexts(this.activeContexts().length === this.contexts.length ? [] : this.contexts);
  }

  // ---- display names -----------------------------------------------------

  displayName(uri: string): string | undefined {
    return this.displayNames[uri];
  }

  /** Sets the name shown for a file, or goes back to the real one when `name` is empty. */
  setDisplayName(uri: string, name: string | undefined): void {
    const next = { ...this.displayNames };
    if (name) next[uri] = name;
    else delete next[uri];
    this.displayNames = next;
    this.persist();
  }

  /** Carries the names of a file (and of everything inside a folder) to where it was moved. Returns whether any changed. */
  moveDisplayNames(from: string, to: string | undefined): boolean {
    const next: Record<string, string> = {};
    let changed = false;
    for (const [key, name] of Object.entries(this.displayNames)) {
      if (key === from || key.startsWith(from + '/')) {
        changed = true;
        if (to !== undefined) next[to + key.slice(from.length)] = name;
      } else {
        next[key] = name;
      }
    }
    if (changed) {
      this.displayNames = next;
      this.persist();
    }
    return changed;
  }

  toggleOthers(): void {
    this.showOthers = !this.showOthers;
    this.persist();
  }

  toggleAutoNames(): void {
    this.autoNames = !this.autoNames;
    this.persist();
  }

  toggleFlatten(): void {
    this.flatten = !this.flatten;
    this.persist();
  }

  /** Whether a path made of these directory segments shows up under the current filters. */
  isVisible(directorySegments: string[]): boolean {
    const layers = this.layers();
    for (let i = 0; i < directorySegments.length; i++) {
      const lower = directorySegments[i].toLowerCase();
      if (!layers.includes(lower)) continue;
      // The folder holding the layer is its context.
      if (i > 0 && !this.isContextActive(directorySegments[i - 1])) return false;
      return this.isActive(lower);
    }
    return this.showOthers;
  }

  private persist(): void {
    void this.memento.update(LAYERS_KEY, this.list);
    void this.memento.update(COLORS_KEY, this.colors);
    void this.memento.update(HIDDEN_CONTEXTS_KEY, [...this.hiddenContexts]);
    void this.memento.update(IGNORED_CONTEXTS_KEY, [...this.ignoredContexts]);
    void this.memento.update(DISPLAY_NAMES_KEY, this.displayNames);
    void this.memento.update(ACTIVE_KEY, [...this.active]);
    void this.memento.update(OTHERS_KEY, this.showOthers);
    void this.memento.update(FLATTEN_KEY, this.flatten);
    void this.memento.update(AUTO_NAMES_KEY, this.autoNames);
  }
}
