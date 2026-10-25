import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseUserSshConfig, HostOption } from './sshConfigHelper';

function resolveHome(p: unknown): string {
    if (typeof p !== "string") {
        return "";
    }
    const clean = p.replace(/^["']|["']$/g, "");
    return clean.startsWith("~") ? clean.replace("~", os.homedir()) : clean;
}

export async function runSetupWizard(workspaceRoot: string): Promise<boolean> {
    const folderName = path.basename(workspaceRoot);
    const existingHosts = parseUserSshConfig();

    let host = "";
    let username = "";
    let port = 22;
    let privateKeyPath = "~/.ssh/id_ed25519";

    // Check for existing SSH Config
    if (existingHosts.length > 0) {
        const hostChoices = existingHosts.map(h => ({
            label: `$(server) Host: ${h.host}`,
            description: `${h.user || "no user"}@${h.hostname || h.host}:${h.port || 22}`,
            hostData: h
        }));

        const picked = await vscode.window.showQuickPick(
            [
                ...hostChoices,
                {
                    label: "$(edit) Configure Manually",
                    descripton: "Enter hostname, user, and port by hand",
                    hostData: null
                },
            ],
            {
                placeHolder: "Select a server from configured servers (~/.ssh/config) or enter manually:"
            }
        );
        if (!picked) return false;

        if (picked.hostData) {
            const data = picked.hostData;
            host = data.hostname || data.host;
            username = data.user || '';
            port = data.port || 22;
            if (data.identityFile) {
                privateKeyPath = data.identityFile;
            }
        }
    }

    // Prompt for missing connection details
    if (!host) {
        const hostInput = await vscode.window.showInputBox({
            prompt: "Enter server hostname or IP address (e.g. server.example.com or 192.0.2.0):",
            ignoreFocusOut: true,
            validateInput: (value) => (value.trim() ? null : "Hostname or Ip cannot be empty")
        });
        if (!hostInput) return false;
        host = hostInput.trim();

        const portInput = await vscode.window.showInputBox({
            prompt: "Enter SSH port:",
            value: "22",
            ignoreFocusOut: true,
            validateInput: (value) => {
                const num = parseInt(value, 10);
                return (!isNaN(num) && num > 0 && num < 65536) ? null : "Enter a valid port number (1-65535)";
            }
        });
        if (!portInput) return false;
        port = parseInt(portInput, 10);
    }
    if (!username) {
        const userInput = await vscode.window.showInputBox({
            prompt: `Enter SSH username for ${host}:`,
            ignoreFocusOut: true,
            validateInput: (value) => (value.trim() ? null : "Username cannot be empty.")
        });
        if (!userInput) return false;
        username = userInput.trim();
    }

    // Resolve and Verify Private/Public Key
    let resolvedKeyPath = resolveHome(privateKeyPath);
    if (!fs.existsSync(resolvedKeyPath)) {
        const sshDir = path.join(os.homedir(), ".ssh");
        let foundKeys: string[] = [];
        if (fs.existsSync(sshDir)) {
            foundKeys = fs.readdirSync(sshDir).filter(f => !f.endsWith(".pub") && f !== "known_hosts" && f !== "config");
        }

        const keyPick = await vscode.window.showQuickPick(
            [
                ...foundKeys.map(k => ({
                    label: `$(key) ~/.ssh/${k}`,
                    keyPath: `~/.ssh/${k}`
                })),
                { label: "$(add) Generate a new key pair", keyPath: "GENERATE" },
                { label: "$(file) Browse file...", keyPath: "BROWSE" }
            ],
            { placeHolder: `Key not found at ${privateKeyPath}. Select or create an SSH key:` }
        );

        if (!keyPick) return false;

        if (keyPick.keyPath === "GENERATE") {
            const keyName = await vscode.window.showInputBox({
                prompt: "Enter name for your key pair (e.g. id_ed25519 or my_server_key):",
                value: "id_ed25519",
                ignoreFocusOut: true,
                validateInput: (value) =>
                    (value.trim() ? null : "Key name cannot be empty.")
            });
            if (!keyName) return false;

            privateKeyPath = `~/.ssh/${keyName.trim()}`;
            resolvedKeyPath = resolveHome(privateKeyPath);

            if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });

            const term = vscode.window.createTerminal("SSH Key Generator");
            term.show();
            term.sendText(`ssh-keygen -t ed25519 -N "" -f "${resolvedKeyPath}"`);

            await vscode.window.showInformationMessage("Generating key... Click OK when finished in terminal.", "OK");
        }
        else if (keyPick.keyPath === "BROWSE") {
            const fileUri = await vscode.window.showOpenDialog(
                {
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    defaultUri: vscode.Uri.file(sshDir)
                });
            if (!fileUri || fileUri.length === 0) return false;

            resolvedKeyPath = fileUri[0].fsPath;
            privateKeyPath = resolvedKeyPath;
        }
        else {
            privateKeyPath = keyPick.keyPath;
            resolvedKeyPath = resolveHome(privateKeyPath);
        }
    }

    // Offer to upload Public Key to Server
    const pubKeyPath = resolvedKeyPath.endsWith(".pub") ? resolvedKeyPath : `${resolvedKeyPath}.pub`;
    if (fs.existsSync(pubKeyPath)) {
        const installChoice = await vscode.window.showQuickPick(
            ["Yes", "No (Already did)"],
            {
                placeHolder: `Do you want to install ${path.basename(pubKeyPath)} on ${host}?`
            }
        );

        if (installChoice === "Yes") {
            const isWin = process.platform === "win32";
            const remoteCmd = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys";
            const uploadScript = isWin ?
                `type "${pubKeyPath}" | ssh -p ${port} ${username}@${host} "${remoteCmd}"` :
                `cat "${pubKeyPath}" | ssh -p ${port} ${username}@${host} "${remoteCmd}"`;

            const term = vscode.window.createTerminal("SSH Key Installer");
            term.show();
            term.sendText(uploadScript);

            await vscode.window.showInformationMessage(
                "Please enter your password in the terminal window to upload your key.",
                "Done"
            );
        }
    }

    // 5. Ask for Commands
    let compileCmd = "g++ -std=c++11 -Wall -g *.cpp -o app";
    const compilePick = await vscode.window.showQuickPick([
        { label: 'g++', description: 'g++ -std=c++11 -Wall -g *.cpp -o app', cmd: "g++ -std=c++11 -Wall -g *.cpp -o app" },
        { label: 'make', description: 'make all', cmd: "make all" },
        { label: 'Custom', description: 'Enter custom compile command', cmd: "CUSTOM" }
    ], { placeHolder: 'How do you want to compile your code?' });

    if (!compilePick) return false;

    if (compilePick.cmd === 'CUSTOM') {
        const customComp = await vscode.window.showInputBox({ prompt: 'Enter custom compile command', value: 'make' });
        if (!customComp) return false;
        compileCmd = customComp;
    } else {
        compileCmd = compilePick.cmd;
    }

    const debugCmd = await vscode.window.showInputBox({
        prompt: 'Enter the command to debug/run your program',
        value: 'gdb -q -ex run -ex bt --args ./app',
        ignoreFocusOut: true
    });
    if (!debugCmd) return false;

    const memCheckCmd = await vscode.window.showInputBox({
        prompt: 'Enter the command for memory checking (Valgrind)',
        value: 'valgrind --leak-check=full --track-origins=yes ./app',
        ignoreFocusOut: true
    });
    if (!memCheckCmd) return false;

    // 6. Generate .remote-runner.json
    const configPath = path.join(workspaceRoot, '.remote-runner.json');
    const template = {
        host,
        username,
        port,
        privateKeyPath,
        remoteBaseDir: `~/workspaces/${folderName}`,
        compileCmd,
        debugCmd,
        memCheckCmd,
        exclude: [".git", ".vscode", "*.o", "app", "build", ".DS_Store", ".remote-runner.json"]
    };

    fs.writeFileSync(configPath, JSON.stringify(template, null, 2));
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage('Workspace setup completed! .remote-runner.json created.');
    return true;
}