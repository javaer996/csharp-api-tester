import * as vscode from 'vscode';
import { ApiEndpointInfo } from './apiEndpointDetector';
import { ApiRequestGenerator, GeneratedRequest } from './apiRequestGenerator';
import { EnvironmentManager, Environment } from './environmentManager';
import axios, { AxiosError } from 'axios';

export class ApiTestPanel {
    public static currentPanel: ApiTestPanel | undefined;
    public static readonly viewType = 'apiTestPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _currentEndpoint: ApiEndpointInfo | undefined;
    private _requestGenerator: ApiRequestGenerator;
    private _environmentManager: EnvironmentManager;

    public static createOrShow(extensionUri: vscode.Uri, endpoint?: ApiEndpointInfo) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (ApiTestPanel.currentPanel) {
            ApiTestPanel.currentPanel._panel.reveal(column);
            if (endpoint) {
                ApiTestPanel.currentPanel._currentEndpoint = endpoint;
                ApiTestPanel.currentPanel.updateContent();
            }
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            ApiTestPanel.viewType,
            'API Test Panel',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'out')]
            }
        );

        ApiTestPanel.currentPanel = new ApiTestPanel(panel, extensionUri, endpoint);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        endpoint?: ApiEndpointInfo
    ) {
        this._panel = panel;
        this._extensionUri = _extensionUri;
        this._currentEndpoint = endpoint;
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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; font-src 'self';">
    <title>API Test Panel - ${endpoint.method} ${endpoint.route}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .button-group {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-weight: bold;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #result {
            margin-top: 20px;
            padding: 15px;
            border-radius: 5px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
        }
                .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .form-control-wrapper {
            position: relative;
        }
        .format-button {
            position: absolute;
            top: 5px;
            right: 5px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
            z-index: 10;
        }
        .format-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        input, textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            box-sizing: border-box;
        }
        textarea {
            min-height: 100px;
            resize: vertical;
            padding-right: 60px; /* Make room for format button */
        }
        .response-container {
            margin-top: 20px;
        }
        .response-status {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 10px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .response-status.success {
            border-left-color: #4CAF50;
        }
        .response-status.error {
            border-left-color: #F44336;
        }
        .response-content {
            background: var(--vscode-textCodeBlock-background);
            border-radius: 5px;
            overflow: hidden;
        }
        .response-tabs {
            display: flex;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .response-tab {
            padding: 10px 15px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            border-bottom: 2px solid transparent;
        }
        .response-tab.active {
            border-bottom-color: var(--vscode-textLink-foreground);
            color: var(--vscode-textLink-foreground);
            background: var(--vscode-textCodeBlock-background);
        }
        .response-tab-content {
            display: none;
            padding: 15px;
            position: relative;
        }
        .response-tab-content.active {
            display: block;
        }
        .format-response-button {
            position: absolute;
            top: 10px;
            right: 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>API Test Panel</h1>
        <div>
            <strong>Method:</strong> ${endpoint.method}<br>
            <strong>Route:</strong> ${endpoint.route}<br>
            <strong>Environment:</strong> ${currentEnvironment.name}
        </div>

        <div class="form-group">
            <label for="fullUrl">Full URL:</label>
            <input type="text" id="fullUrl" value="${request.url}" />
        </div>

        <div class="form-group">
            <label for="headers">Headers (JSON):</label>
            <div class="form-control-wrapper">
                <textarea id="headers">${JSON.stringify(request.headers, null, 2)}</textarea>
                <button type="button" class="format-button" onclick="formatJson('headers')">Format</button>
            </div>
        </div>

        ${request.body ? `
        <div class="form-group">
            <label for="requestBody">Request Body (JSON):</label>
            <div class="form-control-wrapper">
                <textarea id="requestBody">${JSON.stringify(request.body, null, 2)}</textarea>
                <button type="button" class="format-button" onclick="formatJson('requestBody')">Format</button>
            </div>
        </div>
        ` : ''}

        <div class="button-group">
            <button id="testButton" onclick="testApiFunction()">🚀 Test API</button>
            <button onclick="testConnectionFunction()" style="background-color: orange;">🔧 Test Connection</button>
        </div>

        <div id="result"></div>
    </div>

    <script>
        console.log('🔧 Script starting to load...');

        // Global error handler
        window.onerror = function(message, source, lineno, colno, error) {
            console.error('🚨 JavaScript Error:', {
                message: message,
                source: source,
                line: lineno,
                column: colno,
                error: error
            });
            document.getElementById('result').innerHTML = '<div style="color: red;">JavaScript Error: ' + message + '</div>';
            return true;
        };

        console.log('🔧 Error handler set up');

        // Check VSCode API
        let vsCodeApi = null;
        try {
            if (typeof acquireVsCodeApi !== 'undefined') {
                vsCodeApi = acquireVsCodeApi();
                console.log('📡 VSCode API acquired successfully');
                window.vsCodeApi = vsCodeApi;
            } else {
                console.error('❌ acquireVsCodeApi not found');
                document.getElementById('result').innerHTML = '<div style="color: red;">VSCode API not available</div>';
            }
        } catch (error) {
            console.error('❌ Error acquiring VSCode API:', error);
            document.getElementById('result').innerHTML = '<div style="color: red;">Error acquiring VSCode API: ' + error.message + '</div>';
        }

        // Test connection function
        function testConnectionFunction() {
            console.log('✅ Test connection called!');
            alert('Test connection works!' + String.fromCharCode(10) + 'VSCode API: ' + (vsCodeApi ? 'Available' : 'Not Available'));
        }

        // JSON formatting function
        function formatJson(textareaId) {
            const textarea = document.getElementById(textareaId);
            try {
                const parsed = JSON.parse(textarea.value);
                textarea.value = JSON.stringify(parsed, null, 2);
                console.log('✅ JSON formatted for:', textareaId);
            } catch (error) {
                alert('Invalid JSON format: ' + error.message);
                console.error('❌ JSON format error:', error);
            }
        }

        // Format response JSON
        function formatResponseJson(containerId) {
            const container = document.getElementById(containerId);
            const pre = container.querySelector('pre');
            if (pre) {
                try {
                    const parsed = JSON.parse(pre.textContent);
                    pre.textContent = JSON.stringify(parsed, null, 2);
                    console.log('✅ Response JSON formatted');
                } catch (error) {
                    alert('Cannot format response: ' + error.message);
                }
            }
        }

        // Test API function
        function testApiFunction() {
            console.log('🚀 Test API called!');

            if (!vsCodeApi) {
                alert('VSCode API not available!');
                return;
            }

            const fullUrl = document.getElementById('fullUrl').value;
            const headersText = document.getElementById('headers').value;
            const bodyElement = document.getElementById('requestBody');
            const bodyText = bodyElement ? bodyElement.value : null;

            console.log('📝 Form data:', { fullUrl, headersText, bodyText });

            try {
                const headers = JSON.parse(headersText);
                let body = null;
                if (bodyText) {
                    body = JSON.parse(bodyText);
                }

                const requestData = {
                    method: '${endpointMethod}',
                    url: fullUrl,
                    headers: headers,
                    body: body
                };

                console.log('📤 Sending to backend:', requestData);

                document.getElementById('result').innerHTML = '<div>🚀 Testing API...</div>';

                vsCodeApi.postMessage({
                    type: 'testApi',
                    data: requestData
                });

                console.log('✅ Message sent successfully');
            } catch (error) {
                console.error('❌ Error:', error);
                document.getElementById('result').innerHTML = '<div style="color: red;">Error: ' + error.message + '</div>';
            }
        }

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('📨 Received message:', message);

            if (message.type === 'testResult') {
                displayTestResult(message.result);
            }
        });

        function displayTestResult(result) {
            console.log('📊 Displaying test result:', result);

            const resultDiv = document.getElementById('result');
            const statusClass = result.success ? 'success' : 'error';
            const statusIcon = result.success ? '✅' : '❌';

            let html = '<div class="response-container">';

            // Status section
            html += '<div class="response-status ' + statusClass + '">';
            html += '<div style="display: flex; justify-content: space-between; align-items: center;">';
            html += '<div>';
            html += '<h3 style="margin: 0 0 8px 0;">' + statusIcon + ' Response Status</h3>';
            html += '<div><strong>Status:</strong> ' + result.status + ' ' + result.statusText + '</div>';
            if (result.duration) {
                html += '<div><strong>Duration:</strong> ' + result.duration + 'ms</div>';
            }
            if (result.requestConfig) {
                html += '<div><strong>Request:</strong> ' + result.requestConfig.method + ' ' + result.requestConfig.url + '</div>';
            }
            html += '</div>';
            html += '</div>';
            if (result.error) {
                html += '<div style="margin-top: 10px; color: #F44336;"><strong>Error:</strong> ' + result.error + '</div>';
            }
            html += '</div>';

            // Content section with tabs
            if (result.data !== null && result.data !== undefined) {
                html += '<div class="response-content">';
                html += '<div class="response-tabs">';
                html += '<button class="response-tab active" onclick="showResponseTab(\\'response\\')">Response Body</button>';
                html += '<button class="response-tab" onclick="showResponseTab(\\'headers\\')">Headers</button>';
                html += '</div>';

                // Response body tab
                html += '<div id="response-tab" class="response-tab-content active">';
                html += '<button class="format-response-button" onclick="formatResponseJson(\\'response-tab\\')">Format JSON</button>';
                html += '<pre id="response-data">';
                if (typeof result.data === 'string') {
                    html += result.data;
                } else {
                    html += JSON.stringify(result.data, null, 2);
                }
                html += '</pre>';
                html += '</div>';

                // Headers tab
                html += '<div id="headers-tab" class="response-tab-content">';
                html += '<button class="format-response-button" onclick="formatResponseJson(\\'headers-tab\\')">Format JSON</button>';
                if (result.headers && Object.keys(result.headers).length > 0) {
                    html += '<pre>' + JSON.stringify(result.headers, null, 2) + '</pre>';
                } else {
                    html += '<div style="color: var(--vscode-descriptionForeground); font-style: italic; padding: 10px;">No headers received</div>';
                }
                html += '</div>';

                html += '</div>';
            } else {
                html += '<div class="response-content" style="padding: 15px; text-align: center; color: var(--vscode-descriptionForeground);">';
                html += 'No response body received';
                html += '</div>';
            }

            html += '</div>';
            resultDiv.innerHTML = html;
        }

        function showResponseTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.response-tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.response-tab').forEach(tab => {
                tab.classList.remove('active');
            });

            // Show selected tab
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }

        console.log('🔧 Script loaded completely');
    </script>
</body>
</html>`;
    }

    public dispose() {
        ApiTestPanel.currentPanel = undefined;

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