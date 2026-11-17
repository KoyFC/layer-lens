# Layer Lens

A VS Code Explorer view that filters the folder tree by **layer** (`application`, `domain`, `infrastructure`). It is meant for projects that repeat those folders inside every context:

```
src/contexts/users/{application,domain,infrastructure}
src/contexts/lost-objects/{application,domain,infrastructure}
```

With only `application` enabled you see every controller/service across all contexts and nothing else.

## Usage

- A colored chip per layer sits under the view title. Click one to show or hide that layer.
- **Shift+click** (or Ctrl+click) a chip to show only that layer; do it again to bring them all back. Right-click a chip for the same, plus *Show all*, *Hide all* and *Invert*; the chips under the filters do those in one click.
- Each layer has its own color, shown on its folder and everything inside it. Right-click a chip or use the **Colors** chip to pick a preset or any hex code.
- **Other folders** shows what is outside the layers (`routes`, `utils`, …). **Flatten layer** drops the layer folder when a single layer is active, so files hang straight from their context.
- Layers are detected the first time a workspace is opened: a folder name repeated inside two or more sibling folders (`contexts/users/application`, `contexts/orders/application`, …) is offered in a checklist. Uncheck false positives, or type a name that was missed. **Edit layers** and **Rescan** reopen it later.
- Layers, filters and colors are saved per workspace.

## Settings

| Setting | Default | Description |
|---|---|---|
| `layerLens.layers` | `application, domain, infrastructure` | Folder names always treated as layers |
| `layerLens.autoDetect` | `true` | Scan for repeated folder names the first time a workspace is opened |
| `layerLens.exclude` | `node_modules, dist, build, …` | Names that are never shown |
| `layerLens.flattenLayerFolder` | `false` | With a single active layer, hide the layer node |

## Development and installation

```bash
npm install
npm run build          # tsc + esbuild
npm run package        # produces layer-lens-<version>.vsix
code --install-extension layer-lens-0.1.0.vsix
```

Press F5 to launch an Extension Development Host.
