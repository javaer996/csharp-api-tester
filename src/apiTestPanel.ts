import * as vscode from 'vscode';
import { ApiEndpointInfo } from './apiEndpointDetector';
import { ApiRequestGenerator, GeneratedRequest } from './apiRequestGenerator';
import { EnvironmentManager, Environment } from './environmentManager';
import axios, { AxiosError } from 'axios';

export class ApiTestPanel {
    private static panels: Map<string, ApiTestPanel> = new Map();
    public static readonly viewType = 'apiTestPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _currentEndpoint: ApiEndpointInfo | undefined;
    private _requestGenerator: ApiRequestGenerator;
    private _environmentManager: EnvironmentManager;
    private _panelKey: string;

    public static createOrShow(extensionUri: vscode.Uri, endpoint?: ApiEndpointInfo) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Generate unique key for this endpoint
        const panelKey = endpoint
            ? `${endpoint.method}-${endpoint.route}`
            : 'default';

        // If we already have a panel for this endpoint, show it
        if (ApiTestPanel.panels.has(panelKey)) {
            const existingPanel = ApiTestPanel.panels.get(panelKey)!;
            existingPanel._panel.reveal(column);
            if (endpoint) {
                existingPanel._currentEndpoint = endpoint;
                existingPanel.updateContent();
            }
            return;
        }

