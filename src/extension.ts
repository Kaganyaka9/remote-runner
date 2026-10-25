import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SshManager } from './sshManager';
import { DeltaSync } from './sync';
import { runSetupWizard } from './setupWizard';

let sshManager = new SshManager();
let isRunning = false;

function setRunningState(state: boolean) {
    isRunning = state;
    vscode.commands.executeCommand('setContext', 'remoteRunner.isRunning', state);
}

function setSshState(state: boolean) {
    vscode.commands.executeCommand('setContext', 'remoteRunner.sshConnected', state);
}

export function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const syncEngine = workspaceRoot ? new DeltaSync(workspaceRoot) : null;

    // Initialize UI state
    setSshState(false);
    setRunningState(false);

    // Sync state when terminal exits naturally or is closed by user
    sshManager.onSessionEnded = () => {
        setRunningState(false);
    };

    // Initial Setup
    const initCommand = vscode.commands.registerCommand('remoteRunner.initSetup', async () => {
        if (!workspaceRoot) return;
        await runSetupWizard(workspaceRoot);
    });

    const connectCommand = vscode.commands.registerCommand('remoteRunner.connectSsh', async () => {
        if (!workspaceRoot) return;
        const configPath = path.join(workspaceRoot, '.remote-runner.json');

        if (!fs.existsSync(configPath)) {
            if (await vscode.window.showInformationMessage('No .remote-runner.json found. Start setup wizard?', 'Start Wizard') === 'Start Wizard') {
                if (!(await runSetupWizard(workspaceRoot))) return;
            } else return;
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        try {
            vscode.window.showInformationMessage('Connecting to remote server...');
            await sshManager.connect(config);
            setSshState(true);
            vscode.window.showInformationMessage('SSH Connected.');

            // Launch the background shell instantly upon connection
            sshManager.openShell(config.remoteBaseDir, 'SSH Terminal');
        } catch (err: any) {
            vscode.window.showErrorMessage(`SSH Connection failed: ${err.message}`);
        }
    });

    const disconnectCommand = vscode.commands.registerCommand('remoteRunner.disconnectSsh', () => {
        sshManager.disconnect();
        setSshState(false);
        setRunningState(false);
        vscode.window.showInformationMessage('SSH Disconnected.');
    });


    async function executeRemoteFlow(type: 'debug' | 'memcheck') {
        if (!workspaceRoot || !syncEngine) return;
        const configPath = path.join(workspaceRoot, '.remote-runner.json');

        if (!fs.existsSync(configPath)) {
            vscode.commands.executeCommand('remoteRunner.initSetup');
            return;
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        try {
            if (!sshManager.client) {
                await sshManager.connect(config);
                setSshState(true);
            }

            const count = await syncEngine.syncWorkspace(sshManager.sftp!, config.remoteBaseDir, config.exclude || []);
            if (count > 0) vscode.window.showInformationMessage(`Synced ${count} updated file(s).`);

            // Pick the right command based on which button was pressed
            const runSubCmd = type === 'debug' ? config.debugCmd : config.memCheckCmd;
            const remoteCmd = `mkdir -p ${config.remoteBaseDir} && cd ${config.remoteBaseDir} && ${config.compileCmd} && ${runSubCmd}`;
            const terminalName = type === 'debug' ? 'GDB Runner' : 'Valgrind Check';

            setRunningState(true);
            sshManager.runInteractiveCommand(remoteCmd, terminalName);

        } catch (err: any) {
            setRunningState(false);
            vscode.window.showErrorMessage(`Execution failed: ${err.message}`);
        }
    }

    const debugCommand = vscode.commands.registerCommand('remoteRunner.debugCode', () => executeRemoteFlow('debug'));
    const memCheckCommand = vscode.commands.registerCommand('remoteRunner.memCheckCode', () => executeRemoteFlow('memcheck'));

    const stopCommand = vscode.commands.registerCommand('remoteRunner.stopProcess', () => {
        sshManager.stopRunningProcess();
        setRunningState(false);
    });

    context.subscriptions.push(initCommand, connectCommand, disconnectCommand, debugCommand, memCheckCommand, stopCommand);

}

export function deactivate() {
    sshManager.disconnect();
}