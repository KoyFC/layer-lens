(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || { collapsed: [] };
  const collapsed = new Set(saved.collapsed);
  let model = null;
  /** Folders drawn in the tree: uri -> { group, node }. Rebuilt on every render. */
  const groups = new Map();
  /** The name field being typed, if any: { kind, uri, value, caret, error, submitting, input }. */
  let pending = null;
  /** Rows drawn in the tree: uri -> { el, label, node, siblings }. Rebuilt on every render. */
  const rows = new Map();
  const loadedFonts = new Set();

  const $ = (id) => document.getElementById(id);
  const FOLDER = '<svg viewBox="0 0 16 16"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 4.5v7.5A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>';
  const FILE = '<svg viewBox="0 0 16 16"><path d="M3.5 1h5.6L13 4.9V14a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm5 1v3h3z"/></svg>';

  const NEW_FILE = '<svg viewBox="0 0 16 16"><path d="M3.5 1h5.6L13 4.9V8h-1V6H8.5V2H4v12h4v1H3.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path d="M12 10h1v2h2v1h-2v2h-1v-2h-2v-1h2z"/></svg>';
  const NEW_FOLDER = '<svg viewBox="0 0 16 16"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 4.5V8h-1V4.5a.5.5 0 0 0-.5-.5H7.1L5.6 2.5H3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h5v1H3A1.5 1.5 0 0 1 1.5 12z"/><path d="M12 10h1v2h2v1h-2v2h-1v-2h-2v-1h2z"/></svg>';

  function loadFonts(fonts) {
    for (const font of fonts) {
      const sources = font.sources.map((s) => 'url("' + s.url + '") format("' + s.format + '")').join(', ');
      if (loadedFonts.has(font.family + sources)) continue;
      loadedFonts.add(font.family + sources);
      const face = new FontFace(font.family, sources, { weight: font.weight || 'normal', style: font.style || 'normal' });
      face.load().then((f) => { document.fonts.add(f); }).catch(() => {});
    }
  }

  /** Fills `holder` with the theme icon for `id`, or the generic folder/file icon. */
  function setIcon(holder, node, open) {
    const id = node.isDir && open ? node.iconOpen : node.icon;
    const def = id && model.icons.defs[id];
    holder.replaceChildren();
    if (def && def.src) {
      const img = document.createElement('img');
      img.src = def.src;
      img.alt = '';
      holder.appendChild(img);
    } else if (def && def.char) {
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = def.char;
      glyph.style.fontFamily = def.family;
      if (def.size) glyph.style.fontSize = def.size;
      if (def.color) glyph.style.color = def.color;
      holder.appendChild(glyph);
    } else {
      holder.innerHTML = node.isDir ? FOLDER : FILE;
    }
  }

  function persist() {
    vscode.setState({ collapsed: [...collapsed] });
  }

  function chip(label, pressed, onClick, color, small) {
    const b = document.createElement('button');
    b.className = 'chip' + (small ? ' small' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    if (pressed === null) b.removeAttribute('aria-pressed');
    if (color) b.style.setProperty('--c', color);
    b.addEventListener('click', onClick);
    return b;
  }

  function layerChip(l) {
    const b = chip(
      l.name,
      l.active,
      (e) => vscode.postMessage({ type: 'toggleLayer', layer: l.name, solo: e.shiftKey || e.ctrlKey || e.metaKey }),
      l.color,
      false,
    );
    b.title = 'Click: show or hide. Shift or Ctrl+click: show only this one. Right-click: more.';
    b.dataset.layer = l.name;
    return b;
  }

  // ---- context menu for the layer filters -------------------------------
  // Drawn by the page because its labels depend on the layer (name and shortcut), which
  // contributed VS Code menus cannot do.

  let menuEl = null;

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  function openMenu(x, y, items) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');

    for (const item of items) {
      if (item === '-') {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.setAttribute('role', 'menuitem');
      const label = document.createElement('span');
      label.textContent = item.label;
      b.appendChild(label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'ctx-hint';
        hint.textContent = item.hint;
        b.appendChild(hint);
      }
      b.addEventListener('click', () => { closeMenu(); item.run(); });
      menu.appendChild(b);
    }

    menu.addEventListener('keydown', (e) => {
      const buttons = [...menu.querySelectorAll('.ctx-item')];
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    });

    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(2, Math.min(x, window.innerWidth - r.width - 2)) + 'px';
    menu.style.top = Math.max(2, Math.min(y, window.innerHeight - r.height - 2)) + 'px';
    menuEl = menu;
    menu.querySelector('.ctx-item').focus();
  }

  function layerMenu(layer) {
    const run = (id, extra) => () => vscode.postMessage({ type: 'command', id, ...extra });
    const items = [];
    if (layer) {
      items.push(
        { label: 'Show only this layer (' + layer + ')', hint: 'Shift+click', run: run('layerLens.soloLayer', { layer }) },
        { label: 'Change layer color…', run: run('layerLens.editColor', { layer }) },
        '-',
      );
    }
    items.push(
      { label: 'Show all layers', run: run('layerLens.showAll') },
      { label: 'Hide all layers', run: run('layerLens.hideAll') },
      { label: 'Invert layer filters', run: run('layerLens.invertLayers') },
    );
    return items;
  }

  for (const id of ['chips', 'bulk']) {
    $(id).addEventListener('contextmenu', (e) => {
      e.preventDefault(); // also stops VS Code from showing its own menu
      const chip = e.target.closest('.chip[data-layer]');
      openMenu(e.clientX, e.clientY, layerMenu(chip ? chip.dataset.layer : null));
    });
  }
  document.addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  function actionButton(content, title, type, uri, command) {
    const b = document.createElement('button');
    if (content.startsWith('<')) b.innerHTML = content; else b.textContent = content;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage(command ? { type: 'command', id: command, uri } : { type, uri });
    });
    return b;
  }

  function row(node, depth) {
    const el = document.createElement('div');
    el.className = 'row';
    el.tabIndex = 0;
    el.setAttribute('role', 'treeitem');
    el.style.paddingLeft = 6 + depth * 14 + 'px';
    el.title = node.label;
    // VS Code reads this to show the "webview/context" menu declared in package.json.
    el.dataset.vscodeContext = JSON.stringify({
      webviewSection: node.isDir ? 'dir' : 'file',
      uri: node.uri,
      workspaceRoot: !!node.workspaceRoot,
      preventDefaultContextMenuItems: true,
    });

    if (node.layer) {
      el.classList.add('in-layer');
      if (node.layerRoot) el.classList.add('layer-root');
      el.style.setProperty('--c', model.colors[node.layer] || 'transparent');
    }

    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    if (node.isDir) twisty.textContent = '›';
    el.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = 'icon';
    setIcon(icon, node, false);
    el.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.label;
    el.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'actions';
    if (node.isDir) {
      actions.appendChild(actionButton(NEW_FILE, 'New file', 'command', node.uri, 'layerLens.newFile'));
      actions.appendChild(actionButton(NEW_FOLDER, 'New folder', 'command', node.uri, 'layerLens.newFolder'));
    }
    actions.appendChild(actionButton('⌖', 'Reveal in Explorer', 'command', node.uri, 'layerLens.reveal'));
    actions.appendChild(actionButton('⧉', 'Copy relative path', 'command', node.uri, 'layerLens.copyRelativePath'));
    el.appendChild(actions);

    // Same shortcuts as the Explorer.
    el.addEventListener('keydown', (e) => {
      if (node.workspaceRoot || e.target !== el) return;
      if (e.key === 'F2') { e.preventDefault(); vscode.postMessage({ type: 'command', id: 'layerLens.rename', uri: node.uri }); }
      else if (e.key === 'Delete') { e.preventDefault(); vscode.postMessage({ type: 'command', id: 'layerLens.delete', uri: node.uri }); }
    });

    return { el, twisty, icon, label };
  }

  function renderNodes(nodes, depth, parent) {
    for (const node of nodes) {
      const { el, twisty, icon, label } = row(node, depth);
      parent.appendChild(el);
      rows.set(node.uri, { el, label, node, siblings: nodes });

      if (!node.isDir) {
        const open = () => vscode.postMessage({ type: 'open', uri: node.uri });
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
        continue;
      }

      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      parent.appendChild(group);
      groups.set(node.uri, { group, node, depth: depth + 1 });
      renderNodes(node.children || [], depth + 1, group);

      const apply = () => {
        const isCollapsed = collapsed.has(node.key);
        group.hidden = isCollapsed;
        twisty.classList.toggle('open', !isCollapsed);
        setIcon(icon, node, !isCollapsed);
        el.setAttribute('aria-expanded', String(!isCollapsed));
      };
      const toggle = () => {
        if (collapsed.has(node.key)) collapsed.delete(node.key); else collapsed.add(node.key);
        persist();
        apply();
      };
      apply();
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
  }

  // ---- name field inside the tree (new file / new folder) ----------------

  function cancelCreate() {
    if (!pending) return;
    pending = null;
    render();
  }

  /** The name is checked by the extension too; this only gives instant feedback. */
  function localProblem(target, name) {
    const trimmed = name.trim();
    if (!trimmed) return 'Enter a name';
    if (trimmed.includes('\\') || trimmed.startsWith('/')) return 'Use a relative path with /';
    const first = trimmed.replace(/\/+$/, '').split('/')[0];
    if (first === '.' || first === '..') return 'Invalid path segment';
    const siblings = target.node ? target.node.children || [] : model.tree;
    if (siblings.some((n) => n.label === first)) return 'That name already exists';
    return null;
  }

  function showError(wrap, message) {
    const box = wrap.querySelector('.create-error');
    box.hidden = !message;
    box.textContent = message || '';
    wrap.querySelector('input').classList.toggle('invalid', !!message);
  }

  function submitCreate(wrap, target) {
    if (!pending || pending.submitting) return;
    const problem = localProblem(target, pending.value);
    pending.error = problem || '';
    showError(wrap, problem);
    if (problem) return;
    pending.submitting = true;
    vscode.postMessage({ type: 'create', kind: pending.kind, uri: pending.uri, name: pending.value.trim() });
  }

  function renderPending() {
    // While the extension is creating it the field stays gone: success refreshes the tree under it.
    if (!pending || pending.submitting) return;
    if (pending.mode === 'rename') { renderRename(); return; }
    const target = groups.get(pending.uri);
    if (!target) { pending = null; return; }

    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'row creating';
    row.style.paddingLeft = 6 + target.depth * 14 + 'px';
    const spacer = document.createElement('span');
    spacer.className = 'twisty';
    row.appendChild(spacer);
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = pending.kind === 'folder' ? FOLDER : FILE;
    row.appendChild(icon);

    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = pending.kind === 'folder' ? 'Folder name' : 'File name';
    input.setAttribute('aria-label', input.placeholder);
    input.value = pending.value;
    row.appendChild(input);

    const error = document.createElement('div');
    error.className = 'create-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    error.style.marginLeft = 6 + target.depth * 14 + 38 + 'px';

    wrap.append(row, error);
    target.group.prepend(wrap);
    pending.input = input;
    if (pending.error) showError(wrap, pending.error);

    input.addEventListener('input', () => {
      pending.value = input.value;
      pending.caret = input.selectionStart;
      pending.error = '';
      showError(wrap, '');
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); submitCreate(wrap, target); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
    });
    input.addEventListener('blur', () => {
      // A re-render replaces the field, which also blurs it; only cancel if this one is still current.
      setTimeout(() => {
        if (pending && pending.input === input && !pending.submitting && document.activeElement !== input) cancelCreate();
      }, 0);
    });

    input.focus();
    const caret = pending.caret == null ? input.value.length : pending.caret;
    input.setSelectionRange(caret, caret);
    wrap.scrollIntoView({ block: 'nearest' });
  }

  // ---- renaming a row in place ---------------------------------------

  function baseName(uri) {
    return decodeURIComponent(uri.slice(uri.lastIndexOf('/') + 1));
  }

  function renameProblem(entry, name) {
    const value = name.trim();
    if (!value) return 'Enter a name';
    if (/[\\/]/.test(value) || value === '.' || value === '..') return 'Names cannot contain slashes';
    // A compacted folder ("a/b/c") hides its siblings, so only the extension can check those.
    if (!entry.node.label.includes('/') && entry.siblings.some((n) => n !== entry.node && n.label === value)) {
      return 'That name already exists';
    }
    return null;
  }

  function renderRename() {
    const entry = rows.get(pending.uri);
    if (!entry) { pending = null; return; }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'New name');
    input.value = pending.value;
    entry.label.replaceWith(input);

    const error = document.createElement('div');
    error.className = 'create-error';
    error.setAttribute('role', 'alert');
    error.hidden = !pending.error;
    error.textContent = pending.error || '';
    error.style.marginLeft = entry.el.style.paddingLeft;
    entry.el.after(error);
    pending.input = input;

    const showProblem = (message) => {
      error.hidden = !message;
      error.textContent = message || '';
      input.classList.toggle('invalid', !!message);
    };
    if (pending.error) input.classList.add('invalid');

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      pending.value = input.value;
      pending.caret = input.selectionStart;
      pending.error = '';
      showProblem('');
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (pending.submitting) return;
      if (pending.value.trim() === pending.original) { cancelCreate(); return; }
      const problem = renameProblem(entry, pending.value);
      pending.error = problem || '';
      showProblem(problem);
      if (problem) return;
      pending.submitting = true;
      vscode.postMessage({ type: 'rename', uri: pending.uri, name: pending.value.trim() });
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (pending && pending.input === input && !pending.submitting && document.activeElement !== input) cancelCreate();
      }, 0);
    });

    input.focus();
    if (pending.caret == null) {
      // Like the Explorer: select the name without its extension.
      const dot = pending.value.lastIndexOf('.');
      input.setSelectionRange(0, !entry.node.isDir && dot > 0 ? dot : pending.value.length);
    } else {
      input.setSelectionRange(pending.caret, pending.caret);
    }
  }

  function startRename(uri) {
    if (!model || !rows.get(uri)) return;
    const name = baseName(uri);
    pending = { mode: 'rename', uri, original: name, value: name, caret: null, error: '', submitting: false, input: null };
    render();
  }

  function startCreate(kind, uri) {
    const target = model && groups.get(uri);
    if (!target) {
      vscode.postMessage({ type: 'createFallback', kind, uri });
      return;
    }
    if (target.node) { collapsed.delete(target.node.key); persist(); }
    pending = { mode: 'create', kind, uri, value: '', caret: 0, error: '', submitting: false, input: null };
    render();
  }

  function render() {
    loadFonts(model.icons.fonts);
    const chips = $('chips');
    const allOn = model.layers.length > 0 && model.layers.every((l) => l.active);
    chips.replaceChildren(...model.layers.map(layerChip));

    $('bulk').replaceChildren(
      chip(allOn ? 'Hide all' : 'Show all', null, () => vscode.postMessage({ type: 'toggleAll' }), null, true),
      chip('Invert', null, () => vscode.postMessage({ type: 'command', id: 'layerLens.invertLayers' }), null, true),
    );

    $('options').replaceChildren(
      chip('Other folders', model.showOthers, () => vscode.postMessage({ type: 'toggleOthers' }), null, true),
      chip('Flatten layer', model.flatten, () => vscode.postMessage({ type: 'toggleFlatten' }), null, true),
      chip('Colors', null, () => vscode.postMessage({ type: 'command', id: 'layerLens.editColor' }), null, true),
      chip('Edit layers', null, () => vscode.postMessage({ type: 'command', id: 'layerLens.editLayers' }), null, true),
      chip('Rescan', null, () => vscode.postMessage({ type: 'command', id: 'layerLens.rescan' }), null, true),
    );

    const message = $('message');
    const tree = $('tree');
    tree.replaceChildren();
    groups.clear();
    rows.clear();
    if (model.rootUri) groups.set(model.rootUri, { group: tree, node: null, depth: 0 });
    if (model.tree.length === 0) {
      message.hidden = false;
      message.textContent = 'No folders match the active layers. Enable a layer above.';
    } else {
      message.hidden = !model.truncated;
      message.textContent = model.truncated ? 'Tree truncated: too many entries to display.' : '';
      renderNodes(model.tree, 0, tree);
    }
    renderPending();
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'model') {
      model = data;
      render();
    } else if (data.type === 'startCreate') {
      startCreate(data.kind, data.uri);
    } else if (data.type === 'startRename') {
      startRename(data.uri);
    } else if ((data.type === 'createResult' || data.type === 'renameResult') && pending) {
      if (data.error) {
        pending.submitting = false;
        pending.error = data.error;
        render(); // draws the field again with the message
      } else {
        pending = null;
        render();
      }
    }
  });

  // Right-clicking the empty part of the tree offers to create at the workspace root.
  $('tree').dataset.vscodeContext = JSON.stringify({ webviewSection: 'root', preventDefaultContextMenuItems: true });

  vscode.postMessage({ type: 'ready' });
})();
