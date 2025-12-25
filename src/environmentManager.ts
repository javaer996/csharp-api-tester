import * as vscode from 'vscode';

export interface Environment {
    name: string;
    baseUrl: string;
    basePath: string;
    headers: Record<string, string>;
    customVariables: Record<string, string>;
    active: boolean;
}

export interface EnvironmentConfig {
    environments: Environment[];
    currentEnvironment: string;
}

export class EnvironmentManager {
    private static instance: EnvironmentManager;
    private config: EnvironmentConfig;
    private configChangeListener?: vscode.Disposable;

    private constructor() {
        this.config = this.getDefaultConfig(); // Initialize with default config
        this.loadConfiguration();

        this.configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('csharpApiTester.environments') ||
                event.affectsConfiguration('csharpApiTester.currentEnvironment')) {
                this.loadConfiguration();
            }
        });
    }

    public static getInstance(): EnvironmentManager {
        if (!EnvironmentManager.instance) {
            EnvironmentManager.instance = new EnvironmentManager();
        }
        return EnvironmentManager.instance;
    }

    public loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        const environments = config.get<Environment[]>('environments', []);
        let currentEnvironment = config.get<string>('currentEnvironment', 'Development');

        // If no environments exist, create default ones
        if (environments.length === 0) {
            this.config = this.getDefaultConfig();
        } else {
            // Ensure backwards compatibility by adding customVariables field if missing
            const compatibleEnvironments = environments.map(env => ({
                ...env,
                customVariables: env.customVariables || {},
                headers: env.headers || {}
            }));
            this.config = { environments: compatibleEnvironments, currentEnvironment };
        }

        // Ensure current environment exists
        const currentExists = this.config.environments.some(env => env.name === currentEnvironment);
        if (!currentExists && this.config.environments.length > 0) {
            this.config.currentEnvironment = this.config.environments[0].name;
        }

        console.log(`[EnvironmentManager] Loaded configuration:`, this.config);
    }

    private getDefaultConfig(): EnvironmentConfig {
        return {
            environments: [
                {
                    name: 'Development',
                    baseUrl: 'http://localhost:5000',
                    basePath: '/api',
                    headers: {},
                    customVariables: {},
                    active: true
                },
                {
                    name: 'Staging',
                    baseUrl: 'https://staging.example.com',
                    basePath: '/api',
                    headers: {},
                    customVariables: {
                        'API_VERSION': 'v1',
                        'DEBUG_MODE': 'true'
                    },
                    active: false
                }
            ],
            currentEnvironment: 'Development'
        };
    }

    private async saveConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        await config.update('environments', this.config.environments, vscode.ConfigurationTarget.Global);
        await config.update('currentEnvironment', this.config.currentEnvironment, vscode.ConfigurationTarget.Global);
        console.log(`[EnvironmentManager] Saved configuration`);
    }

    public getCurrentEnvironment(): Environment | null {
        const current = this.config.environments.find(env => env.name === this.config.currentEnvironment);
        return current || null;
    }

    public getAllEnvironments(): Environment[] {
        return this.config.environments;
    }

    public async setCurrentEnvironment(name: string): Promise<boolean> {
        if (this.config.environments.some(env => env.name === name)) {
            this.config.currentEnvironment = name;
            await this.saveConfiguration();

            vscode.window.showInformationMessage(`API Environment switched to: ${name}`);
            return true;
        }
        return false;
    }

    public async addEnvironment(environment: Environment): Promise<void> {
        if (this.config.environments.some(env => env.name === environment.name)) {
            throw new Error(`Environment '${environment.name}' already exists`);
        }

        this.config.environments.push(environment);
        await this.saveConfiguration();
        vscode.window.showInformationMessage(`Environment '${environment.name}' added`);
    }

    public async updateEnvironment(originalName: string, updates: Partial<Environment>): Promise<void> {
        const index = this.config.environments.findIndex(env => env.name === originalName);
        if (index === -1) {
            throw new Error(`Environment '${originalName}' not found`);
        }

        // Handle name changes
        if (updates.name && updates.name !== originalName) {
            // Check if new name already exists
            if (this.config.environments.some((env, idx) => env.name === updates.name && idx !== index)) {
                throw new Error(`Environment '${updates.name}' already exists`);
            }
            // Update current environment if it's being renamed
            if (this.config.currentEnvironment === originalName) {
                this.config.currentEnvironment = updates.name;
            }
        }

        this.config.environments[index] = { ...this.config.environments[index], ...updates };
        await this.saveConfiguration();
        vscode.window.showInformationMessage(`Environment '${updates.name || originalName}' updated`);
    }

    public async deleteEnvironment(name: string): Promise<void> {
        if (this.config.environments.length <= 1) {
            throw new Error('Cannot delete the last environment');
        }

        const index = this.config.environments.findIndex(env => env.name === name);
        if (index === -1) {
            throw new Error(`Environment '${name}' not found`);
        }

        // If we're deleting the current environment, switch to another one
        if (name === this.config.currentEnvironment) {
            const newCurrent = this.config.environments.find(env => env.name !== name);
            if (newCurrent) {
                this.config.currentEnvironment = newCurrent.name;
            }
        }

        this.config.environments.splice(index, 1);
        await this.saveConfiguration();
        vscode.window.showInformationMessage(`Environment '${name}' deleted`);
    }

    public getCustomVariableValue(name: string): string | undefined {
        const currentEnv = this.getCurrentEnvironment();
        if (!currentEnv) {
            return undefined;
        }
        return currentEnv.customVariables[name];
    }

    public getAllCustomVariables(): Record<string, string> {
        const currentEnv = this.getCurrentEnvironment();
        if (!currentEnv) {
            return {};
        }
        return currentEnv.customVariables;
    }

    public dispose(): void {
        this.configChangeListener?.dispose();
    }

    public async showEnvironmentPicker(): Promise<string | undefined> {
        const items = this.config.environments.map(env => ({
            label: env.name,
            description: `${env.baseUrl}${env.basePath}`,
            detail: this.getEnvironmentDetail(env),
            environment: env
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select API Environment',
            title: 'Choose Environment'
        });

        return selected?.label;
    }

    private getEnvironmentDetail(env: Environment): string {
        const headerDetails = Object.entries(env.headers || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
        const customVarDetails = Object.entries(env.customVariables || {}).map(([k, v]) => `${k}=${v}`).join(', ');

        const detailParts = [headerDetails];
        if (customVarDetails) {
            detailParts.push(`Vars: ${customVarDetails}`);
        }

        return detailParts.filter(part => part).join(' | ');
    }
}
