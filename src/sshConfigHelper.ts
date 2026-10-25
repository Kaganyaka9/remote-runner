import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SSHConfig from 'ssh-config';

export interface HostOption {
    host: string;
    hostname?: string;
    user?: string;
    port?: number;
    identityFile?: string;
}

export function getSshConfigPath(): string {
    return path.join(os.homedir(), ".ssh", "config");
}

export function parseUserSshConfig(): HostOption[] {
    const configPath = getSshConfigPath();
    if (!fs.existsSync(configPath)) {
        return [];
    }

    try {
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = SSHConfig.parse(raw);
        const results: HostOption[] = [];

        for (const section of parsed) {
            if (section.type === 1 && section.param === "Host" && section.value !== "*") {
                const hostName = section.value as string;

                const configForHost = parsed.compute(hostName);

                let rawIdentityFile = configForHost.IdentityFile;
                if (Array.isArray(rawIdentityFile)) {
                    rawIdentityFile = rawIdentityFile[0];
                }

                results.push({
                    host: hostName,
                    hostname: configForHost.HostName as string | undefined,
                    user: configForHost.User as string | undefined,
                    port: configForHost.Port ? parseInt(configForHost.Port as string, 10) : 22,
                    identityFile: typeof rawIdentityFile === 'string' ? rawIdentityFile.replace(/['"]/g, '') : undefined
                });
            }
        }
        return results;
    } catch {
        return [];
    }
}