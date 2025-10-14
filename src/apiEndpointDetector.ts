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
    classDefinition?: string;      // Full class definition with comments
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

    async detectApiEndpoints(document: vscode.TextDocument): Promise<ApiEndpointInfo[]> {
        const endpoints: ApiEndpointInfo[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[C# API Detector] Analyzing controller file: ${document.fileName}`);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for controller class
            if (this.isControllerClass(line)) {
                const controllerInfo = this.parseController(line);
                const controllerRoute = this.extractControllerRoute(lines, i);
                console.log(`[C# API Detector] Found controller '${controllerInfo.name}' with route '${controllerRoute}'`);

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

                    if (this.hasHttpMethodAttribute(trimmedLine)) {
                        const methodInfo = await this.parseApiMethod(document, lines, j, controllerInfo, controllerRoute);
                        if (methodInfo) {
                            endpoints.push(methodInfo);
                        }
                    }
                    j++;
                }
            }
        }

        console.log(`[C# API Detector] ✅ Found ${endpoints.length} endpoints`);
        return endpoints;
    }

    private isControllerClass(line: string): boolean {
        const hasClassKeyword = line.includes('class');
        const hasControllerPattern = /Controller/.test(line);
        return hasClassKeyword && hasControllerPattern;
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
                break;
            }
        }

        return controllerRoute;
    }

    private hasHttpMethodAttribute(line: string): boolean {
        return this.httpMethodAttributes.some(attr => line.includes(`[${attr}`));
    }

    private async parseApiMethod(document: vscode.TextDocument, lines: string[], startLine: number, controllerInfo: any, controllerRoute: string): Promise<ApiEndpointInfo | null> {
        let currentLine = startLine;
        let httpMethod = '';
        let routeTemplate = '';
        let methodSignature = '';
        let methodName = '';
        let returnType = '';

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
        const parameters = await this.parseParameters(document, methodSignature);

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

    private async parseParameters(document: vscode.TextDocument, methodSignature: string): Promise<ApiParameter[]> {
        const parameters: ApiParameter[] = [];

        // Extract parameter list
        const paramMatch = methodSignature.match(/\(([^)]+)\)/);
        if (!paramMatch) {
            return parameters;
        }

        const paramString = paramMatch[1];
        const paramList = this.splitParameters(paramString);

        for (const param of paramList) {
            const paramInfo = await this.parseSingleParameter(document, param.trim());
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

    private async parseSingleParameter(document: vscode.TextDocument, param: string): Promise<ApiParameter | null> {
        console.log(`[C# API Detector] 🔍 Parsing parameter: "${param}"`);

        // Parse parameter with potential attributes
        let type = '';
        let name = '';
        let source: 'path' | 'query' | 'body' | 'header' | 'form' = 'query';
        let required = false;

        // Step 1: Detect parameter source from attributes
        if (param.includes('[FromRoute]')) {
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
        }

        // Step 2: Extract parameter name from Name attribute if present
        // e.g., [FromQuery(Name = "id")] long id -> name should be "id"
        const attributeNameMatch = param.match(/Name\s*=\s*"(\w+)"/);
        if (attributeNameMatch) {
            name = attributeNameMatch[1];
            console.log(`[C# API Detector]   ✓ Found Name attribute: "${name}"`);
        }

        // Step 3: Remove all attributes to simplify parsing
        // Remove patterns like [FromQuery(...)], [FromBody], [Authorize(...)]
        let cleanParam = param.replace(/\[[^\]]+\]/g, '').trim();
        console.log(`[C# API Detector]   📝 Clean param: "${cleanParam}"`);

        // Step 4: Extract type and variable name
        // Supports: "Type name", "Type? name", "List<Type> name", "List<Type>? name", "Type[] name"
        // Match pattern: (Type) (variableName) [= defaultValue]
        const typeAndNameMatch = cleanParam.match(/^([\w<>?,\[\]\s]+?)\s+(\w+)(?:\s*=|\s*$)/);

        if (typeAndNameMatch) {
            type = typeAndNameMatch[1].trim();
            const variableName = typeAndNameMatch[2].trim();

            // If name wasn't extracted from attribute, use variable name
            if (!name) {
                name = variableName;
            }

            console.log(`[C# API Detector]   ✓ Type: "${type}", Variable: "${variableName}"`);
        } else {
            // Fallback: try simple space split
            const parts = cleanParam.trim().split(/\s+/);
            if (parts.length >= 2) {
                // Last part is name, everything else is type
                const lastPart = parts[parts.length - 1];
                // Remove default value if present (e.g., "id = 0" -> "id")
                const nameFromParts = lastPart.split('=')[0].trim();

                if (!name) {
                    name = nameFromParts;
                }

                type = parts.slice(0, parts.length - 1).join(' ').trim();
                console.log(`[C# API Detector]   ⚠️ Fallback parse - Type: "${type}", Name: "${name}"`);
            } else {
                console.log(`[C# API Detector]   ❌ Failed to parse parameter: "${param}"`);
                return null;
            }
        }

        // Step 5: Check if type is nullable (for determining required field)
        const isNullable = type.includes('?');

        // Step 6: If source wasn't determined from attribute, infer from type
        if (!param.includes('[From')) {
            const baseType = type.replace(/\?/g, '').replace(/\[\]/g, '').replace(/<.*>/g, '').trim();

            if (this.isSimpleType(baseType)) {
                source = 'query';
                required = !isNullable;
            } else {
                source = 'body';
                required = true;
            }
            console.log(`[C# API Detector]   🔄 Inferred source: ${source} (baseType: ${baseType})`);
        } else if (source === 'query') {
            required = !isNullable;
        }

        const apiParam: ApiParameter = {
            name: name,
            type: type,
            source: source,
            required: required
        };

        console.log(`[C# API Detector]   ✅ Result: name="${name}", type="${type}", source="${source}", required=${required}`);

        // ⚡ OPTIMIZATION: Do NOT parse class definitions here!
        // Parsing will be done lazily in ApiTestPanel when user clicks "Test API"
        // This dramatically improves CodeLens performance

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

    /**
     * Get the class parser instance for external access (e.g., cache management)
     */
    getClassParser(): CSharpClassParser {
        return this.classParser;
    }
}