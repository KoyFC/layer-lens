# Layer Lens

A VS Code Explorer view that filters the folder tree by **layer** (`application`, `domain`, `infrastructure`). It is meant for projects that repeat those folders inside every context:

```
src/contexts/users/{application,domain,infrastructure}
src/contexts/lost-objects/{application,domain,infrastructure}
```

With only `application` enabled you see every controller/service across all contexts and nothing else.

## Usage

- A colored chip per layer sits right under the view title. Click a chip to show or hide that layer; filled dot = visible.
- **Shift or Ctrl+click** a chip to show only that layer (do it again to bring them all back); right-click a chip for *Show only this layer*. **Hide all** / **Show all** turns every layer off or on at once.
- Each layer has its own color: its folder and everything inside get a tinted background and a colored edge, so layers are easy to tell apart.
- The **Other folders** and **Flatten layer** chips toggle the remaining folders/files and the layer-node removal (single active layer only).
- **Layers are detected automatically** the first time a workspace is opened: any folder name repeated inside two or more sibling folders (`contexts/users/application`, `contexts/orders/application`, …) is offered in a checklist. Uncheck false positives, or type a name to add one that was missed. The names in `layerLens.layers` are always offered.
- **Edit layers** and **Rescan** (chips under the filters, also in the `…` menu) reopen that checklist later. Rescan only offers newly found names; Edit layers can also remove any layer.
- **Colors:** right-click a chip and choose *Change color…*, or use the **Colors** chip, to pick a layer's color from the default, a preset or any hex code. Colors are saved per workspace.
- State is stored per workspace.

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
