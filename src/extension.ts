import * as vscode from 'vscode';
import { ApiEndpointDetector } from './apiEndpointDetector';
import { ApiCodeLensProvider } from './apiCodeLensProvider';
import { ApiTestPanel } from './apiTestPanel';
import { ApiRequestGenerator } from './apiRequestGenerator';
import { EnvironmentManager } from './environmentManager';
import { EnvironmentPanel } from './environmentPanel';
import { ParameterStorage } from './parameterStorage';

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 C# API Tester extension is now active!');
    console.log('✅ Extension context:', context.extensionUri);

    ParameterStorage.initialize(context);

    const detector = new ApiEndpointDetector();
    const requestGenerator = new ApiRequestGenerator();
    const environmentManager = EnvironmentManager.getInstance();

    // Register code lens provider for C# files
    console.log('🔧 Registering code lens provider for C# language');
    const codeLensProvider = new ApiCodeLensProvider(detector);
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
        { language: 'csharp' },
        codeLensProvider
    );
    console.log('✅ Code lens provider registered');

    // Create status bar item for API detection toggle
    const apiDetectionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    apiDetectionStatusBar.command = 'csharpApiTester.toggleApiDetection';
    updateApiDetectionStatusBar(apiDetectionStatusBar);
    apiDetectionStatusBar.show();
    context.subscriptions.push(apiDetectionStatusBar);

    // Register commands
    const testApiCommand = vscode.commands.registerCommand('csharpApiTester.testApi', async (apiInfo: any) => {
        console.log('🎯 testApi command triggered with:', apiInfo);
        try {
            if (apiInfo) {
                console.log('✅ Creating API test panel with endpoint info');
                ApiTestPanel.createOrShow(context.extensionUri, detector, apiInfo);
            } else {
                console.log('❌ No API info provided, showing empty panel');
                ApiTestPanel.createOrShow(context.extensionUri, detector, undefined);
            }
        } catch (error) {
            console.error('❌ Error in testApi command:', error);
            vscode.window.showErrorMessage(`Failed to open API test panel: ${error}`);
        }
    });

    const configureBaseUrlCommand = vscode.commands.registerCommand('csharpApiTester.configureBaseUrl', async () => {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        const currentBaseUrl = config.get<string>('baseUrl');

        const newBaseUrl = await vscode.window.showInputBox({
            prompt: 'Enter the base URL for API testing',
            value: currentBaseUrl || 'http://localhost:5000',
            validateInput: (value) => {
                try {
                    new URL(value);
                    return null;
                } catch {
                    return 'Please enter a valid URL';
                }
            }
        });

        if (newBaseUrl) {
            await config.update('baseUrl', newBaseUrl, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Base URL updated to: ${newBaseUrl}`);
        }
    });

    const showApiTestPanelCommand = vscode.commands.registerCommand('csharpApiTester.showApiTestPanel', () => {
        ApiTestPanel.createOrShow(context.extensionUri, detector, undefined);
    });

    const debugApiDetectionCommand = vscode.commands.registerCommand('csharpApiTester.debugApiDetection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'csharp') {
            console.log(`🔍 Debugging API detection for: ${editor.document.fileName}`);

            const endpoints = await detector.detectApiEndpoints(editor.document);
            console.log(`📊 Found ${endpoints.length} API endpoints`);

            endpoints.forEach((endpoint, index) => {
                console.log(`  ${index + 1}. ${endpoint.method} ${endpoint.route} (${endpoint.methodName})`);
                console.log(`     Line: ${endpoint.line}, Parameters: ${endpoint.parameters.length}`);
                endpoint.parameters.forEach(param => {
                    console.log(`     - ${param.name} (${param.type}, ${param.source})`);
                });
            });

            if (endpoints.length === 0) {
                console.log('❌ No API endpoints detected. Check the logs above for details.');
            }

            vscode.window.showInformationMessage(`API Detection: Found ${endpoints.length} endpoints (check console for details)`);
        } else {
            vscode.window.showWarningMessage('Please open a C# file to debug API detection');
        }
    });

    const manageEnvironmentsCommand = vscode.commands.registerCommand('csharpApiTester.manageEnvironments', async () => {
        const currentEnv = environmentManager.getCurrentEnvironment();
        const choices = [
            {
                label: `$(check) Current: ${currentEnv?.name || 'None'}`,
                description: `${currentEnv?.baseUrl || ''}${currentEnv?.basePath || ''}`,
                detail: 'Current active environment'
            },
            {
                label: '$(list-unordered) View All Environments',
                description: 'List and manage all environments',
                detail: 'Show all configured environments'
            },
            {
                label: '$(add) Add New Environment',
                description: 'Create a new API environment',
                detail: 'Configure new environment settings'
            },
            {
                label: '$(edit) Edit Current Environment',
                description: 'Modify current environment',
                detail: 'Update environment configuration'
            },
            {
                label: '$(settings) Edit Custom Variables',
                description: 'Manage environment-specific variables',
                detail: 'Add, edit, or delete custom variables'
            },
            {
                label: '$(trash) Delete Environment',
                description: 'Remove an environment',
                detail: 'Delete unused environments'
            }
        ];

        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: 'Choose environment management action',
            title: 'API Environment Management'
        });

        if (!selected) return;

        if (selected.label.includes('View All Environments')) {
            await showAllEnvironmentsList(environmentManager);
        } else if (selected.label.includes('Add New Environment')) {
            await addNewEnvironment(environmentManager);
        } else if (selected.label.includes('Edit Current Environment')) {
            await editCurrentEnvironment(environmentManager);
        } else if (selected.label.includes('Edit Custom Variables')) {
            await editCustomVariables(environmentManager);
        } else if (selected.label.includes('Delete Environment')) {
            await deleteEnvironment(environmentManager);
        }
    });

    const switchEnvironmentCommand = vscode.commands.registerCommand('csharpApiTester.switchEnvironment', async () => {
        const newEnvironment = await environmentManager.showEnvironmentPicker();
        if (newEnvironment) {
            await environmentManager.setCurrentEnvironment(newEnvironment);
        }
    });

    const openEnvironmentManagerCommand = vscode.commands.registerCommand('csharpApiTester.openEnvironmentManager', () => {
        EnvironmentPanel.createOrShow(context.extensionUri);
    });

    const testDebugCommand = vscode.commands.registerCommand('csharpApiTester.testDebug', () => {
        console.log('🔧 Debug test command executed!');
        vscode.window.showInformationMessage('Debug test command works! Extension is active.');

        // Test API panel creation
        try {
            const testEndpoint = {
                method: 'GET',
                route: '/api/test',
                parameters: [],
                returnType: 'string',
                line: 0,
                character: 0,
                methodName: 'TestMethod',
                controllerName: 'TestController'
            };

            console.log('🧪 Creating test panel...');
            ApiTestPanel.createOrShow(context.extensionUri, detector, testEndpoint);
            vscode.window.showInformationMessage('API Test Panel should now be open!');
        } catch (error) {
            console.error('❌ Error creating test panel:', error);
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    });

    const toggleApiDetectionCommand = vscode.commands.registerCommand('csharpApiTester.toggleApiDetection', async () => {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        const currentValue = config.get<boolean>('enableApiDetection', true);
        const newValue = !currentValue;

        await config.update('enableApiDetection', newValue, vscode.ConfigurationTarget.Global);

        // Update status bar
        updateApiDetectionStatusBar(apiDetectionStatusBar);

        if (newValue) {
            vscode.window.showInformationMessage('✅ API Detection Enabled');
            // Refresh code lenses
            codeLensProvider.refresh();
        } else {
            vscode.window.showInformationMessage('❌ API Detection Disabled');
            // Refresh to clear code lenses
            codeLensProvider.refresh();
        }
    });

    // Add to subscriptions
    context.subscriptions.push(
        codeLensDisposable,
        testApiCommand,
        configureBaseUrlCommand,
        showApiTestPanelCommand,
        debugApiDetectionCommand,
        manageEnvironmentsCommand,
        switchEnvironmentCommand,
        openEnvironmentManagerCommand,
        testDebugCommand,
        toggleApiDetectionCommand
    );

    // Refresh code lenses when document changes
    const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'csharp') {
            console.log(`[C# API Extension] Document changed, refreshing code lenses`);
            codeLensProvider.refresh();
        }
    });

    context.subscriptions.push(documentChangeDisposable);

    // Invalidate cache when C# files are saved
    const documentSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === 'csharp') {
            console.log(`[C# API Extension] Document saved, invalidating cache for: ${document.uri.fsPath}`);
            const cache = detector.getClassParser().getCache();
            cache.invalidateFile(document.uri.fsPath);
        }
    });

    context.subscriptions.push(documentSaveDisposable);

    console.log('🔧 All extension components initialized successfully');
}

