import * as vscode from 'vscode';

export interface SavedApiParameters {
    method: string;
    url: string;
    queryParams: Record<string, string>;
    headers: Record<string, string>;
    formData: Record<string, string>;
    bodyText: string;
    timestamp: number;
}

type SavedParametersMap = Record<string, SavedApiParameters>;

export class ParameterStorage {
    private static globalState: vscode.Memento | null = null;
    private static readonly STORAGE_KEY = 'csharpApiTester.savedParameters';

    public static initialize(context: vscode.ExtensionContext) {
        this.globalState = context.globalState;
    }

    public static createStorageKey(panelKey: string, environmentName?: string): string {
        const envPart = environmentName ? environmentName.trim() : 'default';
        return `${panelKey}@@${envPart}`;
    }

    public static getParameters(key: string): SavedApiParameters | undefined {
        const all = this.readAll();
        return all[key];
    }

    public static async saveParameters(key: string, data: SavedApiParameters): Promise<void> {
        const all = this.readAll();
        all[key] = data;
        await this.writeAll(all);
    }

    public static async deleteParameters(key: string): Promise<void> {
        const all = this.readAll();
        if (all[key]) {
            delete all[key];
            await this.writeAll(all);
        }
    }

    public static async clearParametersForPanel(panelKey: string): Promise<void> {
        if (!panelKey) {
            return;
        }

        const prefix = `${panelKey}@@`;
        const all = this.readAll();
        let modified = false;

        for (const key of Object.keys(all)) {
            if (key.startsWith(prefix)) {
                delete all[key];
                modified = true;
            }
        }

        if (modified) {
            await this.writeAll(all);
        }
    }

    private static readAll(): SavedParametersMap {
        if (!this.globalState) {
            return {};
        }

        const stored = this.globalState.get<SavedParametersMap>(this.STORAGE_KEY, {});
        // Create a shallow copy to avoid mutating the stored reference directly
        return { ...stored };
    }

    private static async writeAll(data: SavedParametersMap): Promise<void> {
        if (!this.globalState) {
            return;
        }
        await this.globalState.update(this.STORAGE_KEY, data);
    }
}
