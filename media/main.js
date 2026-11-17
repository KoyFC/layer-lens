(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || { collapsed: [] };
  const collapsed = new Set(saved.collapsed);
  let model = null;

  const $ = (id) => document.getElementById(id);
  const FOLDER = '<svg viewBox="0 0 16 16"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 4.5v7.5A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>';
  const FILE = '<svg viewBox="0 0 16 16"><path d="M3.5 1h5.6L13 4.9V14a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm5 1v3h3z"/></svg>';

  function persist() {
    vscode.setState({ collapsed: [...collapsed] });
  }

  function chip(label, pressed, onClick, color, small) {
    const b = document.createElement('button');
    b.className = 'chip' + (small ? ' small' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    if (color) b.style.setProperty('--c', color);
    b.addEventListener('click', onClick);
    return b;
  }

  function actionButton(text, title, type, uri) {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type, uri });
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
    icon.innerHTML = node.isDir ? FOLDER : FILE;
    el.appendChild(icon.firstChild);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.label;
    el.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.appendChild(actionButton('⌖', 'Reveal in Explorer', 'reveal', node.uri));
    actions.appendChild(actionButton('⧉', 'Copy relative path', 'copy', node.uri));
    el.appendChild(actions);

    return { el, twisty };
  }

  function renderNodes(nodes, depth, parent) {
    for (const node of nodes) {
      const { el, twisty } = row(node, depth);
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
    const chips = $('chips');
    chips.replaceChildren(
      ...model.layers.map((l) =>
        chip(l.name, l.active, () => vscode.postMessage({ type: 'toggleLayer', layer: l.name }), l.color, false),
      ),
    );

    $('options').replaceChildren(
      chip('Other folders', model.showOthers, () => vscode.postMessage({ type: 'toggleOthers' }), null, true),
      chip('Flatten layer', model.flatten, () => vscode.postMessage({ type: 'toggleFlatten' }), null, true),
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
