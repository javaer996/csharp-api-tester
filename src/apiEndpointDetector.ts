import * as vscode from 'vscode';
import { CSharpClassParser, ClassProperty } from './csharpClassParser';

export interface ApiEndpointInfo {
    method: string;
    route: string;
    parameters: ApiParameter[];
    returnType: string;
    line: number;
    character: number;
    methodName: string;
    controllerName?: string;
}

export interface ApiParameter {
    name: string;
    type: string;
    source: 'path' | 'query' | 'body' | 'header' | 'form';
    required: boolean;
    constraint?: string;
    properties?: ClassProperty[];  // For complex types, store class properties
}

export class ApiEndpointDetector {
    private readonly httpMethodAttributes = [
        'HttpGet', 'HttpPost', 'HttpPut', 'HttpDelete',
        'HttpPatch', 'HttpHead', 'HttpOptions'
    ];
    private classParser: CSharpClassParser;

    constructor() {
        this.classParser = new CSharpClassParser();
    }

    detectApiEndpoints(document: vscode.TextDocument): ApiEndpointInfo[] {
        const endpoints: ApiEndpointInfo[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[C# API Detector] Starting analysis of ${lines.length} lines`);
        console.log(`[C# API Detector] Document language: ${document.languageId}`);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            console.log(`[C# API Detector] Line ${i}: "${line}"`);

            // Look for controller class
            if (this.isControllerClass(line)) {
                console.log(`[C# API Detector] Found controller class at line ${i}`);
                const controllerInfo = this.parseController(line);
                const controllerRoute = this.extractControllerRoute(lines, i);

                console.log(`[C# API Detector] Controller info:`, controllerInfo);
                console.log(`[C# API Detector] Controller route:`, controllerRoute);

                // Find API methods in this controller
                let braceCount = 0;
                let j = i + 1;
                let foundClassStart = false;

                while (j < lines.length) {
                    const methodLine = lines[j];

                    // Count braces to track class scope
                    for (let char of methodLine) {
                        if (char === '{') braceCount++;
                        if (char === '}') braceCount--;
                    }

                    // Wait until we enter the class body
                    if (!foundClassStart && braceCount > 0) {
                        foundClassStart = true;
                    }

                    // If we've left the class body, stop
                    if (foundClassStart && braceCount === 0) {
                        break;
                    }

                    const trimmedLine = methodLine.trim();
                    console.log(`[C# API Detector] Checking method line ${j}: "${trimmedLine}" (brace count: ${braceCount})`);

                    if (this.hasHttpMethodAttribute(trimmedLine)) {
                        console.log(`[C# API Detector] Found HTTP method attribute at line ${j}`);
                        const methodInfo = this.parseApiMethod(document, lines, j, controllerInfo, controllerRoute);
                        if (methodInfo) {
                            console.log(`[C# API Detector] Parsed method: ${methodInfo.method} ${methodInfo.route}`);
                            endpoints.push(methodInfo);
                        }
                    }
                    j++;
                }
            }
        }

        return endpoints;
    }

    private isControllerClass(line: string): boolean {
        const hasClassKeyword = line.includes('class');
        const hasControllerPattern = /Controller/.test(line);
        const result = hasClassKeyword && hasControllerPattern;
        console.log(`[C# API Detector] isControllerClass("${line}"): ${result} (hasClass: ${hasClassKeyword}, hasController: ${hasControllerPattern})`);
        return result;
    }

    private parseController(line: string): { name: string; routePrefix?: string } {
        const classMatch = line.match(/class\s+(\w+)/);
        const name = classMatch ? classMatch[1] : '';

        // Remove "Controller" suffix if present
        const cleanName = name.replace(/Controller$/, '');

        return {
            name: cleanName,
            routePrefix: cleanName.toLowerCase()
        };
    }

    private extractControllerRoute(lines: string[], classLineIndex: number): string {
        // Look backwards from class line to find [Route] attribute
        let controllerRoute = '';

        for (let i = classLineIndex - 1; i >= 0; i--) {
            const line = lines[i].trim();

            if (line.includes('[ApiController]')) {
                break; // Stop when we hit the ApiController attribute
            }

            const routeMatch = line.match(/\[Route\("([^"]+)"\)\]/);
            if (routeMatch) {
                controllerRoute = routeMatch[1];
                console.log(`[C# API Detector] Found controller route: ${controllerRoute}`);
                break;
            }
        }

        return controllerRoute;
    }

    private isClassEnd(line: string): boolean {
        // This method is flawed - it should detect when a class definition ends, not starts
        // For now, let's return false tosee the full class content
        const hasClassKeyword = line.includes('class ');
        const hasOpeningBrace = line.includes('{');
        console.log(`[C# API Detector] isClassEnd("${line}"): ${hasClassKeyword && hasOpeningBrace}`);
        return hasClassKeyword && hasOpeningBrace;
    }

    private hasHttpMethodAttribute(line: string): boolean {
        const result = this.httpMethodAttributes.some(attr => line.includes(`[${attr}`));
        console.log(`[C# API Detector] hasHttpMethodAttribute("${line}"): ${result}`);
        return result;
    }

    private parseApiMethod(document: vscode.TextDocument, lines: string[], startLine: number, controllerInfo: any, controllerRoute: string): ApiEndpointInfo | null {
        let currentLine = startLine;
        let httpMethod = '';
        let routeTemplate = '';
        let methodSignature = '';
        let methodName = '';
        let returnType = '';

        console.log(`[C# API Detector] Starting to parse API method at line ${startLine}`);

        // Parse attributes
        while (currentLine < lines.length) {
            const line = lines[currentLine].trim();

            if (line.startsWith('[')) {
                // Check for HTTP method attribute
                for (const attr of this.httpMethodAttributes) {
                    if (line.includes(`[${attr}`)) {
                        httpMethod = attr.replace('Http', '').toUpperCase();

                        // Extract route from attribute
                        const routeMatch = line.match(/\[\w+\("([^"]+)"\)\]/);
                        if (routeMatch) {
                            routeTemplate = routeMatch[1];
                        }
                        break;
                    }
                }

                // Check for Route attribute
                if (line.includes('[Route(')) {
                    const routeMatch = line.match(/\[Route\("([^"]+)"\)\]/);
                    if (routeMatch) {
                        routeTemplate = routeMatch[1];
                    }
                }
            } else if (line.includes('public') && line.includes('(') && line.includes(')')) {
                // Found method signature
                methodSignature = line;

                // Extract method name and return type
                const methodMatch = line.match(/public\s+(?:async\s+)?(\w+[\w<>?]*)\s+(\w+)\s*\(/);
                if (methodMatch) {
                    returnType = methodMatch[1];
                    methodName = methodMatch[2];
                }
                break;
            } else if (line.includes('public') && !line.includes('class')) {
                // Method signature might span multiple lines
                methodSignature = line;
                currentLine++;

                // Continue reading until we find the closing parenthesis
                while (currentLine < lines.length && !lines[currentLine].includes(')')) {
                    methodSignature += ' ' + lines[currentLine].trim();
                    currentLine++;
                }
                if (currentLine < lines.length) {
                    methodSignature += ' ' + lines[currentLine].trim();
                }

                const methodMatch = methodSignature.match(/public\s+(?:async\s+)?(\w+[\w<>?]*)\s+(\w+)\s*\(/);
                if (methodMatch) {
                    returnType = methodMatch[1];
                    methodName = methodMatch[2];
                }
                break;
            }

            currentLine++;
        }

        if (!httpMethod || !methodName) {
            return null;
        }

        // Parse parameters
        const parameters = this.parseParameters(document, methodSignature);

        // Build complete route
        let route = '';

        // Start with controller route if available
        if (controllerRoute) {
            // Replace [controller] placeholder with actual controller name
            const controllerName = controllerInfo.name.toLowerCase();
            const processedControllerRoute = controllerRoute.replace('[controller]', controllerName);
            route = processedControllerRoute.startsWith('/') ? processedControllerRoute : `/${processedControllerRoute}`;
        } else if (controllerInfo.routePrefix) {
            // Fallback to old behavior if no controller route found
            route = `/${controllerInfo.routePrefix}`;
        }

        // Add method-specific route
        if (routeTemplate) {
            route += routeTemplate.startsWith('/') ? routeTemplate : `/${routeTemplate}`;
        } else if (!controllerRoute) {
            // Only use method name as route if no controller route exists
            route += `/${methodName}`;
        }

        // Handle route parameter placeholders
        route = this.processRouteParameters(route, parameters);

        return {
            method: httpMethod,
            route: route,
            parameters: parameters,
            returnType: returnType,
            line: startLine,
            character: 0,
            methodName: methodName,
            controllerName: controllerInfo.name
        };
    }

    private parseParameters(document: vscode.TextDocument, methodSignature: string): ApiParameter[] {
        const parameters: ApiParameter[] = [];

        // Extract parameter list
        const paramMatch = methodSignature.match(/\(([^)]+)\)/);
        if (!paramMatch) {
            return parameters;
        }

        const paramString = paramMatch[1];
        const paramList = this.splitParameters(paramString);

        for (const param of paramList) {
            const paramInfo = this.parseSingleParameter(document, param.trim());
            if (paramInfo) {
                parameters.push(paramInfo);
            }
        }

        return parameters;
    }

    private splitParameters(paramString: string): string[] {
        // Handle complex parameter types with nested generics
        const parameters: string[] = [];
        let current = '';
        let depth = 0;

        for (let i = 0; i < paramString.length; i++) {
            const char = paramString[i];

            if (char === '<') {
                depth++;
            } else if (char === '>') {
                depth--;
            } else if (char === ',' && depth === 0) {
                parameters.push(current.trim());
                current = '';
                continue;
            }

            current += char;
        }

        if (current.trim()) {
            parameters.push(current.trim());
        }

        return parameters;
    }

    private parseSingleParameter(document: vscode.TextDocument, param: string): ApiParameter | null {
        // Parse parameter with potential attributes
        const parts = param.split(' ');
        if (parts.length < 2) {
            return null;
        }

        let type = '';
        let name = '';
        let source: 'path' | 'query' | 'body' | 'header' | 'form' = 'query';
        let required = false;

        // Find parameter name (last word before potential default value)
        const nameMatch = param.match(/(\w+)\s*(?:=|$)/);
        name = nameMatch ? nameMatch[1] : '';

        // Determine type (everything before the name, excluding attributes)
        const typeMatch = param.match(/\b(\w+[\w<>?\[\]]*)\s+\w+(?:\s*[=,]|$)/);
        type = typeMatch ? typeMatch[1] : 'object';

        // Determine parameter source based on type and naming conventions
        if (param.includes('[FromRoute]') || name.toLowerCase().includes('id')) {
            source = 'path';
            required = true;
        } else if (param.includes('[FromBody]')) {
            source = 'body';
            required = true;
        } else if (param.includes('[FromQuery]')) {
            source = 'query';
        } else if (param.includes('[FromHeader]')) {
            source = 'header';
        } else if (param.includes('[FromForm]')) {
            source = 'form';
        } else {
            // Default logic based on simple types
            if (this.isSimpleType(type)) {
                source = 'query';
            } else {
                source = 'body';
                required = true;
            }
        }

        const apiParam: ApiParameter = {
            name: name,
            type: type,
            source: source,
            required: required
        };

        // For complex types used in body/form, try to parse class definition
        if (!this.isSimpleType(type) && (source === 'body' || source === 'form')) {
            console.log(`[C# API Detector] Parsing complex type: ${type}`);
            const properties = this.classParser.parseClassDefinition(document, type);
            if (properties && properties.length > 0) {
                apiParam.properties = properties;
                console.log(`[C# API Detector] Added ${properties.length} properties to parameter ${name}`);
            } else {
                console.log(`[C# API Detector] No properties found for type ${type}, will use generic generation`);
            }
        }

        return apiParam;
    }

    private isSimpleType(type: string): boolean {
        const simpleTypes = [
            'string', 'int', 'long', 'short', 'byte',
            'uint', 'ulong', 'ushort', 'sbyte',
            'double', 'float', 'decimal',
            'bool', 'DateTime', 'DateTimeOffset',
            'Guid', 'char'
        ];

        return simpleTypes.includes(type) || type.endsWith('?') && simpleTypes.includes(type.slice(0, -1));
    }

    private processRouteParameters(route: string, parameters: ApiParameter[]): string {
        // Replace route parameter placeholders with actual parameter names
        let processedRoute = route;

        // Look for route parameters like {id} and replace with actual parameter names
        const routeParams = parameters.filter(p => p.source === 'path');

        for (const param of routeParams) {
            // Common route patterns
            const patterns = [
                `{${param.name.toLowerCase()}}`,
                `{${param.name}}`,
                `:${param.name.toLowerCase()}`,
                `:${param.name}`
            ];

            for (const pattern of patterns) {
                if (processedRoute.includes(pattern)) {
                    processedRoute = processedRoute.replace(pattern, `{${param.name}}`);
                    break;
                }
            }
        }

        return processedRoute;
    }
}