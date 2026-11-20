# Layer Lens

A VS Code Explorer view that filters the folder tree by **layer** (`application`, `domain`, `infrastructure`). It is meant for projects that repeat those folders inside every context:

```
src/contexts/users/{application,domain,infrastructure}
src/contexts/lost-objects/{application,domain,infrastructure}
```

With only `application` enabled you see every controller/service across all contexts and nothing else.

## Usage

- A colored chip per layer sits under the view title; the filters stay visible while the tree scrolls. Click one to show or hide that layer.
- **Shift+click** (or Ctrl+click) a chip to show only that layer; do it again to bring them all back. Right-click a chip for the same, plus *Show all*, *Hide all* and *Invert*; the chips under the filters do those in one click.
- Each layer has its own color, shown on its folder and everything inside it. Right-click a chip and choose *Change layer color…* to pick a preset or any hex code.
- **Other folders** shows what is outside the layers (`routes`, `utils`, …). **Flatten layer** drops the layer folder when a single layer is active, so files hang straight from their context.
- Layers are detected the first time a workspace is opened: a folder name repeated inside two or more sibling folders (`contexts/users/application`, `contexts/orders/application`, …) is offered in a checklist. Uncheck false positives, or type a name that was missed. *Edit layers…* and *Rescan layers* reopen it later; both are in the right-click menu of any filter chip.
- **Contexts**: the folders that hold layer folders (`users`, `lost-objects`, …) get their own row of chips under the layers. Click to hide or show a context, Shift+click to show only that one; right-click for *Show all*, *Hide all* and *Invert*. Context and layer filters combine. They are detected on their own; if one is wrong (say `src` holds `application` directly), right-click a filter chip, choose *Edit contexts…* and uncheck it. It stops being a context, so its layers follow the layer filters only.
- **Display names**: right-click a file or folder and choose *Set display name…* (or Shift+F2) to show another name in Layer Lens, with the real one dimmed beside it. The file is not renamed. Leave it empty, or use *Remove display name*, to go back. The name follows the file when it is renamed or moved.
- **Auto names** (off by default; chip under the filters): shows every file without a display name of its own in a readable form: `create-user.dto.ts` becomes `Create User Dto`, `UserController.ts` becomes `User Controller`. Folders and dotfiles are left alone. Names set by hand are never touched by the toggle, so use *Set display name…* for cases like `DTO`. With it on, typing the real name keeps that one file as it is.
- Layers, contexts, display names, filters and colors are saved per workspace.

## Settings

| Setting | Default | Description |
|---|---|---|
| `layerLens.layers` | `application, domain, infrastructure` | Folder names always treated as layers |
| `layerLens.autoDetect` | `true` | Scan for repeated folder names the first time a workspace is opened |
| `layerLens.exclude` | `node_modules, dist, build, …` | Names that are never shown |
| `layerLens.flattenLayerFolder` | `false` | With a single active layer, hide the layer node |
| `layerLens.autoDisplayNames` | `false` | Start new workspaces with automatic display names on |

## Development and installation

```bash
npm install
npm run build          # tsc + esbuild
npm run package        # produces layer-lens-<version>.vsix
code --install-extension layer-lens-0.1.0.vsix
```

Press F5 to launch an Extension Development Host.
