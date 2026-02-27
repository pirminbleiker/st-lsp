---
layout: default
title: Installation
nav_order: 2
---

# Installation & Quick Start

## Requirements

- **VS Code 1.85 or later** — [Download VS Code](https://code.visualstudio.com/)
- **Platforms:** Windows, Linux, macOS (all platforms supported by VS Code)
- **TwinCAT 3:** Optional — the extension works standalone with any `.st` file. TwinCAT project integration (`.tsproj` / `.plcproj`) enables cross-file Go-to-Definition.
- Node.js is **not** required — the extension bundles its own language server.

---

## Installation from GitHub Releases (Recommended)

The canary release provides the latest pre-built `.vsix` package. This is the recommended installation method until the extension is published on the VS Code Marketplace.

**Step 1 — Download the `.vsix`**

Go to the [canary release page](https://github.com/pirminbleiker/st-lsp/releases/tag/canary) and download the latest `st-lsp-*.vsix` file.

> **Screenshot placeholder:** _Release page showing the `.vsix` asset under "Assets"._

**Step 2 — Install in VS Code**

Option A — Command line:
```bash
code --install-extension st-lsp-*.vsix
```

Option B — VS Code UI:
1. Open VS Code.
2. Go to the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Click the **⋯** menu (top-right of the Extensions panel).
4. Select **Install from VSIX…**
5. Browse to and select the downloaded `.vsix` file.
6. Click **Install** and reload VS Code when prompted.

> **Screenshot placeholder:** _Extensions panel with "Install from VSIX…" menu option highlighted._

---

## Installation from VS Code Marketplace (Upcoming)

> **Note:** The extension is not yet published on the VS Code Marketplace. Marketplace installation will be available in a future release.

Once published, you will be able to install directly from VS Code:
1. Open the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **ST LSP**.
3. Click **Install**.

---

## Installation from Source

Use this method to build the extension yourself from the latest source code.

**Prerequisites:** [Node.js 18+](https://nodejs.org/) and [Git](https://git-scm.com/).

```bash
# Clone the repository
git clone https://github.com/pirminbleiker/st-lsp.git
cd st-lsp

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package the extension into a .vsix
npm run package
```

This produces a `st-lsp-*.vsix` file in the project root. Install it using the same steps as above:

```bash
code --install-extension st-lsp-*.vsix
```

---

## First Steps / Quick Start

**1. Open your project**

Open a TwinCAT project folder or any folder containing `.st` files in VS Code:
- **File → Open Folder…** and select your project root.

**2. The extension activates automatically**

The language server starts automatically when you open any of these file types:

| Extension | Description |
|-----------|-------------|
| `.st` / `.ST` | Standard IEC 61131-3 Structured Text |
| `.TcPOU` | TwinCAT POU file |
| `.TcGVL` | TwinCAT Global Variable List |
| `.TcDUT` | TwinCAT Data Unit Type |
| `.TcIO` | TwinCAT I/O mapping |
| `.TcTask` | TwinCAT Task configuration |

**3. Try the features**

| Feature | How to use |
|---------|-----------|
| **Code completion** | Press `Ctrl+Space` inside a ST file to trigger suggestions |
| **Hover documentation** | Hover the cursor over any symbol (variable, type, function block) |
| **Go to Definition** | Press `F12` or right-click → **Go to Definition** on a symbol |
| **Workspace symbol search** | Press `Ctrl+T` and type a symbol name to jump to its definition |
| **Diagnostics** | Syntax errors appear as red underlines with details in the **Problems** panel |

**4. TwinCAT project integration (optional)**

For cross-file **Go to Definition**, open the workspace root that contains your `.tsproj` or `.plcproj` file. The extension automatically scans and indexes all ST source files in the project.

---

## Configuration

> **Note:** The extension currently works out of the box with no required configuration. A settings section will be added in a future release.

Watch this page for upcoming options such as custom file associations and diagnostics severity tuning.
