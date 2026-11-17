(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || { collapsed: [] };
  const collapsed = new Set(saved.collapsed);
  let model = null;
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
    const b = chip(l.name, l.active, () => vscode.postMessage({ type: 'toggleLayer', layer: l.name }), l.color, false);
    b.title = 'Click to show or hide. Right-click to change the color.';
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'command', id: 'layerLens.editColor', layer: l.name });
    });
    return b;
  }

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
    actions.appendChild(actionButton('⌖', 'Reveal in Explorer', 'reveal', node.uri));
    actions.appendChild(actionButton('⧉', 'Copy relative path', 'copy', node.uri));
    el.appendChild(actions);

    return { el, twisty, icon };
  }

  function renderNodes(nodes, depth, parent) {
    for (const node of nodes) {
      const { el, twisty, icon } = row(node, depth);
      parent.appendChild(el);

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

  function render() {
    loadFonts(model.icons.fonts);
    const chips = $('chips');
    chips.replaceChildren(
      ...model.layers.map((l) =>
        layerChip(l),
      ),
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
    if (model.tree.length === 0) {
      message.hidden = false;
      message.textContent = 'No folders match the active layers. Enable a layer above.';
    } else {
      message.hidden = !model.truncated;
      message.textContent = model.truncated ? 'Tree truncated: too many entries to display.' : '';
      renderNodes(model.tree, 0, tree);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'model') {
      model = event.data;
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
