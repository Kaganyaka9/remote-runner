# Remote Runner — VS Code extension for Remote C++ Development

Warning: vibe-coded for quick prototyping. Should be used cautiously.

A lightweight, cross-platform VS Code extension designed for developers who want to write C++ locally on **macOS, Linux, or Windows**, while testing, compiling, and debugging on a remote Linux server (e.g. headless cloud VMs) without running heavy IDE servers or VMs.

Unlike VS Code's official _Remote - SSH_ extension—which runs an entire Node.js server and language host on the remote machine—**Remote Runner** keeps your editing completely local. It treats the remote server strictly as a headless test runner: performing differential SFTP file synchronization on demand, launching interactive GDB/Valgrind execution via terminal pseudo-terminals (PTY), and handling standard input (`cin`) natively.

---

## Features

- **No Remote Dependencies:** Zero `sudo` access required on the remote machine. No language servers, Node binaries, or daemon setups needed on the host.
- **Pure Node.js Cross-Platform SSH:** Built with `ssh2` and `ssh2-sftp-client`. Requires no local `rsync` or external Unix toolchain; runs out-of-the-box on macOS, Linux, and Windows.
- **Differential Delta Syncing:** Employs an `mtime` and file size caching strategy (`.vscode/.sync-cache.json`) to upload only modified files in milliseconds before executing.
- **Top-Bar Control Center:**
- `$(plug)` / `$(debug-disconnect)` **Connect SSH & Open Shell:** Establishes the SSH session and spawns an interactive bash terminal navigated to the workspace.
- `$(play)` / `$(stop)` **Sync, Compile & Debug:** Syncs changes, builds the project, and runs the binary under GDB.
- `$(bug)` **Sync, Compile & Memory Check:** Syncs changes, builds the project, and invokes Valgrind with memory-leak and origin tracking.

- **Interactive `cin` Support:** Runs via a VS Code `Pseudoterminal` directly hooked to the remote shell stream, granting full keyboard interactivity for command-line inputs and terminal colors.
- **Interactive Setup Wizard:** Automatically discovers existing configurations from `~/.ssh/config`, prompts for build rules (`make`, `g++`, or custom), and handles SSH key pair generation and server deployment.

---

## Architecture Overview

```text
Local Workspace (macOS / Linux / Windows)
  ├── Source files (*.cpp, *.h, Makefile)
  └── .vscode/.sync-cache.json (Tracks mtime & byte sizes)
           │
           │  1. Fast SFTP Delta Sync (Only modified bytes)
           ▼
Remote Host (e.g. dev.cs.university.edu)
  └── ~/workspaces/<project_name>/
           │
           │  2. Build & Execute Command (g++ / make -> gdb / valgrind)
           ▼
VS Code Pseudoterminal (PTY)
  ├── stdout / stderr stream ──► Rendered in VS Code Terminal
  └── stdin ───────────────────► Interactive pipe for C++ std::cin

```

---

## Getting Started

### 1. Installation

You can install the pre-packaged `.vsix` file attached to each GitHub Release without needing to build the project from source.

#### Option 1: Via the VS Code GUI (Recommended)

