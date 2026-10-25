import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import SftpClient = require('ssh2-sftp-client');

interface CacheEntry {
    mtime: number;
    size: number;
}

export class DeltaSync {
    private cachePath: string;
    private cache: Record<string, CacheEntry> = {};

    constructor(private workspaceRoot: string) {
        this.cachePath = path.join(workspaceRoot, ".vscode", "sync-cache.json");
        this.loadCache();
    }

    private loadCache() {
        if (fs.existsSync(this.cachePath)) {
            try {
                this.cache = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
            } catch {
                this.cache = {};
            }
        }
    }

    private saveCache() {
        const dir = path.dirname(this.cachePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
    }

    // glob & exact matcher for excludes
    private shouldExclude(filename: string, relPath: string, excludes: string[]): boolean {
        for (const rule of excludes) {
            if (!rule) continue;
            // Exact name match (e.g. ".git", "build", "app")
            if (filename === rule || relPath === rule) return true;

            // Extension wildcard match (e.g. "*.o", "*.d")
            if (rule.startsWith("*.")) {
                const ext = rule.slice(1); // e.g. ".o"
                if (filename.endsWith(ext)) return true;
            }
        }
        return false;
    }

    public async syncWorkspace(
        sftp: SftpClient,
        remoteDir: string,
        excludes: string[]
    ): Promise<number> {
        // Resolve ~ to absolute home directory
        let targetDir = remoteDir;
        if (targetDir.startsWith("~/") || targetDir === "~") {
            const remoteHome = await sftp.realPath('.');
            targetDir = targetDir === '~'
                ? remoteHome
                : `${remoteHome}/${targetDir.slice(2)}`;
        }

        await sftp.mkdir(targetDir, true);
        let uploadedCount = 0;

        // Helper to recursively collect files locally first
        const getFilesToProcess = (dir: string): { local: string; rel: string; isDir: boolean }[] => {
            let results: { local: string; rel: string; isDir: boolean }[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const localPath = path.join(dir, entry.name);
                const relPath = path.relative(this.workspaceRoot, localPath).replace(/\\/g, '/');

                if (this.shouldExclude(entry.name, relPath, excludes)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    results.push({ local: localPath, rel: relPath, isDir: true });
                    results = results.concat(getFilesToProcess(localPath));
                } else if (entry.isFile()) {
                    results.push({ local: localPath, rel: relPath, isDir: false });
                }
            }
            return results;
        };

        const items = getFilesToProcess(this.workspaceRoot);

        // Process directories first
        for (const item of items.filter(i => i.isDir)) {
            const remoteSubDir = `${targetDir}/${item.rel}`;
            await sftp.mkdir(remoteSubDir, true);
        }

        // 3. Process and upload files
        for (const item of items.filter(i => !i.isDir)) {
            const stat = fs.statSync(item.local);
            const cached = this.cache[item.rel];
            const remoteFilePath = `${targetDir}/${item.rel}`;

            // Upload if modified, different size, or not in cache
            if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
                console.log(`[Sync] Uploading: ${item.rel} -> ${remoteFilePath}`);
                await sftp.fastPut(item.local, remoteFilePath);
                this.cache[item.rel] = { mtime: stat.mtimeMs, size: stat.size };
                uploadedCount++;
            }
        }

        this.saveCache();
        return uploadedCount;
    }
}