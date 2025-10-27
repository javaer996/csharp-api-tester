import * as vscode from 'vscode';
import { ApiEndpointInfo } from './apiEndpointDetector';
import { ApiRequestGenerator, GeneratedRequest } from './apiRequestGenerator';
import { EnvironmentManager, Environment } from './environmentManager';
import { AIService } from './aiService';
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
    private _aiService: AIService;
    private _panelKey: string;
    private _lastAIConversation: any | null = null; // Store conversation for this panel

    private _parsingCancelled: boolean = false;
    private _sourceDocument: vscode.TextDocument | undefined;

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
        this._aiService = AIService.getInstance();

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
                        case 'generateWithAI':
                            console.log(`[ApiTestPanel] 🤖 Processing AI generation`);
                            await this.generateWithAI(message.data);
                            break;
                        case 'openSettings':
                            console.log(`[ApiTestPanel] ⚙️ Processing openSettings`);
                            await this.openSettings();
                            break;
                        case 'viewAIConversation':
                            console.log(`[ApiTestPanel] 💬 Processing viewAIConversation`);
                            await this.viewAIConversation();
                            break;
                        case 'restoreOriginalJson':
                            console.log(`[ApiTestPanel] 🔄 Processing restoreOriginalJson`);
                            this.restoreOriginalJson();
                            break;
                        case 'cancelParsing':
                            console.log(`[ApiTestPanel] ❌ Processing cancelParsing`);
                            this.cancelParsing();
                            break;
                        case 'reparseBodyParams':
                            console.log(`[ApiTestPanel] 🔄 Processing reparseBodyParams`);
                            await this.reparseBodyParameters();
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

    private async updateContent() {
        if (!this._currentEndpoint) {
            this._panel.webview.html = this.getWelcomeHtml();
            return;
        }

        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        if (!currentEnvironment) {
            this._panel.webview.html = this.getNoEnvironmentHtml();
            return;
        }

        // 保存当前的 document 供后续解析使用
        this._sourceDocument = vscode.window.activeTextEditor?.document;

        const fullBaseUrl = currentEnvironment.baseUrl;
        const fullHeaders = currentEnvironment.headers;

        // Generate initial request (may not have full class properties yet)
        const generatedRequest = this._requestGenerator.generateRequestForEnvironment(this._currentEndpoint, currentEnvironment);

        // Render complete UI immediately (no full-screen loading)
        this._panel.webview.html = this.getTestPanelHtml(this._currentEndpoint, generatedRequest, fullHeaders, currentEnvironment);

        // ⚡ LAZY LOADING: Parse class definitions in background
        // This dramatically improves CodeLens performance
        // Body tab will show parsing status, not blocking other operations
        this.parseEndpointClassDefinitionsInBackground();
    }

    /**
     * ⚡ Parse class definitions in background (non-blocking)
     * @param force - Force reparsing even if properties already exist
     */
    private async parseEndpointClassDefinitionsInBackground(force: boolean = false) {
        if (!this._currentEndpoint) return;

        // Reset cancellation flag
        this._parsingCancelled = false;

        // Check if there are body/form parameters that need parsing
        if (!force) {
            const needsParsing = this._currentEndpoint.parameters.some(p =>
                (p.source === 'body' || p.source === 'form') &&
                (!p.properties || p.properties.length === 0)
            );

            if (!needsParsing) {
                console.log('[ApiTestPanel] ⚡ No parsing needed, all parameters already parsed');
                return;
            }
        } else {
            console.log('[ApiTestPanel] 🔄 Force reparsing requested');
        }

        console.log('[ApiTestPanel] ⚡ Starting background parsing...');

        // Send initial parsing status to webview
        this._panel.webview.postMessage({
            type: 'parsingStarted',
            message: '正在解析参数类型...'
        });

        // 使用保存的 document 而不是 activeTextEditor.document
        const document = this._sourceDocument;
        if (!document) {
            console.log('[ApiTestPanel] ⚠️ No source document available');
            this._panel.webview.postMessage({
                type: 'parsingFailed',
                message: '无法获取源文件，请重新打开测试面板'
            });
            return;
        }

        // Get class parser from detector
        const detector = new (require('./apiEndpointDetector').ApiEndpointDetector)();
        const classParser = detector.getClassParser();

        // Track parsed classes to avoid infinite recursion
        const parsedClasses = new Set<string>();

        for (const param of this._currentEndpoint.parameters) {
            // Check cancellation
            if (this._parsingCancelled) {
                console.log('[ApiTestPanel] ❌ Parsing cancelled by user');
                this._panel.webview.postMessage({
                    type: 'parsingCancelled',
                    message: '解析已取消'
                });
                return;
            }

            // Only parse if it's a body/form parameter
            if ((param.source === 'body' || param.source === 'form')) {
                // Send progress update
                this._panel.webview.postMessage({
                    type: 'parsingStatus',
                    message: `⚡ 正在解析 ${param.type}...`
                });

                // Parse recursively
                console.log(`[ApiTestPanel] 📦 Parsing ${param.type}...`);
                await this.parseClassRecursively(param.type, param, document, classParser, parsedClasses);
            }
        }

        console.log('[ApiTestPanel] ✅ Class definitions parsing complete');

        // Check if parsing was cancelled
        if (this._parsingCancelled) {
            console.log('[ApiTestPanel] 🚫 Parsing was cancelled, skip completion logic');
            return;
        }

        // Check if parsing was successful (any parameter has valid properties)
        let hasValidProperties = false;
        for (const param of this._currentEndpoint.parameters) {
            if ((param.source === 'body' || param.source === 'form') &&
                param.properties && param.properties.length > 0) {
                hasValidProperties = true;
                break;
            }
        }

        // Regenerate request body with parsed properties
        const currentEnvironment = this._environmentManager.getCurrentEnvironment();
        if (currentEnvironment) {
            const updatedRequest = this._requestGenerator.generateRequestForEnvironment(this._currentEndpoint, currentEnvironment);

            if (!hasValidProperties || !updatedRequest.body) {
                // 解析失败或无法生成 body
                console.log('[ApiTestPanel] ⚠️ Parsing failed or no valid body generated');
                this._panel.webview.postMessage({
                    type: 'parsingFailed',
                    message: '无法解析参数类型定义,请手动编写请求体'
                });
            } else {
                // Send updated body to webview
                this._panel.webview.postMessage({
                    type: 'updateBodyContent',
                    body: updatedRequest.body ? JSON.stringify(updatedRequest.body, null, 2) : null
                });

                // Send completion message to webview
                this._panel.webview.postMessage({
                    type: 'parsingComplete',
                    message: '参数解析完成!'
                });
            }
        }
    }

    /**
     * Recursively parse class definitions and nested classes
     */
    private async parseClassRecursively(
        className: string,
        target: any,
        document: vscode.TextDocument,
        classParser: any,
        parsedClasses: Set<string>
    ): Promise<void> {
        // Check cancellation at the start
        if (this._parsingCancelled) {
            console.log('[ApiTestPanel] 🚫 Parsing cancelled, skip recursion');
            return;
        }

        // Avoid infinite recursion
        if (parsedClasses.has(className)) {
            return;
        }

        // Check if it's a simple type
        const isSimpleType = ['string', 'int', 'long', 'short', 'byte', 'bool', 'DateTime', 'DateTimeOffset', 'Guid', 'decimal', 'double', 'float'].includes(className);
        if (isSimpleType) {
            return;
        }

        console.log(`[ApiTestPanel] 📦 Parsing class: ${className}`);

        try {
            // Parse class properties
            const properties = await classParser.parseClassDefinitionFromWorkspace(className, document);

            // Check cancellation after async operation
            if (this._parsingCancelled) {
                console.log('[ApiTestPanel] 🚫 Parsing cancelled after parsing class definition');
                return;
            }

            if (properties && properties.length > 0) {
                target.properties = properties;

                // Add to parsed set only after successful parsing
                parsedClasses.add(className);

                console.log(`[ApiTestPanel] ✅ Found ${properties.length} properties for ${className}`);

                // Recursively parse nested complex types
                for (const prop of properties) {
                    // Check cancellation during recursion
                    if (this._parsingCancelled) {
                        console.log('[ApiTestPanel] 🚫 Parsing cancelled during property recursion');
                        return;
                    }

                    const propType = this.extractBaseType(prop.type);
                    const isComplexType = !this.isSimpleType(propType);

                    if (isComplexType && !parsedClasses.has(propType)) {
                        console.log(`[ApiTestPanel] 🔄 Found nested class: ${propType} in property ${prop.name}`);

                        // Ensure properties object exists for nested types
                        if (!prop.properties) {
                            await this.parseClassRecursively(propType, prop, document, classParser, parsedClasses);
                        }
                    }
                }
            } else {
                console.log(`[ApiTestPanel] ⚠️ No properties found for ${className}, will retry on next parse`);
            }

            // Get full class definition for AI context
            const classDefinition = await classParser.getClassDefinitionTextFromWorkspace(className, document);
            if (classDefinition) {
                target.classDefinition = classDefinition;
            }
        } catch (error) {
            console.error(`[ApiTestPanel] ❌ Failed to parse ${className}:`, error);
        }
    }

    /**
     * Extract base type from generic types (List<T>, IEnumerable<T>, etc.)
     */
    private extractBaseType(type: string): string {
        // Handle array types: User[] -> User
        if (type.endsWith('[]')) {
            return type.slice(0, -2);
        }

        // Handle generic types: List<User> -> User
        const genericMatch = type.match(/<(.+)>/);
        if (genericMatch) {
            return genericMatch[1].trim();
        }

        // Handle nullable types: User? -> User
        if (type.endsWith('?')) {
            return type.slice(0, -1);
        }

        return type;
    }

    /**
     * Check if a type is a simple/primitive type
     */
    private isSimpleType(type: string): boolean {
        const simpleTypes = [
            'string', 'int', 'long', 'short', 'byte',
            'uint', 'ulong', 'ushort', 'sbyte',
            'double', 'float', 'decimal',
            'bool', 'DateTime', 'DateTimeOffset',
            'Guid', 'char', 'object'
        ];

        const baseType = type.replace('?', '').replace('[]', '');
        return simpleTypes.includes(baseType);
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
            const config: any = {
                method: requestData.method,
                url: requestData.url,
                headers: { ...requestData.headers },
                timeout: vscode.workspace.getConfiguration('csharpApiTester').get<number>('timeout', 30000)
            };

            // Handle form data or body
            if (requestData.formData && Object.keys(requestData.formData).length > 0) {
                // For form data, we need to build a proper form-data payload
                // Note: File uploads are represented as [FILE] placeholders
                const FormData = require('form-data');
                const formDataPayload = new FormData();

                for (const [key, value] of Object.entries(requestData.formData)) {
                    if (value === '[FILE]') {
                        // Skip file placeholders for now (would need actual file content)
                        console.warn(`[ApiTestPanel] File field '${key}' skipped - no file selected`);
                    } else {
                        formDataPayload.append(key, value);
                    }
                }

                config.data = formDataPayload;
                // Let form-data set the content-type with boundary
                config.headers = {
                    ...config.headers,
                    ...formDataPayload.getHeaders()
                };
            } else if (['POST', 'PUT', 'PATCH'].includes(requestData.method) && requestData.body) {
                config.data = requestData.body;
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

    private async generateWithAI(data: { jsonTemplate: string }): Promise<void> {
        if (!this._currentEndpoint) {
            this._panel.webview.postMessage({
                type: 'aiGenerationResult',
                result: {
                    success: false,
                    error: 'No endpoint information available'
                }
            });
            return;
        }

        try {
            // Check if AI is configured
            if (!this._aiService.isConfigured()) {
                this._panel.webview.postMessage({
                    type: 'aiGenerationResult',
                    result: {
                        success: false,
                        error: 'AI is not configured. Please configure AI settings first.'
                    }
                });
                return;
            }

            console.log('[ApiTestPanel] Generating JSON with AI...');
            console.log('[ApiTestPanel] Template:', data.jsonTemplate);

            // Build rich API context
            const apiContext: any = {
                method: this._currentEndpoint.method,
                route: this._currentEndpoint.route,
                methodSignature: `${this._currentEndpoint.returnType} ${this._currentEndpoint.methodName}`,
                returnType: this._currentEndpoint.returnType,
                parameters: this._currentEndpoint.parameters.map(p =>
                    `${p.type} ${p.name}${p.source === 'body' ? ' [FromBody]' : p.source === 'query' ? ' [FromQuery]' : ''}`
                ),
                comments: [],
                classProperties: [],
                classDefinitions: []  // New: full class definitions
            };

            // Add class properties and definitions if available (for body parameters)
            const bodyParam = this._currentEndpoint.parameters.find(p => p.source === 'body');
            if (bodyParam) {
                if (bodyParam.properties) {
                    apiContext.classProperties = bodyParam.properties;
                }
                if (bodyParam.classDefinition) {
                    apiContext.classDefinitions.push({
                        className: bodyParam.type,
                        definition: bodyParam.classDefinition
                    });
                }
            }

            // Generate with AI
            const generatedJson = await this._aiService.generateSmartJson(
                data.jsonTemplate || null,
                apiContext
            );

            console.log('[ApiTestPanel] AI generated:', generatedJson);

            // Store conversation for this panel
            const globalConversation = this._aiService.getLastConversation();
            if (globalConversation) {
                this._lastAIConversation = {
                    systemPrompt: globalConversation.systemPrompt,
                    userPrompt: globalConversation.userPrompt,
                    aiResponse: globalConversation.aiResponse,
                    timestamp: globalConversation.timestamp
                };
            }

            // Send result back to webview
            this._panel.webview.postMessage({
                type: 'aiGenerationResult',
                result: {
                    success: true,
                    data: generatedJson
                }
            });

        } catch (error: any) {
            console.error('[ApiTestPanel] AI generation failed:', error);
            this._panel.webview.postMessage({
                type: 'aiGenerationResult',
                result: {
                    success: false,
                    error: error.message || 'AI generation failed'
                }
            });
        }
    }

    private async openSettings(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'csharpApiTester');
    }

    private async viewAIConversation(): Promise<void> {
        // Use this panel's stored conversation instead of global
        const conversation = this._lastAIConversation;

        if (!conversation) {
            this._panel.webview.postMessage({
                type: 'aiConversationData',
                conversation: null
            });
            return;
        }

        // Send conversation data to webview
        this._panel.webview.postMessage({
            type: 'aiConversationData',
            conversation: {
                systemPrompt: conversation.systemPrompt,
                userPrompt: conversation.userPrompt,
                aiResponse: conversation.aiResponse,
                timestamp: conversation.timestamp
            }
        });
    }

    private restoreOriginalJson(): void {
        // Send message to webview to restore original JSON
        this._panel.webview.postMessage({
            type: 'restoreOriginalJsonData'
        });
    }

    private cancelParsing(): void {
        console.log('[ApiTestPanel] Setting cancellation flag...');
        this._parsingCancelled = true;
    }

    private async reparseBodyParameters(): Promise<void> {
        if (!this._currentEndpoint) {
            console.log('[ApiTestPanel] No endpoint, cannot reparse');
            return;
        }

        console.log('[ApiTestPanel] 🔄 Starting reparsing...');

        // 清空 body/form 参数的 properties 缓存
        for (const param of this._currentEndpoint.parameters) {
            if (param.source === 'body' || param.source === 'form') {
                console.log(`[ApiTestPanel] Clearing properties cache for ${param.type}`);
                param.properties = undefined;
                param.classDefinition = undefined;
            }
        }

        // 重新触发后台解析(强制解析)
        await this.parseEndpointClassDefinitionsInBackground(true);
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
        // Check if endpoint has body parameter (regardless of whether it's parsed yet)
        const hasBodyParam = endpoint.parameters.some(p => p.source === 'body');

        // Prepare data for JavaScript injection
        const endpointMethod = endpoint.method;
        const endpointRoute = endpoint.route;

        // Parse query params from the generated request
        const queryParamsJson = JSON.stringify(request.queryParams);
        const headersJson = JSON.stringify(request.headers);
        const bodyJson = request.body ? JSON.stringify(request.body, null, 2) : '';
        const formDataJson = request.formData ? JSON.stringify(request.formData) : '';
        const hasFormData = !!request.formData;

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

        .settings-button {
            padding: 10px 15px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.2s;
            flex-shrink: 0;
        }

        .settings-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
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
            position: relative;
            display: flex;
            flex-direction: column;
        }

        .body-editor-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 10px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-input-border);
            border-bottom: none;
            border-radius: 4px 4px 0 0;
        }

        .body-editor-toolbar-left {
            display: flex;
            gap: 6px;
        }

        .body-editor-toolbar-right {
            display: flex;
            gap: 6px;
        }

        .body-editor textarea {
            width: 100%;
            flex: 1;
            padding: 15px;
            border: 1px solid var(--vscode-input-border);
            border-top: none;
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-editor-foreground);
            border-radius: 0 0 4px 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            resize: vertical;
            line-height: 1.5;
        }

        .body-editor textarea:focus {
            outline: none;
            border-color: #49CC90;
        }

        /* JSON Syntax Highlighting */
        .json-key { color: #9CDCFE; }
        .json-string { color: #CE9178; }
        .json-number { color: #B5CEA8; }
        .json-boolean { color: #569CD6; }
        .json-null { color: #569CD6; }

        .format-button, .ai-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 10px;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .format-button:hover, .ai-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .ai-button {
            background: #9b59b6;
            color: white;
            font-weight: 500;
        }

        .ai-button:hover {
            background: #8e44ad;
        }

        .ai-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .view-conversation-button {
            background: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-button-border);
            padding: 4px 10px;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            opacity: 0.8;
        }

        .view-conversation-button:hover {
            opacity: 1;
            background: var(--vscode-button-secondaryBackground);
        }

        .restore-button {
            background: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-button-border);
            padding: 4px 10px;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            opacity: 0.8;
        }

        .restore-button:hover {
            opacity: 1;
            background: var(--vscode-button-secondaryBackground);
        }

        /* Modal Dialog */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 9999;
            justify-content: center;
            align-items: center;
        }

        .modal-overlay.visible {
            display: flex;
        }

        .modal-content {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            width: 80%;
            max-width: 800px;
            max-height: 80%;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }

        .modal-header {
            padding: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modal-header h2 {
            margin: 0;
            color: var(--vscode-foreground);
            font-size: 18px;
        }

        .modal-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
        }

        .modal-close:hover {
            opacity: 1;
        }

        .modal-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }

        .conversation-section {
            margin-bottom: 25px;
        }

        .conversation-section h3 {
            color: #49CC90;
            font-size: 14px;
            margin-bottom: 10px;
            font-weight: 600;
        }

        .conversation-section pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .conversation-timestamp {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-bottom: 15px;
        }

        /* Value Editor Modal */
        .value-editor-modal {
            width: 90%;
            max-width: 600px;
        }

        .value-editor-modal textarea {
            width: 100%;
            min-height: 200px;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            resize: vertical;
            border-radius: 4px;
        }

        .value-editor-modal textarea:focus {
            outline: none;
            border-color: #49CC90;
        }

        .value-editor-actions {
            margin-top: 15px;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }

        .value-editor-actions button {
            padding: 6px 16px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        .value-editor-save {
            background: #49CC90;
            color: white;
        }

        .value-editor-save:hover {
            background: #3DB87C;
        }

        .value-editor-cancel {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .value-editor-cancel:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .expand-icon {
            cursor: pointer;
            opacity: 0.6;
            transition: opacity 0.2s;
            font-size: 14px;
            margin-left: 4px;
        }

        .expand-icon:hover {
            opacity: 1;
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

        /* Notification Animations */
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
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
            <button class="settings-button" onclick="openSettings()" title="Settings">⚙️</button>
        </div>

        <!-- Request Tabs -->
        <div class="tabs-container">
            <div class="tab-nav">
                <button class="tab-button ${!hasBodyParam && !hasFormData && Object.keys(request.queryParams).length > 0 ? 'active' : ''}" onclick="switchTab('query')">Query</button>
                <button class="tab-button ${!hasBodyParam && !hasFormData && Object.keys(request.queryParams).length === 0 ? 'active' : ''}" onclick="switchTab('headers')">Headers</button>
                ${hasBodyParam ? '<button class="tab-button active" onclick="switchTab(\'body\')">Body</button>' : ''}
                ${hasFormData ? '<button class="tab-button active" onclick="switchTab(\'form\')">Form</button>' : ''}
            </div>

            <!-- Query Tab -->
            <div class="tab-content ${!hasBodyParam && !hasFormData && Object.keys(request.queryParams).length > 0 ? 'active' : ''}" id="query-tab">
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
            <div class="tab-content ${Object.keys(request.queryParams).length === 0 && !hasBodyParam && !hasFormData ? 'active' : ''}" id="headers-tab">
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

            ${hasBodyParam ? `
            <!-- Body Tab -->
            <div class="tab-content active" id="body-tab">
                <div class="body-editor">
                    <!-- Parsing Status Overlay (覆盖在 textarea 上) -->
                    <div id="body-parsing-overlay" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.75); z-index: 100; align-items: center; justify-content: center;">
                        <div style="background: var(--vscode-editor-background); padding: 30px 40px; border-radius: 6px; text-align: center; min-width: 300px; border: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
                            <div class="loading-spinner" style="border: 3px solid var(--vscode-editor-inactiveSelectionBackground); border-top: 3px solid #49CC90; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
                            <div id="body-parsing-text" style="font-size: 14px; color: var(--vscode-foreground); margin-bottom: 20px; line-height: 1.5;">正在解析参数...</div>
                            <button id="body-parsing-cancel-btn" style="padding: 8px 20px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; transition: background 0.2s;">取消解析</button>
                        </div>
                    </div>

                    <div class="body-editor-toolbar">
                        <div class="body-editor-toolbar-left">
                            <button class="restore-button" onclick="restoreOriginalJson()" title="Restore Original JSON">↺ Restore</button>
                            <button class="format-button" onclick="reparseBodyParams()" title="重新解析参数" id="reparse-btn">🔄 重新解析</button>
                            <button class="view-conversation-button" onclick="viewAIConversation()" title="View AI Conversation">💬 View AI</button>
                        </div>
                        <div class="body-editor-toolbar-right">
                            <button class="format-button" onclick="formatBodyJson()" title="Format JSON">{ } Format</button>
                            <button class="ai-button" onclick="generateWithAI()" id="ai-button" title="AI Smart Generation">🤖 AI Generate</button>
                        </div>
                    </div>
                    <textarea id="request-body">${bodyJson || ''}</textarea>
                </div>
            </div>
            ` : ''}

            ${hasFormData ? `
            <!-- Form Tab -->
            <div class="tab-content active" id="form-tab">
                <table class="params-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">✓</th>
                            <th style="width: 25%;">Key</th>
                            <th style="width: 25%;">Value</th>
                            <th style="width: 15%;">Type</th>
                            <th>Description</th>
                            <th style="width: 80px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="form-params-body">
                        <!-- Will be populated by JavaScript -->
                    </tbody>
                </table>
                <button class="add-param-btn" onclick="addFormField()">+ Add Form Field</button>
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

    <!-- AI Conversation Modal -->
    <div class="modal-overlay" id="conversation-modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>AI Conversation</h2>
                <button class="modal-close" onclick="closeConversationModal()">×</button>
            </div>
            <div class="modal-body" id="conversation-modal-body">
                <div class="empty-state">No AI conversation available yet.</div>
            </div>
        </div>
    </div>

    <!-- Value Editor Modal -->
    <div class="modal-overlay" id="value-editor-modal">
        <div class="modal-content value-editor-modal">
            <div class="modal-header">
                <h2 id="value-editor-title">Edit Value</h2>
                <button class="modal-close" onclick="closeValueEditor()">×</button>
            </div>
            <div class="modal-body">
                <textarea id="value-editor-textarea"></textarea>
                <div class="value-editor-actions">
                    <button class="value-editor-cancel" onclick="closeValueEditor()">Cancel</button>
                    <button class="value-editor-save" onclick="saveValueFromEditor()">Save</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Initialize VS Code API
        const vscode = acquireVsCodeApi();

        // Initial data
        let queryParams = ${queryParamsJson};
        let headers = ${headersJson};
        let formData = ${formDataJson || '{}'};
        const baseUrl = '${urlWithoutQuery}';
        let originalJsonBody = ${bodyJson ? `\`${bodyJson}\`` : 'null'}; // Store original JSON
        let currentEditingParam = null; // For value editor

        // Initialize on load
        window.addEventListener('DOMContentLoaded', () => {
            renderQueryParams();
            renderHeaders();
            renderFormFields();
            updateUrlFromQueryParams();

            // 绑定取消解析按钮事件
            const cancelBtn = document.getElementById('body-parsing-cancel-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    console.log('[Webview] Cancel parsing button clicked');
                    vscode.postMessage({ type: 'cancelParsing' });
                    hideParsingStatus();

                    // 恢复重新解析按钮状态
                    const reparseBtn = document.getElementById('reparse-btn');
                    if (reparseBtn) {
                        reparseBtn.disabled = false;
                        reparseBtn.textContent = '🔄 重新解析';
                    }
                });
            }
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

        // Form fields rendering
        function renderFormFields() {
            const tbody = document.getElementById('form-params-body');
            if (!tbody) return; // Form tab may not exist

            tbody.innerHTML = '';

            Object.entries(formData).forEach(([key, value]) => {
                const row = createFormRow(key, value);
                tbody.appendChild(row);
            });
        }

        // Create form row
        function createFormRow(key, value) {
            const tr = document.createElement('tr');
            const isFile = value === '[FILE]';
            const fieldType = isFile ? 'file' : 'text';

            tr.innerHTML = \`
                <td><input type="checkbox" checked onchange="toggleFormField('\${key}')" /></td>
                <td><input type="text" value="\${key}" onchange="updateFormFieldKey('\${key}', this.value)" /></td>
                <td style="position: relative;">
                    \${isFile ?
                        '<input type="file" onchange="updateFormFieldValue(\\''+key+'\\', this.files[0])" />' :
                        '<input type="text" value="'+value+'" oninput="updateFormFieldValue(\\''+key+'\\', this.value)" style="padding-right: 30px;" /><span class="expand-icon" onclick="openValueEditor(\\'form\\', \\''+key+'\\', \\''+value+'\\')" title="Expand editor" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%);">⤢</span>'
                    }
                </td>
                <td>
                    <select onchange="changeFormFieldType('\${key}', this.value)" style="width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px;">
                        <option value="text" \${!isFile ? 'selected' : ''}>Text</option>
                        <option value="file" \${isFile ? 'selected' : ''}>File</option>
                    </select>
                </td>
                <td><input type="text" placeholder="Description" /></td>
                <td class="param-actions">
                    <span class="action-icon" onclick="deleteFormField('\${key}')" title="Delete">🗑️</span>
                </td>
            \`;
            return tr;
        }

        // Add form field
        function addFormField() {
            const newKey = 'new_field';
            formData[newKey] = '';
            renderFormFields();
        }

        // Update form field value
        function updateFormFieldValue(key, value) {
            formData[key] = value;
        }

        // Update form field key
        function updateFormFieldKey(oldKey, newKey) {
            formData[newKey] = formData[oldKey];
            delete formData[oldKey];
            renderFormFields();
        }

        // Toggle form field
        function toggleFormField(key) {
            // For now, just remove from object if unchecked
        }

        // Delete form field
        function deleteFormField(key) {
            delete formData[key];
            renderFormFields();
        }

        // Change form field type
        function changeFormFieldType(key, type) {
            if (type === 'file') {
                formData[key] = '[FILE]';
            } else {
                formData[key] = '';
            }
            renderFormFields();
        }

        // Create param row
        function createParamRow(key, value, type) {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
                <td><input type="checkbox" checked onchange="toggleParam('\${type}', '\${key}')" /></td>
                <td><input type="text" value="\${key}" onchange="updateParamKey('\${type}', '\${key}', this.value)" /></td>
                <td style="position: relative;">
                    <input type="text" value="\${value}" oninput="updateParamValue('\${type}', '\${key}', this.value)" style="padding-right: 30px;" />
                    <span class="expand-icon" onclick="openValueEditor('\${type}', '\${key}', '\${value}')" title="Expand editor" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%);">⤢</span>
                </td>
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
            } else if (type === 'form') {
                formData[key] = newValue;
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

        // Generate with AI
        function generateWithAI() {
            const textarea = document.getElementById('request-body');
            const aiButton = document.getElementById('ai-button');
            const currentJson = textarea.value;

            // Validate JSON first
            try {
                JSON.parse(currentJson);
            } catch (error) {
                alert('Please provide valid JSON template first: ' + error.message);
                return;
            }

            // Disable button and show loading
            aiButton.disabled = true;
            aiButton.textContent = '🤖 AI Generating...';

            // Send to backend
            vscode.postMessage({
                type: 'generateWithAI',
                data: {
                    jsonTemplate: currentJson
                }
            });
        }

        // View AI conversation
        function viewAIConversation() {
            vscode.postMessage({
                type: 'viewAIConversation'
            });
        }

        // Restore original JSON
        function restoreOriginalJson() {
            if (!originalJsonBody) {
                alert('No original JSON template available');
                return;
            }

            const textarea = document.getElementById('request-body');
            if (textarea) {
                textarea.value = originalJsonBody;
                showNotification('✅ Original JSON restored', 'success');
            }
        }

        // Parsing status functions
        function showParsingStatus(message) {
            const overlay = document.getElementById('body-parsing-overlay');
            const text = document.getElementById('body-parsing-text');
            if (overlay && text) {
                text.textContent = message || '正在解析参数...';
                overlay.style.display = 'flex';
            }
        }

        function updateParsingStatus(message) {
            const text = document.getElementById('body-parsing-text');
            if (text) {
                text.textContent = message || '正在解析参数...';
            }
        }

        function hideParsingStatus() {
            const overlay = document.getElementById('body-parsing-overlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
        }

        function cancelParsing() {
            console.log('[Webview] cancelParsing function called (deprecated, use button event)');
            vscode.postMessage({
                type: 'cancelParsing'
            });
            hideParsingStatus();
        }

        function updateBodyContent(body) {
            const textarea = document.getElementById('request-body');
            if (textarea && body) {
                textarea.value = body;
                showNotification('✅ Body 内容已更新', 'success');
            }
        }

        function reparseBodyParams() {
            console.log('[Webview] Reparse body params clicked');

            // 禁用按钮防止重复点击
            const btn = document.getElementById('reparse-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '🔄 解析中...';
            }

            // 发送重新解析消息
            vscode.postMessage({
                type: 'reparseBodyParams'
            });
        }

        // Close conversation modal
        function closeConversationModal() {
            const modal = document.getElementById('conversation-modal');
            modal.classList.remove('visible');
        }

        // Display AI conversation in modal
        function displayAIConversation(conversation) {
            const modal = document.getElementById('conversation-modal');
            const modalBody = document.getElementById('conversation-modal-body');

            if (!conversation) {
                modalBody.innerHTML = '<div class="empty-state">No AI conversation available yet.</div>';
            } else {
                const timestamp = new Date(conversation.timestamp).toLocaleString();
                modalBody.innerHTML = \`
                    <div class="conversation-timestamp">Generated at: \${timestamp}</div>

                    <div class="conversation-section">
                        <h3>System Prompt</h3>
                        <pre>\${conversation.systemPrompt}</pre>
                    </div>

                    <div class="conversation-section">
                        <h3>User Prompt (Sent to AI)</h3>
                        <pre>\${conversation.userPrompt}</pre>
                    </div>

                    <div class="conversation-section">
                        <h3>AI Response</h3>
                        <pre>\${conversation.aiResponse}</pre>
                    </div>
                \`;
            }

            modal.classList.add('visible');
        }

        // Open settings
        function openSettings() {
            vscode.postMessage({
                type: 'openSettings'
            });
        }

        // Open value editor
        function openValueEditor(type, key, value) {
            currentEditingParam = { type, key, value };

            const modal = document.getElementById('value-editor-modal');
            const textarea = document.getElementById('value-editor-textarea');
            const title = document.getElementById('value-editor-title');

            title.textContent = \`Edit Value: \${key}\`;
            textarea.value = value || '';
            textarea.focus();

            modal.classList.add('visible');
        }

        // Close value editor
        function closeValueEditor() {
            const modal = document.getElementById('value-editor-modal');
            modal.classList.remove('visible');
            currentEditingParam = null;
        }

        // Save value from editor
        function saveValueFromEditor() {
            if (!currentEditingParam) return;

            const textarea = document.getElementById('value-editor-textarea');
            const newValue = textarea.value;

            const { type, key } = currentEditingParam;

            // Update the value
            updateParamValue(type, key, newValue);

            // Re-render the appropriate table
            if (type === 'query') {
                renderQueryParams();
            } else if (type === 'header') {
                renderHeaders();
            } else if (type === 'form') {
                renderFormFields();
            }

            closeValueEditor();
            showNotification('✅ Value updated', 'success');
        }

        // Send request
        function sendRequest() {
            const url = document.getElementById('fullUrl').value;
            const bodyElement = document.getElementById('request-body');
            const body = bodyElement ? bodyElement.value : null;

            // Check if we have form data
            const hasFormData = Object.keys(formData).length > 0;

            try {
                const requestData = {
                    method: '${endpointMethod}',
                    url: url,
                    headers: headers,
                    body: null,
                    formData: null
                };

                // Handle body vs form data
                if (hasFormData) {
                    requestData.formData = formData;
                    requestData.headers['Content-Type'] = 'multipart/form-data';
                } else if (body) {
                    requestData.body = JSON.parse(body);
                }

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
            } else if (message.type === 'aiGenerationResult') {
                handleAIGenerationResult(message.result);
            } else if (message.type === 'aiConversationData') {
                displayAIConversation(message.conversation);
            } else if (message.type === 'restoreOriginalJsonData') {
                // This is handled by the restoreOriginalJson function directly
            } else if (message.type === 'parsingStarted') {
                showParsingStatus(message.message);
            } else if (message.type === 'parsingStatus') {
                updateParsingStatus(message.message);
            } else if (message.type === 'parsingComplete') {
                hideParsingStatus();
                showNotification('✅ ' + (message.message || '参数解析完成!'), 'success');

                // 恢复重新解析按钮
                const reparseBtn = document.getElementById('reparse-btn');
                if (reparseBtn) {
                    reparseBtn.disabled = false;
                    reparseBtn.textContent = '🔄 重新解析';
                }
            } else if (message.type === 'parsingCancelled') {
                hideParsingStatus();
                showNotification('❌ ' + (message.message || '解析已取消'), 'info');

                // 恢复重新解析按钮
                const reparseBtn = document.getElementById('reparse-btn');
                if (reparseBtn) {
                    reparseBtn.disabled = false;
                    reparseBtn.textContent = '🔄 重新解析';
                }
            } else if (message.type === 'parsingFailed') {
                hideParsingStatus();
                showNotification('⚠️ ' + (message.message || '参数解析失败'), 'error');

                // 恢复重新解析按钮
                const reparseBtn = document.getElementById('reparse-btn');
                if (reparseBtn) {
                    reparseBtn.disabled = false;
                    reparseBtn.textContent = '🔄 重新解析';
                }
            } else if (message.type === 'updateBodyContent') {
                updateBodyContent(message.body);
            }
        });

        // Handle AI generation result
        function handleAIGenerationResult(result) {
            const aiButton = document.getElementById('ai-button');
            const textarea = document.getElementById('request-body');

            // Re-enable button
            aiButton.disabled = false;
            aiButton.textContent = '🤖 AI Generate';

            if (result.success) {
                // Update textarea with AI generated JSON
                textarea.value = result.data;

                // Format it
                try {
                    const parsed = JSON.parse(result.data);
                    textarea.value = JSON.stringify(parsed, null, 2);
                } catch (e) {
                    // Already formatted or invalid
                }

                // Show success message
                showNotification('✨ AI generated successfully!', 'success');
            } else {
                // Show error
                showNotification('❌ ' + result.error, 'error');
            }
        }

        // Show notification
        function showNotification(message, type) {
            const notification = document.createElement('div');
            let bgColor = '#F93E3E'; // error
            if (type === 'success') bgColor = '#49CC90';
            if (type === 'info') bgColor = '#61AFFE';

            notification.style.cssText = \`
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: 4px;
                background: \${bgColor};
                color: white;
                font-size: 14px;
                z-index: 10000;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                animation: slideIn 0.3s ease-out;
            \`;
            notification.textContent = message;
            document.body.appendChild(notification);

            const duration = type === 'info' ? 2000 : 3000;
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, duration);
        }

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