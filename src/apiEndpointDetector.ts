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
        // Enhanced parameter splitting that handles nested generics, brackets, and parentheses
        const parameters: string[] = [];
        let current = '';
        let angleDepth = 0;    // For <>
        let squareDepth = 0;   // For []
        let parenDepth = 0;    // For ()

        for (let i = 0; i < paramString.length; i++) {
            const char = paramString[i];
            const nextChar = i + 1 < paramString.length ? paramString[i + 1] : '';

            // Track nested structures
            if (char === '<') {
                angleDepth++;
            } else if (char === '>') {
                angleDepth--;
            } else if (char === '[') {
                squareDepth++;
            } else if (char === ']') {
                squareDepth--;
            } else if (char === '(') {
                parenDepth++;
            } else if (char === ')') {
                parenDepth--;
            }

            // Split only at top level (no nested structures)
            if (char === ',' && angleDepth === 0 && squareDepth === 0 && parenDepth === 0) {
                const trimmed = current.trim();
                if (trimmed) {
                    parameters.push(trimmed);
                }
                current = '';
                continue;
            }

            current += char;
        }

        // Add the last parameter if exists
        const lastParam = current.trim();
        if (lastParam) {
            parameters.push(lastParam);
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

        // Step 1: Detect parameter source from explicit From* attributes with enhanced pattern matching
        // Support various formats: [FromBody], [FromBody()], [FromBody(...)], etc.
        if (/\[FromRoute[\(\)\s\w="]*\]/i.test(param)) {
            source = 'path';
            required = true;
            console.log(`[C# API Detector]   ✓ Detected FromRoute attribute`);
        } else if (/\[FromBody[\(\)\s\w="]*\]/i.test(param)) {
            source = 'body';
            required = true;
            console.log(`[C# API Detector]   ✓ Detected FromBody attribute`);
        } else if (/\[FromQuery[\(\)\s\w="]*\]/i.test(param)) {
            source = 'query';
            console.log(`[C# API Detector]   ✓ Detected FromQuery attribute`);
        } else if (/\[FromHeader[\(\)\s\w="]*\]/i.test(param)) {
            source = 'header';
            console.log(`[C# API Detector]   ✓ Detected FromHeader attribute`);
        } else if (/\[FromForm[\(\)\s\w="]*\]/i.test(param)) {
            source = 'form';
            console.log(`[C# API Detector]   ✓ Detected FromForm attribute`);
        } else if (/\[FromServices?[\(\)\s\w="]*\]/i.test(param)) {
            // FromServices typically shouldn't be part of API calls
            console.warn(`[C# API Detector]   ⚠️ FromServices detected - typically not part of API calls`);
            return null;
        }

        // Step 2: Extract parameter name from Name attribute if present
        // Support patterns: [FromQuery(Name = "id")], [FromQuery("id")], [FromQuery], [BindNever]
        const nameAttributeMatch = param.match(/Name\s*=\s*"([^"]+)"/i) || param.match(/Name\s*=\s*'([^']+)'/i);
        if (nameAttributeMatch) {
            name = nameAttributeMatch[1];
            console.log(`[C# API Detector]   ✓ Found Name attribute: "${name}"`);
        }

        // Step 3: Remove all C# attributes to simplify parsing
        // Remove patterns like [FromQuery(...)], [FromBody], [Required], [BindNever], etc.
        let cleanParam = param.replace(/\[[^\[\]]+\]/g, '').trim();
        console.log(`[C# API Detector]   📝 Cleaned parameter: "${cleanParam}"`);

        // Step 4: Enhanced type and variable name extraction
        // Supports: "Type name", "Type? name", "List<Type> name", "Type[] name"
        // Also supports: "ref Type name", "out Type name", "params Type[] name"
        // Remove modifiers first
        cleanParam = cleanParam.replace(/\b(ref|out|in)\b\s+/i, '').trim();
        const isParams = /\bparams\b/i.test(param);

        if (isParams) {
            console.log(`[C# API Detector]   ✓ Detected params parameter`);
        }

        // Match type and variable name with improved regex
        // Handles: TypeName, Type.Name, List<Type>, Type[], Dictionary<K,V>
        const typeAndNameMatch = cleanParam.match(/^([\w<>?,\.\[\]\s]+?)\s+(\w+)(?:\s*=|\s*$)/);

        if (typeAndNameMatch) {
            type = typeAndNameMatch[1].trim();
            const variableName = typeAndNameMatch[2].trim();

            // If name wasn't extracted from Name attribute, use variable name
            if (!name) {
                name = variableName;
            }

            console.log(`[C# API Detector]   ✓ Extracted Type: "${type}", Variable: "${variableName}"`);
        } else {
            // Fallback: try space-based splitting (less reliable but better than nothing)
            console.warn(`[C# API Detector]   ⚠️ Primary regex failed, attempting fallback parsing`);
            const parts = cleanParam.trim().split(/\s+/);
            if (parts.length >= 2) {
                // Last part is name, everything else is type
                const lastPart = parts[parts.length - 1];
                const nameFromParts = lastPart.split('=')[0].trim();

                if (!name) {
                    name = nameFromParts;
                }

                type = parts.slice(0, parts.length - 1).join(' ').trim();
                console.log(`[C# API Detector]   ⚠️ Fallback - Type: "${type}", Name: "${name}"`);
            } else {
                console.error(`[C# API Detector]   ❌ Failed to parse parameter: "${param}"`);
                return null;
            }
        }

        // Step 5: Check if type is nullable (for determining required field)
        const isNullable = type.includes('?');

        // Step 6: Smart source inference if not explicitly specified
        if (!/\[From\w+/i.test(param)) {
            const inferredSource = this.inferParameterSource(type, name, param);
            source = inferredSource.source;
            required = inferredSource.required;
            console.log(`[C# API Detector]   🔄 Inferred source: ${source} (reason: ${inferredSource.reason})`);
        } else if (source === 'query') {
            // For query parameters, check if nullable determines required
            required = !isNullable;
        } else if (source === 'body' || source === 'path') {
            // Body and path parameters are typically required
            required = true;
        }

        const apiParam: ApiParameter = {
            name: name,
            type: type,
            source: source,
            required: required
        };

        console.log(`[C# API Detector]   ✅ Final Result: name="${name}", type="${type}", source="${source}", required=${required}`);

        // ⚡ OPTIMIZATION: Do NOT parse class definitions here!
        // Parsing will be done lazily in ApiTestPanel when user clicks "Test API"
        // This dramatically improves CodeLens performance

        return apiParam;
    }

    /**
     * Intelligently infer parameter source based on type and parameter name
     * when explicit [From*] attributes are not present
     */
    private inferParameterSource(type: string, paramName: string, fullParamText: string): { source: 'path' | 'query' | 'body' | 'header' | 'form', required: boolean, reason: string } {
        const cleanType = type.replace(/\?/g, '').replace(/\[\]/g, '').trim();
        const lowerName = paramName.toLowerCase();
        const lowerType = cleanType.toLowerCase();

        // Check for file upload types
        if (this.isFileType(cleanType)) {
            return {
                source: 'form',
                required: true,
                reason: 'File type detected (IFormFile)'
            };
        }

        // Path parameter detection based on parameter name
        if (lowerName === 'id' ||
            lowerName.endsWith('id') ||
            lowerName.includes('identifier') ||
            lowerName.includes('key') ||
            lowerName.includes('code') ||
            lowerName === 'slug') {
            return {
                source: 'path',
                required: true,
                reason: `Parameter name suggests path parameter (${paramName})`
            };
        }

        // Form parameter detection
        if (lowerType.includes('iformdata') || lowerType.includes('form')) {
            return {
                source: 'form',
                required: true,
                reason: 'Form data type detected'
            };
        }

        // Header parameter detection
        if (lowerName.includes('header') ||
            lowerName.includes('authorization') ||
            lowerName.includes('token')) {
            return {
                source: 'header',
                required: false,
                reason: 'Parameter name suggests header parameter'
            };
        }

        // Query parameter detection for simple types
        const isSimple = this.isSimpleType(cleanType);
        const isNullable = type.includes('?');
        const hasDefaultValue = /=\s*[^=]+/.test(fullParamText);

        if (isSimple) {
            // Simple types without ID-like names are typically query parameters
            const reason = isNullable || hasDefaultValue
                ? 'Simple nullable type with default value → query parameter'
                : 'Simple type → query parameter';

            return {
                source: 'query',
                required: !isNullable && !hasDefaultValue,
                reason: reason
            };
        }

        // Complex types (DTOs, models) are typically body parameters
        return {
            source: 'body',
            required: true,
            reason: 'Complex type → body parameter'
        };
    }

    /**
     * Check if a type represents file upload
     */
    private isFileType(type: string): boolean {
        const fileTypes = [
            'iformfile',
            'iformfilecollection',
            'stream',
            'byte[]'
        ];

        const cleanType = type.toLowerCase().replace(/\?/g, '').replace(/\[\]/g, '');
        return fileTypes.some(ft => cleanType.includes(ft));
    }

    private isSimpleType(type: string): boolean {
        // Remove nullable suffix, array notation, and trim whitespace
        const cleanType = type.replace(/\?/g, '').replace(/\[\]/g, '').trim().toLowerCase();

        // More comprehensive list of C# simple types
        const simpleTypes = [
            // Numeric types
            'byte', 'sbyte',
            'short', 'ushort',
            'int', 'int32', 'uint', 'uint32',
            'long', 'ulong',
            'float', 'double', 'decimal',
            // Other built-in types
            'bool', 'boolean',
            'char',
            'string',
            'object',
            'DateTime', 'DateTimeOffset', 'DateOnly', 'TimeOnly', 'TimeSpan',
            'Guid',
            'enum'
        ];

        // Check exact match
        if (simpleTypes.includes(cleanType)) {
            return true;
        }

        // Check if it's a nullable value type (e.g., int?, bool?, decimal?)
        if (cleanType.includes('?')) {
            const underlyingType = cleanType.replace('?', '');
            return simpleTypes.includes(underlyingType);
        }

        // Check for numeric types with precision (SQL types)
        if (/^(int|bigint|smallint|tinyint|money|smallmoney|numeric|real)\b/i.test(cleanType)) {
            return true;
        }

        return false;
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