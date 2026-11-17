# Layer Lens

A VS Code Explorer view that filters the folder tree by **layer** (`application`, `domain`, `infrastructure`). It is meant for projects that repeat those folders inside every context:

```
src/contexts/users/{application,domain,infrastructure}
src/contexts/lost-objects/{application,domain,infrastructure}
```

With only `application` enabled you see every controller/service across all contexts and nothing else.

## Usage

- A colored chip per layer sits right under the view title. Click a chip to show or hide that layer; filled dot = visible.
- Each layer has its own color: its folder and everything inside get a tinted background and a colored edge, so layers are easy to tell apart.
- The **Other folders** and **Flatten layer** chips toggle the remaining folders/files and the layer-node removal (single active layer only).
- Click a folder to collapse it, a file to open it; hover a row for *Reveal in Explorer* and *Copy relative path*.
- The view's toolbar also has `Layer Lens: pick layers…` for custom layers.
- State is stored per workspace.

## Settings

| Setting | Default | Description |
|---|---|---|
| `layerLens.layers` | `application, domain, infrastructure` | Folder names treated as layers |
| `layerLens.exclude` | `node_modules, dist, build, …` | Names that are never shown |
| `layerLens.flattenLayerFolder` | `false` | With a single active layer, hide the layer node |

## Development and installation

```bash
npm install
npm run build          # tsc + esbuild
npm run package        # produces layer-lens-<version>.vsix
code --install-extension layer-lens-0.1.0.vsix
```

The view is a webview, so it does not use the file icon theme. Press F5 to launch an Extension Development Host.
