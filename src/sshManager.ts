import * as vscode from 'vscode';
import { Client, ClientChannel } from 'ssh2';
import SftpClient = require('ssh2-sftp-client');
import * as fs from 'fs';
import * as os from 'os';

export class SshManager {
    public client: Client | null = null;
    public sftp: SftpClient | null = null;
    private currentStream: ClientChannel | null = null;
    private terminal: vscode.Terminal | null = null;

    // Callback to let the extension know the terminal closed naturally or manually
    public onSessionEnded: (() => void) | null = null;

    public resolvePath(p: string): string {
        if (p.startsWith("~")) {
            return p.replace("~", os.homedir());
        }
        return p;
    }

    public async connect(config: any): Promise<void> {
        if (this.client) return;

        const privateKey = fs.readFileSync(this.resolvePath(config.privateKeyPath), 'utf8');

        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn
                .on("ready", async () => {
                    this.client = conn;
                    this.sftp = new SftpClient();
                    await this.sftp.connect({
                        host: config.host,
                        port: config.port || 22,
                        username: config.username,
                        privateKey: privateKey
                    });
                    resolve();
                })
                .on("error", err => reject(err))
                .on("end", () => this.disconnect())
                .on("close", () => this.disconnect())
                .connect({
                    host: config.host,
                    port: config.port || 22,
                    username: config.username,
                    privateKey: privateKey,
                    keepaliveInterval: 10000
                });
        });
    }

    public disconnect() {
        this.stopRunningProcess();
        if (this.sftp) {
            this.sftp.end();
            this.sftp = null;
        }
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }

    public runInteractiveCommand(cmd: string, terminalName: string) {
        if (!this.client) throw new Error("SSH connection is not open.");

        // Clean up any existing terminal/stream before starting a new one
        this.stopRunningProcess();

        const writeEmitter = new vscode.EventEmitter<string>();
        let streamRef: ClientChannel | null = null;

        const pty: vscode.Pseudoterminal = {
            onDidWrite: writeEmitter.event,
            open: () => {
                this.client!.shell({ term: "xterm-256color" }, (err, stream) => {
                    if (err) {
                        writeEmitter.fire(`\r\nFailed to allocate shell: ${err.message}\r\n`);
                        return;
                    }
                    this.currentStream = stream;
                    streamRef = stream;

                    stream.on("data", (data: Buffer) => writeEmitter.fire(data.toString()));

                    stream.on("close", () => {
                        writeEmitter.fire("\r\n[Session Finished]\r\n");
                        this.cleanupTerminalState();
                    });

                    // Send compilation and run command
                    stream.write(`${cmd}\n`);
                });
            },
            close: () => {
                // Triggered if the user clicks the 'X' on the terminal tab
                if (streamRef) {
                    streamRef.write('\x03'); // Send SIGINT
                    streamRef.close();
                }
                this.cleanupTerminalState();
            },
            handleInput: (data: string) => {
                if (streamRef) streamRef.write(data);
            }
        };

        this.terminal = vscode.window.createTerminal({ name: terminalName, pty });
        this.terminal.show();
    }

    private cleanupTerminalState() {
        this.currentStream = null;
        if (this.onSessionEnded) {
            this.onSessionEnded();
        }
    }

    public stopRunningProcess() {
        if (this.currentStream) {
            this.currentStream.write('\x03'); // Send SIGINT just in case
            this.currentStream.close(); // Forcefully destroy the SSH shell (kills GDB)
            this.currentStream = null;
        }
        if (this.terminal) {
            const t = this.terminal;
            this.terminal = null;
            t.dispose(); // Removes the UI tab
        }
        this.cleanupTerminalState();
    }

    public openShell(remoteDir: string, terminalName: string = "Remote SSH Shell") {
        if (!this.client) throw new Error('SSH connection is not open.');

        const writeEmitter = new vscode.EventEmitter<string>();
        let streamRef: ClientChannel | null = null;

        const pty: vscode.Pseudoterminal = {
            onDidWrite: writeEmitter.event,
            open: () => {
                this.client!.shell({ term: 'xterm-256color' }, (err, stream) => {
                    if (err) {
                        writeEmitter.fire(`\r\nFailed to allocate shell: ${err.message}\r\n`);
                        return;
                    }
                    streamRef = stream;
                    stream.on('data', (data: Buffer) => writeEmitter.fire(data.toString()));
                    stream.on('close', () => writeEmitter.fire('\r\n[Shell Closed]\r\n'));

                    // cd to the working directory automatically on launch
                    stream.write(`mkdir -p ${remoteDir} && cd ${remoteDir}\n`);
                });
            },
            close: () => {
                if (streamRef) streamRef.close();
            },
            handleInput: (data: string) => {
                if (streamRef) streamRef.write(data);
            }
        };

        const terminal = vscode.window.createTerminal({ name: terminalName, pty });
        terminal.show();
    }
}