1. Download the latest `remote-runner-x.x.x.vsix` file from the [Releases](https://github.com/Kaganyaka9/remote-runner/releases) page.
2. Open VS Code.
3. Open the **Extensions** view (`Cmd+Shift+X` on macOS, `Ctrl+Shift+X` on Windows/Linux).
4. Click the **`...`** (Views and More Actions) menu in the top-right corner of the Extensions panel.
5. Select **Install from VSIX...**.
6. Choose the downloaded `.vsix` file.

#### Option 2: Via the Command Line

If you have the `code` CLI in your system path, download the file and run:

```bash
code --install-extension remote-cpp-runner-x.x.x.vsix

```

> **Note:** If `code` is not recognized in your terminal, open VS Code, press `Cmd+Shift+P` (or `Ctrl+Shift+P`), run **Shell Command: Install 'code' command in PATH**, and restart your terminal.

### 2. Workspace Configuration (`.remote-dev.json`)

When you open a folder in VS Code and press any extension button for the first time, an interactive setup wizard will guide you through creating `.remote-dev.json` in your workspace root.

You can also create or edit this file manually:

```json
{
    "host": "dev.example.com",
    "username": "username",
    "port": 22,
    "privateKeyPath": "~/.ssh/id_ed25519",
    "remoteBaseDir": "~/workspaces/my_workspace",
    "compileCmd": "make all",
    "debugCmd": "gdb -q -ex run -ex bt --args ./app",
    "memCheckCmd": "valgrind --leak-check=full --track-origins=yes ./app",
    "exclude": [".git", ".vscode", "*.o", "app", "build", ".DS_Store"]
}
```

### Configuration Fields

| Key              | Type       | Description                                                                                     |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `host`           | `string`   | The remote hostname, domain, or IP address.                                                     |
| `username`       | `string`   | Your remote SSH username.                                                                       |
| `port`           | `number`   | Remote SSH port (defaults to `22`).                                                             |
| `privateKeyPath` | `string`   | Path to your local private SSH key (e.g., `~/.ssh/id_ed25519` or `~/.ssh/server_key`).          |
| `remoteBaseDir`  | `string`   | Absolute or `~`-relative remote directory where files will be synchronized.                     |
| `compileCmd`     | `string`   | Command executed to build the project (e.g., `make` or `g++ -std=c++17 -Wall -g *.cpp -o app`). |
| `debugCmd`       | `string`   | Command executed to run/debug the program with GDB.                                             |
| `memCheckCmd`    | `string`   | Command executed to run the binary under Valgrind.                                              |
| `exclude`        | `string[]` | File names, directory names, or wildcard extensions (`*.o`) excluded from synchronization.      |

---

## Comprehensive Guide: SSH Key Generation & Authorization

Public-key authentication replaces passwords with cryptographic key pairs. This extension relies on passwordless key authentication to establish non-blocking, headless SFTP sessions and PTY terminals.

### 1. How Public-Key Cryptography Works

An SSH key setup consists of two mathematically linked files:

- **Private Key (`id_ed25519`):** Stored strictly on your local machine. It should have restrictive permissions (`600`) and **never** be shared, copied to servers, or checked into Git.
- **Public Key (`id_ed25519.pub`):** Can be freely shared. It is placed on the remote machine inside `~/.ssh/authorized_keys`.

During authentication, the server generates a challenge encrypted with your public key; your local SSH client proves its identity by decrypting the challenge using your private key.

### 2. Generating the Key Pair Locally

#### On macOS and Linux (Terminal)

Open your terminal and run:

```bash
ssh-keygen -t ed25519 -C "username@example.edu.tr" -f ~/.ssh/id_ed25519

```

- `-t ed25519`: Specifies the modern elliptic-curve signature algorithm.
- `-C "..."`: Adds an identifiable comment (usually your email or student ID).
- `-f ~/.ssh/id_ed25519`: Specifies the output filename (you can rename this, e.g., `~/.ssh/dev_server`).
- When prompted for a passphrase, press **Enter** for an empty passphrase if you want completely automated one-click runs, or provide a passphrase if your environment uses an active SSH agent.

#### On Windows (PowerShell)

Windows 10 and Windows 11 include OpenSSH by default. Open PowerShell (no admin privileges needed) and run:

```powershell
ssh-keygen -t ed25519 -C "username@example.edu.tr" -f $env:USERPROFILE\.ssh\id_ed25519

```

### 3. Installing the Public Key onto the Server

To authorize your key, the contents of the local `.pub` file must be appended as a single line to the remote file `~/.ssh/authorized_keys`.

#### Option A: Using the Built-In Setup Wizard (Easiest)

When launching the extension setup wizard (`Remote Runner: Initialize Config & SSH Key`), the extension detects if your key is missing, provides an option to generate it, and executes a piped terminal command prompting for your password only once to install the key automatically.

#### Option B: Using `ssh-copy-id` (macOS / Linux)

If your operating system includes `ssh-copy-id`:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub username@server.example.edu

```

#### Option C: Universal Manual Pipe (macOS / Linux / Windows)

If `ssh-copy-id` is not available (such as in Windows PowerShell), pipe the public key manually over standard SSH:

**macOS / Linux:**

```bash
cat ~/.ssh/id_ed25519.pub | ssh username@server.example.edu "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

```

**Windows PowerShell:**

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | ssh username@server.example.edu "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

```

### 4. Critical File Permissions on the Remote Server

OpenSSH enforces strict security standards by default (`StrictModes yes`). If permissions on the server are too open, the server **will refuse** to read your public key, falling back to a password prompt.

If you experience persistent authentication failures, log into the server and enforce correct ownership and permissions:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys

```

---

## Local Development & Contributing

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)
- [VS Code](https://code.visualstudio.com/)

### Building from Source

1. Clone the repository:

```bash
git clone https://github.com/Kaganyaka9/remote-runner.git
cd remote-runner

```

2. Install dependencies:

```bash
npm install

```

3. Compile TypeScript:

```bash
npm run compile

```

4. Run the extension:

- Open the project directory in VS Code.
- Press `F5` (or click `Run > Start Debugging`).
- A new **Extension Development Host** window will open with the extension loaded.

5. Package into an offline `.vsix` installer:

```bash
npx @vscode/vsce package

```

You can install the resulting `.vsix` on any machine via `Extensions > ... > Install from VSIX...`.

---

## License

This project is licensed under the [MIT License](https://github.com/Kaganyaka9/remote-runner/blob/main/LICENSE).
