import * as vscode from 'vscode';
import { ApiEndpointDetector, ApiEndpointInfo } from './apiEndpointDetector';

export class ApiCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(private detector: ApiEndpointDetector) {
        vscode.workspace.onDidChangeConfiguration((_) => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        console.log(`[C# API CodeLens] Providing code lenses for document: ${document.fileName}`);
        console.log(`[C# API CodeLens] Document language: ${document.languageId}`);
        console.log(`[C# API CodeLens] Document URI: ${document.uri.toString()}`);

        if (document.languageId !== 'csharp') {
            console.log(`[C# API CodeLens] Skipping non-C# document`);
            return [];
        }

        try {
            console.log(`[C# API CodeLens] Starting endpoint detection...`);
            const endpoints = await this.detector.detectApiEndpoints(document);
            console.log(`[C# API CodeLens] Detected ${endpoints.length} endpoints`);

            const codeLenses: vscode.CodeLens[] = [];

            try {
                for (const endpoint of endpoints) {
                    const range = new vscode.Range(
                        endpoint.line,
                        endpoint.character,
                        endpoint.line,
                        endpoint.character + endpoint.methodName.length
                    );

                    // Main test button
                    const testCommand: vscode.Command = {
                        title: `🚀 Test ${endpoint.method} ${endpoint.route}`,
                        command: 'csharpApiTester.testApi',
                        arguments: [endpoint]
                    };
                    codeLenses.push(new vscode.CodeLens(range, testCommand));

                    // Method info
                    const infoCommand: vscode.Command = {
                        title: `📋 ${endpoint.method} | ${endpoint.parameters.length} params | Returns: ${endpoint.returnType}`,
                        command: '',
                        tooltip: `HTTP Method: ${endpoint.method}\nRoute: ${endpoint.route}\nParameters: ${endpoint.parameters.length}\nReturn Type: ${endpoint.returnType}`
                    };
                    codeLenses.push(new vscode.CodeLens(range, infoCommand));

                    // Quick actions
                    if (endpoint.parameters.length > 0) {
                        const paramSummary = this.getParameterSummary(endpoint.parameters);
                        const paramsCommand: vscode.Command = {
                            title: `🔧 ${paramSummary}`,
                            command: '',
                            tooltip: this.getParameterTooltip(endpoint.parameters)
                        };
                        codeLenses.push(new vscode.CodeLens(range, paramsCommand));
                    }
                }
            } catch (error) {
                console.error(`[C# API CodeLens] Error during code lens generation:`, error);
            }

            console.log(`[C# API CodeLens] Generated ${codeLenses.length} code lenses`);
            return codeLenses;

        } catch (error) {
            console.error(`[C# API CodeLens] Error in provideCodeLenses:`, error);
            return [];
        }
    }

    public resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): vscode.CodeLens {
        return codeLens;
    }

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    private getParameterSummary(parameters: any[]): string {
        const sources = parameters.reduce((acc, param) => {
            acc[param.source] = (acc[param.source] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const parts: string[] = [];
        if (sources.path) parts.push(`${sources.path} path`);
        if (sources.query) parts.push(`${sources.query} query`);
        if (sources.body) parts.push(`${sources.body} body`);
        if (sources.header) parts.push(`${sources.header} header`);
        if (sources.form) parts.push(`${sources.form} form`);

        return parts.join(' • ');
    }

    private getParameterTooltip(parameters: any[]): string {
        const lines: string[] = ['Parameters:'];

        for (const param of parameters) {
            const required = param.required ? 'Required' : 'Optional';
            lines.push(`  ${param.name} (${param.type}) - ${param.source} - ${required}`);
        }

        return lines.join('\n');
    }
}