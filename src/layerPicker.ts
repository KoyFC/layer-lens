import * as vscode from 'vscode';

export interface LayerRow {
  name: string;
  description?: string;
  checked: boolean;
}

const NEW_ITEM_DESCRIPTION = 'add as a new layer';

/**
 * A checklist of folder names. Typing a name that is not listed offers to add it.
 * Resolves with the checked names, or undefined when dismissed.
 */
export function pickLayers(rows: LayerRow[], title: string, prompt: string): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const known = new Map(rows.map((r) => [r.name, r.description]));
    const checked = new Set(rows.filter((r) => r.checked).map((r) => r.name));

    const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
    qp.title = title;
    // The placeholder is cut off by the "N selected" badge, so it stays short and the explanation goes in the prompt.
    qp.placeholder = 'Type a folder name to add a layer';
    qp.prompt = prompt;
    qp.canSelectMany = true;
    qp.ignoreFocusOut = true; // an accidental click elsewhere must not discard the choices

    let building = false;
    let accepted = false;

    const build = (): void => {
      building = true;
      const items: vscode.QuickPickItem[] = [...known].map(([label, description]) => ({ label, description }));
      const typed = qp.value.trim().toLowerCase();
      if (/^[^\\/\s]+$/.test(typed) && !known.has(typed)) {
        items.unshift({ label: typed, description: NEW_ITEM_DESCRIPTION, alwaysShow: true });
      }
      qp.items = items;
      qp.selectedItems = items.filter((i) => checked.has(i.label));
      building = false;
    };

    qp.onDidChangeValue(build);
    qp.onDidChangeSelection((selection) => {
      if (building) return;
      const selected = new Set(selection.map((s) => s.label));
      // Only the visible items can change; the ones a filter hides keep their state.
      for (const item of qp.items) {
        if (selected.has(item.label)) checked.add(item.label);
        else checked.delete(item.label);
      }
      const added = selection.find((s) => s.description === NEW_ITEM_DESCRIPTION);
      if (added) {
        known.set(added.label, 'added by hand');
        qp.value = ''; // fires build(), which lists the new name like any other
      }
    });
    qp.onDidAccept(() => {
      accepted = true;
      qp.hide();
      resolve([...known.keys()].filter((n) => checked.has(n)));
    });
    qp.onDidHide(() => {
      qp.dispose();
      if (!accepted) resolve(undefined);
    });

    build();
    qp.show();
  });
}
