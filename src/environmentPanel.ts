import * as vscode from 'vscode';
import { EnvironmentManager } from './environmentManager';

export class EnvironmentPanel {
    public static currentPanel: EnvironmentPanel | undefined;
    public static readonly viewType = 'environmentManager';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.One
            : undefined;

        // If we already have a panel, show it.
        if (EnvironmentPanel.currentPanel) {
            EnvironmentPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            EnvironmentPanel.viewType,
            'Environment Manager',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );

        EnvironmentPanel.currentPanel = new EnvironmentPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'loadEnvironments':
                        this._loadEnvironments();
                        return;
                    case 'saveEnvironment':
                        this._saveEnvironment(message.environment);
                        return;
                    case 'deleteEnvironment':
                        this._deleteEnvironment(message.name);
                        return;
                    case 'setCurrentEnvironment':
                        this._setCurrentEnvironment(message.name);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private async _loadEnvironments() {
        const manager = EnvironmentManager.getInstance();
        const environments = manager.getAllEnvironments();
        const currentEnv = manager.getCurrentEnvironment();

        this._panel.webview.postMessage({
            command: 'environmentsLoaded',
            environments: environments,
            currentEnvironment: currentEnv?.name
        });
    }

    private async _saveEnvironment(environment: any) {
        const manager = EnvironmentManager.getInstance();
        try {
            if (environment.isNew) {
                await manager.addEnvironment({
                    name: environment.name,
                    baseUrl: environment.baseUrl,
                    basePath: environment.basePath,
                    headers: environment.headers,
                    customVariables: environment.customVariables,
                    active: false
                });
            } else {
                await manager.updateEnvironment(environment.originalName, {
                    name: environment.name,
                    baseUrl: environment.baseUrl,
                    basePath: environment.basePath,
                    headers: environment.headers,
                    customVariables: environment.customVariables
                });
            }

            this._panel.webview.postMessage({
                command: 'saveResult',
                success: true,
                message: `Environment ${environment.isNew ? 'created' : 'updated'} successfully!`
            });

            // Reload environments
            this._loadEnvironments();
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'saveResult',
                success: false,
                message: `Failed to save environment: ${error}`
            });
        }
    }

    private async _deleteEnvironment(name: string) {
        const manager = EnvironmentManager.getInstance();
        try {
            await manager.deleteEnvironment(name);
            this._panel.webview.postMessage({
                command: 'deleteResult',
                success: true,
                message: `Environment '${name}' deleted successfully!`
            });

            // Reload environments
            this._loadEnvironments();
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'deleteResult',
                success: false,
                message: `Failed to delete environment: ${error}`
            });
        }
    }

    private async _setCurrentEnvironment(name: string) {
        const manager = EnvironmentManager.getInstance();
        const success = await manager.setCurrentEnvironment(name);

        this._panel.webview.postMessage({
            command: 'setCurrentResult',
            success: success,
            message: success ? `Switched to environment '${name}'` : `Failed to switch to '${name}'`
        });

        if (success) {
            this._loadEnvironments();
        }
    }

    public dispose() {
        EnvironmentPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Environment Manager</title>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }

        .container {
            max-width: 1000px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 3px;
            margin-right: 10px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-primary {
            background-color: var(--vscode-button-background);
        }

        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: white;
        }

        .btn-success {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }

        .environment-list {
            margin-bottom: 20px;
        }

        .environment-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 10px;
            position: relative;
        }

        .environment-card.current {
            border-color: var(--vscode-button-background);
            background: var(--vscode-list-hoverBackground);
        }

        .environment-name {
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 5px;
        }

        .environment-details {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 10px;
        }

        .environment-actions {
            display: flex;
            gap: 10px;
        }

        .form-section {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            padding: 20px;
            margin-top: 20px;
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }

        .form-group input, .form-group textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            box-sizing: border-box;
        }

        .form-group textarea {
            height: 100px;
            resize: vertical;
            font-family: monospace;
        }

        .variables-section {
            margin-top: 15px;
        }

        .variable-item {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            align-items: center;
        }

        .variable-item input {
            flex: 1;
        }

        .variable-remove {
            background: var(--vscode-errorForeground);
            color: white;
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            border-radius: 3px;
        }

        .hidden {
            display: none !important;
        }

        .message {
            padding: 10px;
            border-radius: 3px;
            margin-bottom: 15px;
        }

        .message.success {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }

        .message.error {
            background: var(--vscode-errorForeground);
            color: white;
        }

        .current-badge {
            position: absolute;
            top: 10px;
            right: 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Environment Manager</h1>
            <button class="btn btn-primary" onclick="showAddForm()">+ Add New Environment</button>
        </div>

        <div id="message-container"></div>

        <div class="environment-list">
            <h2>Environments</h2>
            <div id="environments-container">
                Loading environments...
            </div>
        </div>

        <div id="form-section" class="form-section hidden">
            <h3 id="form-title">Add New Environment</h3>
            <form id="environment-form">
                <div class="form-group">
                    <label for="env-name">Environment Name *</label>
                    <input type="text" id="env-name" required placeholder="e.g., Development, Staging, Production">
                </div>

                <div class="form-group">
                    <label for="env-baseurl">Base URL *</label>
                    <input type="text" id="env-baseurl" required placeholder="e.g., http://localhost:5000">
                </div>

                <div class="form-group">
                    <label for="env-basepath">Base Path</label>
                    <input type="text" id="env-basepath" placeholder="e.g., /api">
                </div>

                <div class="form-group">
                    <label for="env-headers">Headers (JSON)</label>
                    <textarea id="env-headers" placeholder='{}'></textarea>
                </div>

                <div class="variables-section">
                    <h4>Custom Variables</h4>
                    <div id="variables-container">
                        <!-- Variables will be added dynamically -->
                    </div>
                    <button type="button" class="btn" onclick="addVariable()">+ Add Variable</button>
                </div>

                <div style="margin-top: 20px;">
                    <button type="submit" class="btn btn-success">Save Environment</button>
                    <button type="button" class="btn" onclick="cancelForm()">Cancel</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let environments = [];
        let currentEnvironment = null;
        let editingEnvironment = null;

        // Load environments on startup
        window.addEventListener('load', () => {
            vscode.postMessage({ command: 'loadEnvironments' });
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'environmentsLoaded':
                    environments = message.environments;
                    currentEnvironment = message.currentEnvironment;
                    renderEnvironments();
                    break;
                case 'saveResult':
                    showMessage(message.message, message.success ? 'success' : 'error');
                    if (message.success) {
                        cancelForm();
                    }
                    break;
                case 'deleteResult':
                    showMessage(message.message, message.success ? 'success' : 'error');
                    break;
                case 'setCurrentResult':
                    showMessage(message.message, message.success ? 'success' : 'error');
                    break;
            }
        });

        function renderEnvironments() {
            const container = document.getElementById('environments-container');
            if (environments.length === 0) {
                container.innerHTML = '<p>No environments configured. Click "Add New Environment" to create your first one.</p>';
                return;
            }

            container.innerHTML = environments.map(env => \`
                <div class="environment-card \${env.name === currentEnvironment ? 'current' : ''}">
                    \${env.name === currentEnvironment ? '<div class="current-badge">Current</div>' : ''}
                    <div class="environment-name">\${env.name}</div>
                    <div class="environment-details">
                        <div><strong>URL:</strong> \${env.baseUrl}\${env.basePath || ''}</div>
                        <div><strong>Headers:</strong> \${Object.keys(env.headers || {}).length} configured</div>
                        <div><strong>Variables:</strong> \${Object.keys(env.customVariables || {}).length} configured</div>
                    </div>
                    <div class="environment-actions">
                        \${env.name !== currentEnvironment ? \`<button class="btn btn-success" onclick="setCurrentEnvironment('\${env.name}')">Set Current</button>\` : ''}
                        <button class="btn" onclick="editEnvironment('\${env.name}')">Edit</button>
                        <button class="btn btn-danger" onclick="deleteEnvironment('\${env.name}')">Delete</button>
                    </div>
                </div>
            \`).join('');
        }

        function showAddForm() {
            editingEnvironment = null;
            document.getElementById('form-title').textContent = 'Add New Environment';
            document.getElementById('environment-form').reset();
            document.getElementById('env-headers').value = '{}';
            document.getElementById('variables-container').innerHTML = '';
            document.getElementById('form-section').classList.remove('hidden');
        }

        function editEnvironment(name) {
            const env = environments.find(e => e.name === name);
            if (!env) return;

            editingEnvironment = env;
            document.getElementById('form-title').textContent = \`Edit Environment: \${name}\`;
            document.getElementById('env-name').value = env.name;
            document.getElementById('env-baseurl').value = env.baseUrl;
            document.getElementById('env-basepath').value = env.basePath || '';
            document.getElementById('env-headers').value = JSON.stringify(env.headers || {}, null, 2);

            // Load custom variables
            const variablesContainer = document.getElementById('variables-container');
            variablesContainer.innerHTML = '';
            if (env.customVariables) {
                Object.entries(env.customVariables).forEach(([key, value]) => {
                    addVariable(key, value);
                });
            }

            document.getElementById('form-section').classList.remove('hidden');
        }

        function cancelForm() {
            document.getElementById('form-section').classList.add('hidden');
            editingEnvironment = null;
        }

        function addVariable(key = '', value = '') {
            const container = document.getElementById('variables-container');
            const variableDiv = document.createElement('div');
            variableDiv.className = 'variable-item';
            variableDiv.innerHTML = \`
                <input type="text" placeholder="Variable name (e.g., API_VERSION)" value="\${key}">
                <input type="text" placeholder="Value (e.g., v1)" value="\${value}">
                <button type="button" class="variable-remove" onclick="this.parentElement.remove()">Remove</button>
            \`;
            container.appendChild(variableDiv);
        }

        function setCurrentEnvironment(name) {
            vscode.postMessage({ command: 'setCurrentEnvironment', name: name });
        }

        function deleteEnvironment(name) {
            if (confirm(\`Are you sure you want to delete environment '\${name}'?\`)) {
                vscode.postMessage({ command: 'deleteEnvironment', name: name });
            }
        }

        function showMessage(text, type) {
            const container = document.getElementById('message-container');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}\`;
            messageDiv.textContent = text;
            container.appendChild(messageDiv);

            setTimeout(() => {
                messageDiv.remove();
            }, 5000);
        }

        document.getElementById('environment-form').addEventListener('submit', (e) => {
            e.preventDefault();

            const name = document.getElementById('env-name').value.trim();
            const baseUrl = document.getElementById('env-baseurl').value.trim();
            const basePath = document.getElementById('env-basepath').value.trim();
            const headersText = document.getElementById('env-headers').value.trim();

            if (!name || !baseUrl) {
                showMessage('Name and Base URL are required', 'error');
                return;
            }

            let headers = {};
            if (headersText) {
                try {
                    headers = JSON.parse(headersText);
                } catch (error) {
                    showMessage('Invalid JSON format in headers', 'error');
                    return;
                }
            }

            // Collect custom variables
            const customVariables = {};
            const variableItems = document.querySelectorAll('.variable-item');
            variableItems.forEach(item => {
                const inputs = item.querySelectorAll('input');
                const key = inputs[0].value.trim();
                const value = inputs[1].value.trim();
                if (key) {
                    customVariables[key] = value;
                }
            });

            const environment = {
                name: name,
                baseUrl: baseUrl,
                basePath: basePath,
                headers: headers,
                customVariables: customVariables,
                isNew: !editingEnvironment,
                originalName: editingEnvironment ? editingEnvironment.name : name
            };

            vscode.postMessage({ command: 'saveEnvironment', environment: environment });
        });
    </script>
</body>
</html>`;
    }
}
