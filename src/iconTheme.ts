import * as vscode from 'vscode';
import { TreeNode } from './layerTree';

type Table = Record<string, string>;

interface IconDef {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
  fontSize?: string;
  fontId?: string;
}

interface ThemeFont {
  id: string;
  src: { path: string; format: string }[];
  weight?: string;
  style?: string;
  size?: string;
}

interface Tables {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileNames?: Table;
  fileExtensions?: Table;
  languageIds?: Table;
  folderNames?: Table;
  folderNamesExpanded?: Table;
}

interface ThemeJson extends Tables {
  iconDefinitions?: Record<string, IconDef>;
  fonts?: ThemeFont[];
  light?: Tables;
  highContrast?: Tables;
}

/** Icon data in the shape the webview consumes. */
export interface WebviewIcons {
  defs: Record<string, { src?: string; char?: string; color?: string; family?: string; size?: string }>;
  fonts: { family: string; sources: { url: string; format: string }[]; weight?: string; style?: string }[];
}

/** Maps file names and extensions to language ids using every installed extension's contributions. */
class LanguageMap {
  private readonly byName = new Map<string, string>();
  private readonly byExt = new Map<string, string>();

  constructor() {
    for (const ext of vscode.extensions.all) {
      const langs = ext.packageJSON?.contributes?.languages;
      if (!Array.isArray(langs)) continue;
      for (const l of langs) {
        if (!l?.id) continue;
        for (const f of l.filenames ?? []) if (!this.byName.has(f)) this.byName.set(f, l.id);
        for (const e of l.extensions ?? []) if (!this.byExt.has(e.toLowerCase())) this.byExt.set(e.toLowerCase(), l.id);
      }
    }
  }

  languageOf(name: string): string | undefined {
    const direct = this.byName.get(name) ?? this.byName.get(name.toLowerCase());
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (let i = lower.indexOf('.'); i !== -1; i = lower.indexOf('.', i + 1)) {
      const id = this.byExt.get(lower.slice(i));
      if (id) return id;
    }
    return undefined;
  }
}

/** The file icon theme selected in `workbench.iconTheme`, resolved for the current color theme kind. */
export class IconTheme {
  private constructor(
    private readonly json: ThemeJson,
    private readonly overrides: Tables | undefined,
    /** Directory of the theme JSON; icon paths are relative to it. */
    private readonly dir: vscode.Uri,
    /** Root of the extension that ships the theme; the webview must be allowed to read it. */
    readonly root: vscode.Uri,
    private readonly languages: LanguageMap,
  ) {}

  static async load(): Promise<IconTheme | undefined> {
    const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
    if (!id) return undefined;

    for (const ext of vscode.extensions.all) {
      const themes = ext.packageJSON?.contributes?.iconThemes;
      const match = Array.isArray(themes) ? themes.find((t: any) => t.id === id) : undefined;
      if (!match?.path) continue;
      try {
        const file = vscode.Uri.joinPath(ext.extensionUri, match.path);
        const json = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8')) as ThemeJson;
        const kind = vscode.window.activeColorTheme.kind;
        const overrides =
          kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
            ? json.light
            : kind === vscode.ColorThemeKind.HighContrast
              ? json.highContrast
              : undefined;
        return new IconTheme(json, overrides, vscode.Uri.joinPath(file, '..'), ext.extensionUri, new LanguageMap());
      } catch {
        return undefined; // unreadable or non-strict JSON: fall back to the generic icons
      }
    }
    return undefined;
  }

  /** Looks `key` up in the theme-kind overrides first, then in the base tables. */
  private table(key: keyof Tables): Table {
    return { ...((this.json[key] as Table | undefined) ?? {}), ...((this.overrides?.[key] as Table | undefined) ?? {}) };
  }

  private single(key: 'file' | 'folder' | 'folderExpanded'): string | undefined {
    return this.overrides?.[key] ?? this.json[key];
  }

  private cache = new Map<string, Table>();
  private tableOf(key: keyof Tables): Table {
    let t = this.cache.get(key);
    if (!t) this.cache.set(key, (t = this.table(key)));
    return t;
  }

  fileIcon(name: string): string | undefined {
    const lower = name.toLowerCase();
    const byName = this.tableOf('fileNames')[lower];
    if (byName) return byName;

    const exts = this.tableOf('fileExtensions');
    for (let i = lower.indexOf('.'); i !== -1; i = lower.indexOf('.', i + 1)) {
      const hit = exts[lower.slice(i + 1)];
      if (hit) return hit;
    }

    const lang = this.languages.languageOf(name);
    const byLang = lang ? this.tableOf('languageIds')[lang] : undefined;
    return byLang ?? this.single('file');
  }

  folderIcon(name: string, expanded: boolean): string | undefined {
    const names = this.tableOf(expanded ? 'folderNamesExpanded' : 'folderNames');
    return names[name.toLowerCase()] ?? this.single(expanded ? 'folderExpanded' : 'folder');
  }

  /** Sets `icon`/`iconOpen` on every node and returns the definitions the webview needs. */
  annotate(nodes: TreeNode[], webview: vscode.Webview): WebviewIcons {
    const used = new Set<string>();
    const walk = (list: TreeNode[]): void => {
      for (const n of list) {
        // Compacted folders ("a/b/c") are named after their last segment.
        const base = n.label.slice(n.label.lastIndexOf('/') + 1);
        if (n.isDir) {
          n.icon = this.folderIcon(base, false);
          n.iconOpen = this.folderIcon(base, true);
          if (n.icon) used.add(n.icon);
          if (n.iconOpen) used.add(n.iconOpen);
          walk(n.children ?? []);
        } else {
          n.icon = this.fileIcon(base);
          if (n.icon) used.add(n.icon);
        }
      }
    };
    walk(nodes);
    return this.payload(used, webview);
  }

  private payload(used: Set<string>, webview: vscode.Webview): WebviewIcons {
    const fonts = this.json.fonts ?? [];
    const defs: WebviewIcons['defs'] = {};

    for (const id of used) {
      const def = this.json.iconDefinitions?.[id];
      if (!def) continue;
      if (def.iconPath) {
        defs[id] = { src: webview.asWebviewUri(vscode.Uri.joinPath(this.dir, def.iconPath)).toString() };
      } else if (def.fontCharacter) {
        const font = fonts.find((f) => f.id === (def.fontId ?? fonts[0]?.id));
        const code = parseInt(def.fontCharacter.replace(/^\\/, ''), 16);
        if (!font || Number.isNaN(code)) continue;
        defs[id] = {
          char: String.fromCodePoint(code),
          color: def.fontColor,
          family: `ll-${font.id}`,
          size: def.fontSize ?? font.size,
        };
      }
    }

    return {
      defs,
      fonts: fonts.map((f) => ({
        family: `ll-${f.id}`,
        weight: f.weight,
        style: f.style,
        sources: f.src.map((s) => ({
          url: webview.asWebviewUri(vscode.Uri.joinPath(this.dir, s.path)).toString(),
          format: s.format,
        })),
      })),
    };
  }
}