        // Create title with endpoint info
        const title = endpoint
            ? `[TEST] ${endpoint.method} ${endpoint.route}`
            : 'API Test Panel';

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            ApiTestPanel.viewType,
            title,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'out')]
            }
        );

        const apiTestPanel = new ApiTestPanel(panel, extensionUri, endpoint, panelKey);
        ApiTestPanel.panels.set(panelKey, apiTestPanel);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        endpoint: ApiEndpointInfo | undefined,
        panelKey: string
    ) {
        this._panel = panel;
        this._extensionUri = _extensionUri;
        this._currentEndpoint = endpoint;
        this._panelKey = panelKey;
        this._requestGenerator = new ApiRequestGenerator();
        this._environmentManager = EnvironmentManager.getInstance();

        // Set the webview's initial html content
        this.updateContent();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                console.log(`[ApiTestPanel] 📨 Received message from webview:`, message);
                try {
                    switch (message.type) {
                        case 'testApi':
                            console.log(`[ApiTestPanel] 🚀 Processing testApi message with data:`, message.data);
                            await this.testApi(message.data);
                            break;
                        case 'updateBaseUrl':
                            console.log(`[ApiTestPanel] 🌐 Processing updateBaseUrl:`, message.baseUrl);
                            await this.updateBaseUrl(message.baseUrl);
                            break;
                        case 'updateHeaders':
                            console.log(`[ApiTestPanel] 📋 Processing updateHeaders:`, message.headers);
                            await this.updateHeaders(message.headers);
                            break;
                        case 'regenerateRequest':
                            console.log(`[ApiTestPanel] 🔄 Processing regenerateRequest`);
                            this.regenerateRequest();
                            break;
                        case 'switchEnvironment':
                            console.log(`[ApiTestPanel] 🌍 Processing switchEnvironment`);
                            await this.switchEnvironment();
                            break;
                        case 'editEnvironment':
                            console.log(`[ApiTestPanel] ⚙️  Processing editEnvironment`);
                            await this.editCurrentEnvironment();
                            break;
                        case 'manageEnvironments':
                            console.log(`[ApiTestPanel] 📁 Processing manageEnvironments`);
                            await this.openEnvironmentManagement();
                            break;
                        default:
                            console.log(`[ApiTestPanel] ❓ Unknown message type:`, message.type);
                    }
                } catch (error) {
                    console.error(`[ApiTestPanel] ❌ Error processing message:`, error);
                    this._panel.webview.postMessage({
                        type: 'testResult',
                        result: {
                            success: false,
                            status: 0,
                            statusText: 'Internal Error',
                            error: `Message processing failed: ${error}`,
                            duration: 0,
                            data: null,
                            headers: {}
                        }
                    });
                }
            },
            null,
            this._disposables
        );
    }

    private updateContent() {
        if (!this._currentEndpoint) {
            this._panel.webview.html = this.getWelcomeHtml();
            return;
        }

        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        if (!currentEnvironment) {
            this._panel.webview.html = this.getNoEnvironmentHtml();
            return;
        }

        const fullBaseUrl = currentEnvironment.baseUrl;
        const fullHeaders = currentEnvironment.headers;

        const generatedRequest = this._requestGenerator.generateRequestForEnvironment(this._currentEndpoint, currentEnvironment);

        this._panel.webview.html = this.getTestPanelHtml(this._currentEndpoint, generatedRequest, fullHeaders, currentEnvironment);
    }

    private async testApi(requestData: any) {
        console.log(`[ApiTestPanel] testApi called with:`, requestData);

        // Send loading state to frontend first
        this._panel.webview.postMessage({
            type: 'testStarted',
            message: 'Starting HTTP request...'
        });

        const startTime = Date.now();
        let result;

        try {
            const config = {
                method: requestData.method,
                url: requestData.url,
                headers: requestData.headers,
                timeout: vscode.workspace.getConfiguration('csharpApiTester').get<number>('timeout', 30000)
            };

            // Add body for POST/PUT methods
            if (['POST', 'PUT', 'PATCH'].includes(requestData.method) && requestData.body) {
                (config as any).data = requestData.body;
            }

            console.log(`[ApiTestPanel] Making HTTP request with config:`, config);

            const response = await axios(config);

            result = {
                success: true,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data,
                duration: Date.now() - startTime,
                requestConfig: config
            };

            console.log(`[ApiTestPanel] Successful response:`, result);

        } catch (error) {
            console.error(`[ApiTestPanel] HTTP request failed:`, error);

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                const duration = Date.now() - startTime;
                result = {
                    success: false,
                    status: axiosError.response?.status || 0,
                    statusText: axiosError.response?.statusText || 'Network Error',
                    headers: axiosError.response?.headers || {},
                    data: axiosError.response?.data || axiosError.message,
                    duration: duration,
                    error: axiosError.message,
                    requestConfig: {
                        method: requestData.method,
                        url: requestData.url,
                        headers: requestData.headers
                    }
                };
            } else {
                result = {
                    success: false,
                    status: 0,
                    statusText: 'Error',
                    headers: {},
                    data: null,
                    duration: Date.now() - startTime,
                    error: String(error),
                    requestConfig: {
                        method: requestData.method,
                        url: requestData.url,
                        headers: requestData.headers
                    }
                };
            }
        }

        // Send result to frontend
        this._panel.webview.postMessage({
            type: 'testResult',
            result: result
        });
    }

    private async updateBaseUrl(baseUrl: string) {
        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        if (currentEnvironment) {
            await this._environmentManager.updateEnvironment(currentEnvironment.name, {
                baseUrl: baseUrl
            });
            this.updateContent();
        }
    }

    private async updateHeaders(headers: Record<string, string>) {
        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        if (currentEnvironment) {
            await this._environmentManager.updateEnvironment(currentEnvironment.name, {
                headers: headers
            });
        }
    }

    private regenerateRequest() {
        this.updateContent();
    }

    private async switchEnvironment(): Promise<void> {
        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        const environments = this._environmentManager.getAllEnvironments();

        // Build environment list with current marked
        const items = environments.map(env => ({
            label: `${env.name}${env.name === currentEnvironment?.name ? '  ✓ (Current)' : ''}`,
            description: `${env.baseUrl}${env.basePath}`,
            detail: Object.entries(env.headers).map(([k, v]) => `${k}: ${v}`).join(', '),
            environment: env
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select API Environment',
            title: 'Switch Environment',
            ignoreFocusOut: true
        });

        if (selected && selected.environment.name !== currentEnvironment?.name) {
            await this._environmentManager.setCurrentEnvironment(selected.environment.name);
            this.updateContent();
        }
    }

    private async editCurrentEnvironment(): Promise<void> {
        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        if (!currentEnvironment) {
            vscode.window.showWarningMessage('No current environment to edit');
            return;
        }

        const choices = [
            { label: 'Environment Name', key: 'name', value: currentEnvironment.name },
            { label: 'Base URL', key: 'baseUrl', value: currentEnvironment.baseUrl },
            { label: 'Base Path', key: 'basePath', value: currentEnvironment.basePath },
            { label: 'Headers (JSON)', key: 'headers', value: JSON.stringify(currentEnvironment.headers, null, 2) }
        ];

        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: 'Select field to edit',
            title: `Edit Environment: ${currentEnvironment.name}`
        });

        if (!selected) return;

        let newValue = await vscode.window.showInputBox({
            prompt: `Enter new ${selected.label}`,
            value: selected.value
        });

        if (!newValue) return;

        try {
            if (selected.key === 'headers') {
                newValue = JSON.parse(newValue);
            }

            await this._environmentManager.updateEnvironment(currentEnvironment.name, {
                [selected.key]: newValue
            });

            vscode.window.showInformationMessage(`'${selected.label}' updated successfully`);
            this.updateContent();

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update ${selected.label}: ${error}`);
        }
    }

    private async openEnvironmentManagement(): Promise<void> {
        this._panel.reveal(); // Make sure panel is visible while managing
        await vscode.commands.executeCommand('csharpApiTester.manageEnvironments');
    }

    private getWelcomeHtml(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>API Test Panel</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 20px;
                    }
                    .welcome {
                        text-align: center;
                        margin-top: 50px;
                    }
                    .welcome h1 {
                        color: var(--vscode-foreground);
                    }
                    .welcome p {
                        margin: 10px 0;
                    }
                    .highlight {
                        color: var(--vscode-textLink-foreground);
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="welcome">
                    <h1>🚀 C# API Tester</h1>
                    <p>Open a C# controller file and click on the <span class="highlight">Test API</span> button above any API method to start testing.</p>
                    <p>This extension will automatically detect HTTP methods, routes, and parameters.</p>
                </div>
            </body>
            </html>
        `;
    }

    private getNoEnvironmentHtml(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>No Environment Configured</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 20px;
                    }
                    .warning {
                        text-align: center;
                        margin-top: 50px;
                        padding: 20px;
                        border: 1px solid var(--vscode-inputValidation-warningBorder);
                        border-radius: 5px;
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                    }
                    .warning h2 {
                        color: var(--vscode-textLink-foreground);
                        margin-bottom: 15px;
                    }
                    .warning p {
                        margin: 10px 0;
                    }
                    .action-button {
                        display: inline-block;
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        text-decoration: none;
                        margin: 5px;
                    }
                    .action-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="warning">
                    <h2>⚠️ No Environment Configured</h2>
                    <p>No API environment is currently configured.</p>
                    <p>Please set up an environment before testing APIs.</p>
                </div>
            </body>
            </html>
        `;
    }

    private getTestPanelHtml(endpoint: ApiEndpointInfo, request: GeneratedRequest, _defaultHeaders: Record<string, string>, currentEnvironment: Environment): string {
        // Prepare data for JavaScript injection
        const endpointMethod = endpoint.method;
        const endpointRoute = endpoint.route;

        // Parse query params from the generated request
        const queryParamsJson = JSON.stringify(request.queryParams);
        const headersJson = JSON.stringify(request.headers);
        const bodyJson = request.body ? JSON.stringify(request.body, null, 2) : '';

        // Get base URL without query string
        const urlWithoutQuery = request.url.split('?')[0];

        // Get method badge class
        const methodClass = `method-${endpointMethod.toLowerCase()}`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; font-src 'self';">
    <title>${endpoint.method} ${endpoint.route}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }

        /* Request Line */
        .request-line {
            display: flex;
            gap: 12px;
            align-items: center;
            padding: 20px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .method-badge {
            padding: 8px 16px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 13px;
            text-align: center;
            min-width: 70px;
            flex-shrink: 0;
        }

        .method-get { background: #61AFFE; color: white; }
        .method-post { background: #49CC90; color: white; }
        .method-put { background: #FCA130; color: white; }
        .method-delete { background: #F93E3E; color: white; }
        .method-patch { background: #50E3C2; color: white; }

        .url-input {
            flex: 1;
            padding: 10px 15px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
        }

        .url-input:focus {
            outline: none;
            border-color: #49CC90;
        }

        .send-button {
            padding: 10px 35px;
            background: #49CC90;
            color: white;
            border: none;
            border-radius: 4px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
            flex-shrink: 0;
        }

        .send-button:hover {
            background: #3DB87C;
        }

        .send-button:active {
            background: #35A56D;
        }

        /* Tab Navigation */
        .tabs-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .tab-nav {
            display: flex;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 0 20px;
        }

        .tab-button {
            padding: 12px 20px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
            opacity: 0.7;
        }

        .tab-button:hover {
            opacity: 1;
        }

        .tab-button.active {
            border-bottom-color: #49CC90;
            color: #49CC90;
            opacity: 1;
        }

        .tab-content {
            display: none;
            flex: 1;
            overflow: auto;
            padding: 20px;
        }

        .tab-content.active {
            display: block;
        }

        /* Params Table */
        .params-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
        }

        .params-table thead {
            background: var(--vscode-editor-inactiveSelectionBackground);
        }

        .params-table th {
            text-align: left;
            padding: 10px 12px;
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .params-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .params-table tr:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .params-table input[type="checkbox"] {
            cursor: pointer;
            width: 16px;
            height: 16px;
        }

        .params-table input[type="text"] {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid transparent;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 13px;
            font-family: 'Consolas', 'Monaco', monospace;
        }

        .params-table input[type="text"]:focus {
            outline: none;
            border-color: #49CC90;
            background: var(--vscode-editor-background);
        }

        .param-actions {
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        .action-icon {
            cursor: pointer;
            opacity: 0.6;
            transition: opacity 0.2s;
            font-size: 16px;
        }

        .action-icon:hover {
            opacity: 1;
        }

        .add-param-btn {
            padding: 8px 16px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
            transition: background 0.2s;
        }

        .add-param-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Body Editor */
        .body-editor {
            height: 400px;
        }

        .body-editor textarea {
            width: 100%;
            height: 100%;
            padding: 15px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-editor-foreground);
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            resize: vertical;
        }

        .body-editor textarea:focus {
            outline: none;
            border-color: #49CC90;
        }

        .format-button {
            position: absolute;
            top: 25px;
            right: 25px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
            z-index: 10;
        }

        .format-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Response Container */
        .response-container {
            border-top: 3px solid var(--vscode-panel-border);
            flex: 1;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }

        .response-container.visible {
            display: flex;
        }

        .response-status-bar {
            padding: 15px 20px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 25px;
            align-items: center;
        }

        .response-status-bar.success {
            border-left: 4px solid #49CC90;
        }

        .response-status-bar.error {
            border-left: 4px solid #F93E3E;
        }

        .status-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
        }

        .status-item strong {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }

        .status-code {
            font-weight: bold;
            font-size: 14px;
        }

        .status-code.success {
            color: #49CC90;
        }

        .status-code.error {
            color: #F93E3E;
        }

        .response-tabs {
            display: flex;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 0 20px;
        }

        .response-tab {
            padding: 10px 18px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 13px;
            opacity: 0.7;
        }

        .response-tab:hover {
            opacity: 1;
        }

        .response-tab.active {
            border-bottom-color: #49CC90;
            color: #49CC90;
            opacity: 1;
        }

        .response-content {
            flex: 1;
            overflow: auto;
            display: none;
            padding: 20px;
            position: relative;
        }

        .response-content.active {
            display: block;
        }

        .response-content pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            line-height: 1.5;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        /* Scrollbar Styling */
        ::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }

        ::-webkit-scrollbar-track {
            background: var(--vscode-editor-background);
        }

        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 5px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Request Line -->
        <div class="request-line">
            <span class="method-badge ${methodClass}">${endpointMethod}</span>
            <input type="text" class="url-input" id="fullUrl" value="${request.url}" />
            <button class="send-button" onclick="sendRequest()">Send</button>
        </div>

        <!-- Request Tabs -->
        <div class="tabs-container">
            <div class="tab-nav">
                <button class="tab-button ${Object.keys(request.queryParams).length > 0 ? 'active' : ''}" onclick="switchTab('query')">Query</button>
                <button class="tab-button ${Object.keys(request.queryParams).length === 0 ? 'active' : ''}" onclick="switchTab('headers')">Headers</button>
                ${request.body ? '<button class="tab-button" onclick="switchTab(\'body\')">Body</button>' : ''}
            </div>

            <!-- Query Tab -->
            <div class="tab-content ${Object.keys(request.queryParams).length > 0 ? 'active' : ''}" id="query-tab">
                <table class="params-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">✓</th>
                            <th style="width: 30%;">Key</th>
                            <th style="width: 30%;">Value</th>
                            <th>Description</th>
                            <th style="width: 80px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="query-params-body">
                        <!-- Will be populated by JavaScript -->
                    </tbody>
                </table>
                <button class="add-param-btn" onclick="addQueryParam()">+ Add Query Parameter</button>
            </div>

            <!-- Headers Tab -->
            <div class="tab-content ${Object.keys(request.queryParams).length === 0 && !request.body ? 'active' : ''}" id="headers-tab">
                <table class="params-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">✓</th>
                            <th style="width: 30%;">Key</th>
                            <th style="width: 30%;">Value</th>
                            <th>Description</th>
                            <th style="width: 80px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="headers-params-body">
                        <!-- Will be populated by JavaScript -->
                    </tbody>
                </table>
                <button class="add-param-btn" onclick="addHeader()">+ Add Header</button>
            </div>

            ${request.body ? `
            <!-- Body Tab -->
            <div class="tab-content" id="body-tab">
                <div class="body-editor" style="position: relative;">
                    <button class="format-button" onclick="formatBodyJson()">Format JSON</button>
                    <textarea id="request-body">${bodyJson}</textarea>
                </div>
            </div>
            ` : ''}
        </div>

        <!-- Response Container -->
        <div class="response-container" id="response-container">
            <div class="response-status-bar" id="response-status-bar">
                <div class="status-item">
                    <strong>Status:</strong>
                    <span class="status-code" id="status-code">200 OK</span>
                </div>
                <div class="status-item">
                    <strong>Time:</strong>
                    <span id="response-time">0ms</span>
                </div>
                <div class="status-item">
                    <strong>Size:</strong>
                    <span id="response-size">0 B</span>
                </div>
            </div>

            <div class="response-tabs">
                <button class="response-tab active" onclick="switchResponseTab('body')">Body</button>
                <button class="response-tab" onclick="switchResponseTab('headers')">Headers</button>
            </div>

            <div class="response-content active" id="response-body-tab">
                <div class="empty-state">No response yet. Click Send to make a request.</div>
            </div>

            <div class="response-content" id="response-headers-tab">
                <pre>{}</pre>
            </div>
        </div>
    </div>

    <script>
        // Initialize VS Code API
        const vscode = acquireVsCodeApi();

        // Initial data
        let queryParams = ${queryParamsJson};
        let headers = ${headersJson};
        const baseUrl = '${urlWithoutQuery}';

        // Initialize on load
        window.addEventListener('DOMContentLoaded', () => {
            renderQueryParams();
            renderHeaders();
            updateUrlFromQueryParams();
        });

        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }

        function switchResponseTab(tabName) {
            document.querySelectorAll('.response-tab').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.response-content').forEach(content => content.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById('response-' + tabName + '-tab').classList.add('active');
        }

        // Query params rendering
        function renderQueryParams() {
            const tbody = document.getElementById('query-params-body');
            tbody.innerHTML = '';

            Object.entries(queryParams).forEach(([key, value]) => {
                const row = createParamRow(key, value, 'query');
                tbody.appendChild(row);
            });
        }

        // Headers rendering
        function renderHeaders() {
            const tbody = document.getElementById('headers-params-body');
            tbody.innerHTML = '';

            Object.entries(headers).forEach(([key, value]) => {
                const row = createParamRow(key, value, 'header');
                tbody.appendChild(row);
            });
        }

        // Create param row
        function createParamRow(key, value, type) {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
                <td><input type="checkbox" checked onchange="toggleParam('\${type}', '\${key}')" /></td>
                <td><input type="text" value="\${key}" onchange="updateParamKey('\${type}', '\${key}', this.value)" /></td>
                <td><input type="text" value="\${value}" oninput="updateParamValue('\${type}', '\${key}', this.value)" /></td>
                <td><input type="text" placeholder="Description" /></td>
                <td class="param-actions">
                    <span class="action-icon" onclick="deleteParam('\${type}', '\${key}')" title="Delete">🗑️</span>
                </td>
            \`;
            return tr;
        }

        // Add query param
        function addQueryParam() {
            const newKey = 'new_param';
            queryParams[newKey] = '';
            renderQueryParams();
            updateUrlFromQueryParams();
        }

        // Add header
        function addHeader() {
            const newKey = 'New-Header';
            headers[newKey] = '';
            renderHeaders();
        }

        // Update param value
        function updateParamValue(type, key, newValue) {
            if (type === 'query') {
                queryParams[key] = newValue;
                updateUrlFromQueryParams();
            } else if (type === 'header') {
                headers[key] = newValue;
            }
        }

        // Update param key
        function updateParamKey(type, oldKey, newKey) {
            if (type === 'query') {
                queryParams[newKey] = queryParams[oldKey];
                delete queryParams[oldKey];
                renderQueryParams();
                updateUrlFromQueryParams();
            } else if (type === 'header') {
                headers[newKey] = headers[oldKey];
                delete headers[oldKey];
                renderHeaders();
            }
        }

        // Toggle param
        function toggleParam(type, key) {
            // For now, just remove from object if unchecked
            // You can enhance this to keep disabled params
        }

        // Delete param
        function deleteParam(type, key) {
            if (type === 'query') {
                delete queryParams[key];
                renderQueryParams();
                updateUrlFromQueryParams();
            } else if (type === 'header') {
                delete headers[key];
                renderHeaders();
            }
        }

        // Update URL from query params
        function updateUrlFromQueryParams() {
            const params = new URLSearchParams(queryParams);
            const queryString = params.toString();
            const newUrl = queryString ? baseUrl + '?' + queryString : baseUrl;
            document.getElementById('fullUrl').value = newUrl;
        }

        // Parse URL to query params
        function parseUrlToQueryParams() {
            const url = document.getElementById('fullUrl').value;
            try {
                const urlObj = new URL(url);
                queryParams = {};
                urlObj.searchParams.forEach((value, key) => {
                    queryParams[key] = value;
                });
                renderQueryParams();
            } catch (e) {
                console.error('Invalid URL', e);
            }
        }

        // Listen to URL changes
        document.getElementById('fullUrl').addEventListener('change', parseUrlToQueryParams);

        // Format JSON
        function formatBodyJson() {
            const textarea = document.getElementById('request-body');
            try {
                const parsed = JSON.parse(textarea.value);
                textarea.value = JSON.stringify(parsed, null, 2);
            } catch (error) {
                alert('Invalid JSON: ' + error.message);
            }
        }

        // Send request
        function sendRequest() {
            const url = document.getElementById('fullUrl').value;
            const bodyElement = document.getElementById('request-body');
            const body = bodyElement ? bodyElement.value : null;

            try {
                const requestData = {
                    method: '${endpointMethod}',
                    url: url,
                    headers: headers,
                    body: body ? JSON.parse(body) : null
                };

                // Show loading
                const responseContainer = document.getElementById('response-container');
                responseContainer.classList.add('visible');
                document.getElementById('response-body-tab').innerHTML = '<div class="empty-state">Loading...</div>';

                vscode.postMessage({
                    type: 'testApi',
                    data: requestData
                });
            } catch (error) {
                alert('Error preparing request: ' + error.message);
            }
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            if (message.type === 'testResult') {
                displayResponse(message.result);
            }
        });

        // Display response
        function displayResponse(result) {
            const statusBar = document.getElementById('response-status-bar');
            const statusCode = document.getElementById('status-code');
            const responseTime = document.getElementById('response-time');
            const responseSize = document.getElementById('response-size');
            const bodyTab = document.getElementById('response-body-tab');
            const headersTab = document.getElementById('response-headers-tab');

            // Update status
            if (result.success) {
                statusBar.classList.remove('error');
                statusBar.classList.add('success');
                statusCode.classList.remove('error');
                statusCode.classList.add('success');
            } else {
                statusBar.classList.remove('success');
                statusBar.classList.add('error');
                statusCode.classList.remove('success');
                statusCode.classList.add('error');
            }

            statusCode.textContent = result.status + ' ' + result.statusText;
            responseTime.textContent = result.duration + 'ms';

            // Calculate size
            const dataSize = JSON.stringify(result.data).length;
            responseSize.textContent = formatBytes(dataSize);

            // Update body
            if (result.data) {
                const formattedData = typeof result.data === 'string'
                    ? result.data
                    : JSON.stringify(result.data, null, 2);
                bodyTab.innerHTML = '<button class="format-button" onclick="formatResponseJson()">Format JSON</button><pre>' + formattedData + '</pre>';
            } else {
                bodyTab.innerHTML = '<div class="empty-state">No response body</div>';
            }

            // Update headers
            if (result.headers) {
                headersTab.innerHTML = '<pre>' + JSON.stringify(result.headers, null, 2) + '</pre>';
            }

            // Show error if exists
            if (result.error) {
                bodyTab.innerHTML += '<div style="color: #F93E3E; margin-top: 15px; padding: 15px; background: var(--vscode-inputValidation-errorBackground); border-radius: 4px;"><strong>Error:</strong> ' + result.error + '</div>';
            }
        }

        // Format bytes
        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }

        // Format response JSON
        function formatResponseJson() {
            const bodyTab = document.getElementById('response-body-tab');
            const pre = bodyTab.querySelector('pre');
            if (pre) {
                try {
                    const parsed = JSON.parse(pre.textContent);
                    pre.textContent = JSON.stringify(parsed, null, 2);
                } catch (error) {
                    console.error('Cannot format response:', error);
                }
            }
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        ApiTestPanel.panels.delete(this._panelKey);

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}