export function deactivate() {
    console.log('C# API Tester extension is now deactivated!');
}

// Helper function to update API detection status bar
function updateApiDetectionStatusBar(statusBar: vscode.StatusBarItem): void {
    const config = vscode.workspace.getConfiguration('csharpApiTester');
    const enabled = config.get<boolean>('enableApiDetection', true);

    if (enabled) {
        statusBar.text = '$(check) API Detection';
        statusBar.tooltip = 'API Detection is enabled. Click to disable.';
        statusBar.backgroundColor = undefined;
    } else {
        statusBar.text = '$(x) API Detection';
        statusBar.tooltip = 'API Detection is disabled. Click to enable.';
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

// Environment Management Helper Functions
async function showAllEnvironmentsList(environmentManager: EnvironmentManager): Promise<void> {
    const environments = environmentManager.getAllEnvironments();
    const currentEnv = environmentManager.getCurrentEnvironment();

    const items = environments.map(env => {
        const headerDetails = Object.entries(env.headers || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
        const customVarDetails = Object.entries(env.customVariables || {}).map(([k, v]) => `${k}=${v}`).join(', ');

        let detail = headerDetails;
        if (customVarDetails) {
            detail += ` | Vars: ${customVarDetails}`;
        }
        if (env.name === currentEnv?.name) {
            detail += ' (Current)';
        }

        return {
            label: env.name,
            description: `${env.baseUrl}${env.basePath}`,
            detail,
            environment: env
        };
    });

    await vscode.window.showQuickPick(items, {
        placeHolder: 'View all environments',
        title: 'All API Environments',
        ignoreFocusOut: true
    });
}

async function addNewEnvironment(environmentManager: EnvironmentManager): Promise<void> {
    const name = await vscode.window.showInputBox({
        prompt: 'Enter environment name',
        placeHolder: 'e.g., Production, Staging, Local'
    });

    if (!name) return;

    const baseUrl = await vscode.window.showInputBox({
        prompt: 'Enter base URL',
        placeHolder: 'e.g., http://localhost:5000'
    });

    if (!baseUrl) return;

    let basePath = await vscode.window.showInputBox({
        prompt: 'Enter base path (optional)',
        placeHolder: 'e.g., /api (leave empty if no base path)'
    });

    if (basePath === undefined) return; // Allow empty
    if (!basePath) basePath = '';

    const headersJson = await vscode.window.showInputBox({
        prompt: 'Enter headers as JSON (optional)',
        placeHolder: '{"Header-Name": "value"}',
        value: '{}'
    });

    let headers: Record<string, string> = {};
    if (headersJson) {
        try {
            headers = JSON.parse(headersJson);
        } catch (error) {
            vscode.window.showErrorMessage('Invalid JSON format for headers');
            return;
        }
    }

    const customVariablesJson = await vscode.window.showInputBox({
        prompt: 'Enter custom variables as JSON (optional)',
        placeHolder: '{"API_VERSION": "v1", "DEBUG_MODE": "false"}',
        value: '{}'
    });

    let customVariables = {};
    if (customVariablesJson) {
        try {
            customVariables = JSON.parse(customVariablesJson);
        } catch (error) {
            vscode.window.showErrorMessage('Invalid JSON format for custom variables');
            return;
        }
    }

    const newEnvironment = {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        basePath: basePath.trim(),
        headers,
        customVariables,
        active: false
    };

    try {
        await environmentManager.addEnvironment(newEnvironment);
        const switchNow = await vscode.window.showInformationMessage(
            `Environment '${name}' has been added. Switch to it now?`,
            'Yes', 'No'
        );

        if (switchNow === 'Yes') {
            await environmentManager.setCurrentEnvironment(name);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to add environment: ${error}`);
    }
}

async function editCurrentEnvironment(environmentManager: EnvironmentManager): Promise<void> {
    const currentEnv = environmentManager.getCurrentEnvironment();
    if (!currentEnv) {
        vscode.window.showWarningMessage('No current environment to edit');
        return;
    }

    const choices = [
        { label: 'Name', value: currentEnv.name },
        { label: 'Base URL', value: currentEnv.baseUrl },
        { label: 'Base Path', value: currentEnv.basePath },
        { label: 'Headers', value: JSON.stringify(currentEnv.headers || {}, null, 2) },
        { label: 'Custom Variables', value: JSON.stringify(currentEnv.customVariables || {}, null, 2) }
    ];

    const selected = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Select field to edit',
        title: `Edit Environment: ${currentEnv.name}`
    });

    if (!selected) return;

    let newValue: string | Record<string, string> = await vscode.window.showInputBox({
        prompt: `Enter new ${selected.label}`,
        value: selected.value
    }) || '';

    if (!newValue) return;

    try {
        if (selected.label === 'Headers' || selected.label === 'Custom Variables') {
            newValue = JSON.parse(newValue);
        }

        const update: any = {};
        if (selected.label === 'Custom Variables') {
            update.customVariables = newValue;
        } else {
            update[selected.label.toLowerCase().replace(' ', '')] = newValue;
        }
        await environmentManager.updateEnvironment(currentEnv.name, update);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to update environment: ${error}`);
    }
}

async function editCustomVariables(environmentManager: EnvironmentManager): Promise<void> {
    const currentEnv = environmentManager.getCurrentEnvironment();
    if (!currentEnv) {
        vscode.window.showWarningMessage('No current environment to edit');
        return;
    }

    let variables = { ...(currentEnv.customVariables || {}) };

    let editing = true;
    while (editing) {
        const choices = [
            {
                label: '$(add) Add New Variable',
                description: 'Add a new custom variable',
                detail: 'Create a new environment variable'
            },
            {
                label: '$(list-unordered) View All Variables',
                description: 'List all custom variables',
                detail: `Currently have ${Object.keys(variables).length} variables`
            }
        ];

        // Add existing variables to the choices
        const existingVariables = Object.entries(variables).map(([key, value]) => ({
            label: `$(variable) ${key}`,
            description: value,
            detail: 'Click to edit or delete',
            key: key,
            value: value
        }));

        const allChoices = [...choices, ...existingVariables];

        const selected = await vscode.window.showQuickPick(allChoices, {
            placeHolder: 'Select variable to manage',
            title: `Custom Variables for ${currentEnv.name}`,
            ignoreFocusOut: true
        });

        if (!selected) {
            editing = false;
            break;
        }

        if (selected.label.includes('Add New Variable')) {
            await addNewVariable(currentEnv, environmentManager);
            // Refresh variables after adding
            const updatedEnv = environmentManager.getCurrentEnvironment();
            variables = { ...(updatedEnv?.customVariables || {}) };
        } else if (selected.label.includes('View All Variables')) {
            await viewAllVariables(variables);
        } else if ('key' in selected && 'value' in selected) {
            await manageSingleVariable(selected.key as string, selected.value as string, currentEnv, environmentManager);
            // Refresh variables after editing/deleting
            const updatedEnv = environmentManager.getCurrentEnvironment();
            variables = { ...(updatedEnv?.customVariables || {}) };
        }
    }
}

async function addNewVariable(env: any, environmentManager: EnvironmentManager): Promise<void> {
    const key = await vscode.window.showInputBox({
        prompt: 'Enter variable name',
        placeHolder: 'e.g., API_VERSION, DEBUG_MODE, TIMEOUT',
        validateInput: (value) => {
            if (!value || value.trim() === '') {
                return 'Variable name cannot be empty';
            }
            if ((env.customVariables || {})[value.trim()]) {
                return `Variable '${value}' already exists`;
            }
            return null;
        }
    });

    if (!key) return;

    const value = await vscode.window.showInputBox({
        prompt: `Enter value for '${key}'`,
        placeHolder: 'e.g., v1, true, 5000'
    });

    if (value === undefined) return;

    try {
        const newVariables = { ...(env.customVariables || {}), [key.trim()]: value.trim() };
        await environmentManager.updateEnvironment(env.name, { customVariables: newVariables });
        vscode.window.showInformationMessage(`Variable '${key}' added successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to add variable: ${error}`);
    }
}

async function manageSingleVariable(key: string, value: string, env: any, environmentManager: EnvironmentManager): Promise<void> {
    const choices = [
        { label: '$(edit) Edit Variable', description: `Modify value of '${key}'` },
        { label: '$(trash) Delete Variable', description: `Remove '${key}' and its value` }
    ];

    const selected = await vscode.window.showQuickPick(choices, {
        placeHolder: `Manage variable '${key}'`,
        title: `Variable: ${key} = ${value}`
    });

    if (!selected) return;

    if (selected.label.includes('Edit Variable')) {
        const newValue = await vscode.window.showInputBox({
            prompt: `Enter new value for '${key}'`,
            value: value
        });

        if (newValue === undefined) return;

        if (newValue.trim() !== value) {
            try {
                const newVariables = { ...(env.customVariables || {}), [key]: newValue.trim() };
                await environmentManager.updateEnvironment(env.name, { customVariables: newVariables });
                vscode.window.showInformationMessage(`Variable '${key}' updated successfully`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update variable: ${error}`);
            }
        }
    } else if (selected.label.includes('Delete Variable')) {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete variable '${key}'?`,
            'Delete', 'Cancel'
        );

        if (confirm === 'Delete') {
            try {
                const newVariables = { ...(env.customVariables || {}) };
                delete newVariables[key];
                await environmentManager.updateEnvironment(env.name, { customVariables: newVariables });
                vscode.window.showInformationMessage(`Variable '${key}' deleted successfully`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete variable: ${error}`);
            }
        }
    }
}

async function viewAllVariables(variables: Record<string, string>): Promise<void> {
    const entries = Object.entries(variables);

    if (entries.length === 0) {
        vscode.window.showInformationMessage('No custom variables configured');
        return;
    }

    const items = entries.map(([key, value]) => ({
        label: key,
        description: value,
        detail: 'Custom environment variable'
    }));

    await vscode.window.showQuickPick(items, {
        placeHolder: 'View all custom variables',
        title: 'All Custom Variables',
        ignoreFocusOut: true
    });
}

async function deleteEnvironment(environmentManager: EnvironmentManager): Promise<void> {
    const environments = environmentManager.getAllEnvironments();
    const currentEnv = environmentManager.getCurrentEnvironment();

    const items = environments.filter(env => env.name !== currentEnv?.name).map(env => ({
        label: env.name,
        description: `${env.baseUrl}${env.basePath}`,
        environment: env
    }));

    if (items.length === 0) {
        vscode.window.showInformationMessage('No environments available to delete');
        return;
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select environment to delete',
        title: 'Delete Environment'
    });

    if (!selected) return;

    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete environment '${selected.label}'?`,
        'Delete', 'Cancel'
    );

    if (confirm === 'Delete') {
        try {
            await environmentManager.deleteEnvironment(selected.label);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete environment: ${error}`);
        }
    }
}
