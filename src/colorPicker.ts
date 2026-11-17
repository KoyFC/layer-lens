import * as vscode from 'vscode';

export const PRESETS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#4d9de0' },
  { name: 'Green', hex: '#3fb68b' },
  { name: 'Orange', hex: '#e8a33d' },
  { name: 'Purple', hex: '#a77bd9' },
  { name: 'Pink', hex: '#e0607e' },
  { name: 'Teal', hex: '#2ec4c4' },
  { name: 'Yellow', hex: '#c9b037' },
  { name: 'Indigo', hex: '#8c9bd6' },
  { name: 'Coral', hex: '#d98a6c' },
  { name: 'Gray', hex: '#8b949e' },
];

/** Accepts #rgb, #rrggbb, with or without the #, and returns #rrggbb in lowercase. */
export function normalizeHex(input: string): string | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return undefined;
  const h = m[1].toLowerCase();
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
}

/** A round swatch of the color, for the icon of a QuickPick item. */
export function swatch(hex: string): vscode.Uri {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${hex}"/></svg>`;
  return vscode.Uri.parse('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
}

interface ColorItem extends vscode.QuickPickItem {
  hex?: string;
  kind_?: 'default' | 'custom';
}

/**
 * Asks for a layer's color. Resolves with a hex string, `null` to go back to the default,
 * or `undefined` when dismissed.
 */
export async function pickColor(
  layer: string,
  current: string | undefined,
  defaultHex: string,
): Promise<string | null | undefined> {
  const items: ColorItem[] = [
    {
      label: 'Default',
      description: defaultHex,
      iconPath: swatch(defaultHex),
      hex: defaultHex,
      kind_: 'default',
      detail: !current ? 'Currently in use' : undefined,
    },
    ...PRESETS.map((p) => ({
      label: p.name,
      description: p.hex,
      iconPath: swatch(p.hex),
      hex: p.hex,
      detail: current === p.hex ? 'Currently in use' : undefined,
    })),
    { label: 'Custom…', description: 'Enter a hex code such as #ff8800', kind_: 'custom' as const },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: `Layer Lens: color for ${layer}`,
    placeHolder: 'Choose a color',
  });
  if (!picked) return undefined;
  if (picked.kind_ === 'default') return null;
  if (picked.kind_ !== 'custom') return picked.hex;

  const typed = await vscode.window.showInputBox({
    title: `Layer Lens: custom color for ${layer}`,
    prompt: 'Hex code, e.g. #ff8800 or f80',
    value: current ?? '',
    validateInput: (v) => (normalizeHex(v) ? undefined : 'Use a hex code like #ff8800 or #f80'),
  });
  return typed ? normalizeHex(typed) : undefined;
}
