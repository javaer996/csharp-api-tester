import * as vscode from 'vscode';
import { ClassDefinitionCache } from './classDefinitionCache';

export interface ClassProperty {
    name: string;
    type: string;
    required: boolean;
    properties?: ClassProperty[];  // For nested complex types
}

export class CSharpClassParser {
    private cache: ClassDefinitionCache;

    constructor() {
        this.cache = new ClassDefinitionCache(100, 30); // Max 100 entries, 30 min TTL
        console.log('[CSharpClassParser] Initialized with cache');
    }

    /**
     * Extract inner type from generic type
     * Examples: List<User> -> User, Task<ActionResult<Product>> -> Product
     */
    private extractInnerType(type: string): string {
        // Handle nested generics: Task<ActionResult<Product>> -> Product
        const deepGenericMatch = type.match(/<([^<>]+<[^<>]+>)>/);
        if (deepGenericMatch) {
            return this.extractInnerType(deepGenericMatch[1]);
        }

        // Handle simple generics: List<User> -> User
        const genericMatch = type.match(/<([^<>]+)>/);
        if (genericMatch) {
            return genericMatch[1].trim();
        }

        return type;
    }

    /**
     * Parse a C# class definition from the document
     * @param document The text document to search in
     * @param className The name of the class to find
     * @returns Array of class properties, or null if class not found
     */
    parseClassDefinition(document: vscode.TextDocument, className: string): ClassProperty[] | null {
        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        // Check cache first
        const cached = this.cache.get(actualClassName);
        if (cached) {
            return cached.properties;
        }
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[CSharpClassParser] Searching for class: ${actualClassName}`);

        // Find the class definition
        const classLineIndex = this.findClassDefinition(lines, actualClassName);
        if (classLineIndex === -1) {
            console.log(`[CSharpClassParser] Class ${actualClassName} not found in document`);
            return null;
        }

        console.log(`[CSharpClassParser] Found class ${actualClassName} at line ${classLineIndex}`);

        // Extract properties from the class
        const properties = this.extractClassProperties(lines, classLineIndex);
        console.log(`[CSharpClassParser] Extracted ${properties.length} properties from ${actualClassName}`);

        // Cache the result
        if (properties.length > 0) {
            this.cache.set(actualClassName, properties, null, document.uri.fsPath);
        }

        return properties;
    }

    /**
     * Parse a C# class definition from workspace files
     * @param className The name of the class to find
     * @param currentDocument The current document (for relative path resolution)
     * @returns Array of class properties, or null if class not found
     */
    async parseClassDefinitionFromWorkspace(className: string, currentDocument: vscode.TextDocument): Promise<ClassProperty[] | null> {
        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        console.log(`[CSharpClassParser] Searching workspace for class: ${actualClassName}`);

        // Check cache first
        const cached = this.cache.get(actualClassName);
        if (cached) {
            return cached.properties;
        }

        // First, try the current document (fast path)
        const propertiesFromCurrent = this.parseClassDefinition(currentDocument, actualClassName);
        if (propertiesFromCurrent) {
            return propertiesFromCurrent;
        }

        // Search in workspace C# files with improved exclusions
        const files = await vscode.workspace.findFiles(
            '**/*.cs',
            '**/node_modules/**,**/bin/**,**/obj/**,**/.git/**,**/packages/**',
            200 // Increased from 50 to 200
        );
        console.log(`[CSharpClassParser] Found ${files.length} C# files in workspace`);

        for (const fileUri of files) {
            try {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const properties = this.parseClassDefinition(document, actualClassName);
                if (properties) {
                    console.log(`[CSharpClassParser] Found ${actualClassName} in ${fileUri.fsPath}`);
                    return properties;
                }
            } catch (error) {
                console.error(`[CSharpClassParser] Error reading file ${fileUri.fsPath}:`, error);
            }
        }

        console.log(`[CSharpClassParser] Class ${actualClassName} not found in workspace`);
        return null;
    }

    private findClassDefinition(lines: string[], className: string): number {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for class definition: public class ClassName, class ClassName, etc.
            const classRegex = new RegExp(`\\bclass\\s+${className}\\b`);
            if (classRegex.test(line)) {
                return i;
            }
        }
        return -1;
    }

    private extractClassProperties(lines: string[], classLineIndex: number): ClassProperty[] {
        const properties: ClassProperty[] = [];
        let braceCount = 0;
        let inClass = false;
        let currentProperty: { type: string; name: string } | null = null;
        let propertyBraceCount = 0;
        let foundGetOrSet = false;

        // Start from the class line and parse until we exit the class
        for (let i = classLineIndex; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Count braces to track scope
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    if (!inClass) inClass = true;
                }
                if (char === '}') {
                    braceCount--;
                }
            }

            // If we've exited the class, stop
            if (inClass && braceCount === 0) {
                break;
            }

            // Skip comments and attributes
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('///') ||
                trimmedLine.startsWith('[') || trimmedLine.startsWith('*') ||
                trimmedLine === '' || !inClass) {
                continue;
            }

            // Try to parse single-line property first
            const singleLineProperty = this.parseSingleLineProperty(trimmedLine);
            if (singleLineProperty) {
                properties.push(singleLineProperty);
                console.log(`[CSharpClassParser] Found property (single-line): ${singleLineProperty.name} (${singleLineProperty.type})`);
                continue;
            }

            // Handle multi-line properties
            if (currentProperty === null) {
                // Look for property declaration: public Type PropertyName
                const propertyDeclaration = this.parsePropertyDeclaration(trimmedLine);
                if (propertyDeclaration) {
                    currentProperty = propertyDeclaration;
                    propertyBraceCount = 0;
                    foundGetOrSet = false;
                    console.log(`[CSharpClassParser] Started multi-line property: ${propertyDeclaration.name} (${propertyDeclaration.type})`);
                }
            } else {
                // We're parsing a multi-line property
                // Check if this line contains get or set BEFORE counting braces
                const hasGetter = /\bget\b/.test(trimmedLine);
                const hasSetter = /\bset\b/.test(trimmedLine);

                if (hasGetter || hasSetter) {
                    foundGetOrSet = true;
                }

                // Count braces for property scope
                for (const char of trimmedLine) {
                    if (char === '{') propertyBraceCount++;
                    if (char === '}') propertyBraceCount--;
                }

                // Check if property definition is complete
                // Complete when: we found get/set AND property braces are closed
                if (foundGetOrSet && propertyBraceCount <= 0) {
                    const type = currentProperty.type;
                    const name = currentProperty.name;

                    // Determine if the property is required (not nullable)
                    const isNullable = type.includes('?') || type.toLowerCase().includes('nullable');
                    const required = !isNullable;

                    properties.push({
                        name: name,
                        type: this.normalizeType(type),
                        required: required
                    });

                    console.log(`[CSharpClassParser] Found property (multi-line): ${name} (${type})`);
                    currentProperty = null;
                    propertyBraceCount = 0;
                    foundGetOrSet = false;
                }
            }
        }

        return properties;
    }

    /**
     * Parse single-line property: public string Name { get; set; }
     */
    private parseSingleLineProperty(line: string): ClassProperty | null {
        // Pattern: public Type Name { get; set; } [= value;]
        const propertyRegex = /^\s*(?:public|private|protected|internal)?\s+([\w<>?,\[\]\s]+?)\s+(\w+)\s*\{\s*get;?\s*set;?\s*\}(?:\s*=\s*[^;]+)?;?$/i;
        const match = line.match(propertyRegex);

        if (!match) {
            return null;
        }

        const type = match[1].trim();
        const name = match[2];

        // Determine if the property is required (not nullable)
        const isNullable = type.includes('?') || type.toLowerCase().includes('nullable');
        const required = !isNullable;

        return {
            name: name,
            type: this.normalizeType(type),
            required: required
        };
    }

    /**
     * Parse property declaration line: public Type PropertyName
     */
    private parsePropertyDeclaration(line: string): { type: string; name: string } | null {
        // Pattern: public Type PropertyName [{ or nothing]
        // Must have public/private/protected/internal, type, and name
        const declRegex = /^\s*(?:public|private|protected|internal)\s+([\w<>?,\[\]\s]+?)\s+(\w+)\s*(?:\{)?$/i;
        const match = line.match(declRegex);

        if (!match) {
            return null;
        }

        const type = match[1].trim();
        const name = match[2];

        return { type, name };
    }

    private normalizeType(type: string): string {
        // Remove nullable markers
        let normalized = type.replace('?', '');

        // Simplify generic types
        // List<string> -> List, Dictionary<string,int> -> Dictionary
        const genericMatch = normalized.match(/^([^<]+)<(.+)>$/);
        if (genericMatch) {
            const baseType = genericMatch[1];
            const innerType = genericMatch[2];

            // For common collections, keep the inner type info
            if (['List', 'IEnumerable', 'ICollection', 'IList', 'Array'].includes(baseType)) {
                return `${baseType}<${innerType}>`;
            }

            return baseType;
        }

        return normalized;
    }

    /**
     * Get the full class definition as text (including properties and their comments)
     * @param document The text document to search in
     * @param className The name of the class to find
     * @returns The full class definition text, or null if not found
     */
    getClassDefinitionText(document: vscode.TextDocument, className: string): string | null {
        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        // Check cache first
        const cached = this.cache.get(actualClassName);
        if (cached && cached.classDefinition) {
            return cached.classDefinition;
        }

        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[CSharpClassParser] Getting full definition for class: ${actualClassName}`);

        // Find the class definition
        const classLineIndex = this.findClassDefinition(lines, actualClassName);
        if (classLineIndex === -1) {
            console.log(`[CSharpClassParser] Class ${actualClassName} not found in document`);
            return null;
        }

        let braceCount = 0;
        let inClass = false;
        let classDefinition = '';
        let startIndex = Math.max(0, classLineIndex - 10); // Include comments above class

        // Start from before the class line to capture comments
        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i];

            // Add line to definition
            if (i >= classLineIndex - 5) { // Start capturing 5 lines before class
                classDefinition += line + '\n';
            }

            // Count braces only after we reach the class line
            if (i >= classLineIndex) {
                for (const char of line) {
                    if (char === '{') {
                        braceCount++;
                        if (!inClass) inClass = true;
                    }
                    if (char === '}') {
                        braceCount--;
                    }
                }

                // If we've exited the class, stop
                if (inClass && braceCount === 0) {
                    break;
                }
            }
        }

        console.log(`[CSharpClassParser] Captured ${classDefinition.split('\n').length} lines for ${actualClassName}`);

        // Update cache with class definition
        const properties = this.extractClassProperties(lines, classLineIndex);
        this.cache.set(actualClassName, properties, classDefinition.trim(), document.uri.fsPath);

        return classDefinition.trim();
    }

    /**
     * Get the full class definition as text from workspace files
     * @param className The name of the class to find
     * @param currentDocument The current document (for relative path resolution)
     * @returns The full class definition text, or null if not found
     */
    async getClassDefinitionTextFromWorkspace(className: string, currentDocument: vscode.TextDocument): Promise<string | null> {
        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        console.log(`[CSharpClassParser] Getting workspace definition for class: ${actualClassName}`);

        // Check cache first
        const cached = this.cache.get(actualClassName);
        if (cached && cached.classDefinition) {
            return cached.classDefinition;
        }

        // First, try the current document
        const definitionFromCurrent = this.getClassDefinitionText(currentDocument, actualClassName);
        if (definitionFromCurrent) {
            return definitionFromCurrent;
        }

        // Search in workspace C# files
        const files = await vscode.workspace.findFiles(
            '**/*.cs',
            '**/node_modules/**,**/bin/**,**/obj/**,**/.git/**,**/packages/**',
            200
        );

        for (const fileUri of files) {
            try {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const definition = this.getClassDefinitionText(document, actualClassName);
                if (definition) {
                    console.log(`[CSharpClassParser] Found definition for ${actualClassName} in ${fileUri.fsPath}`);
                    return definition;
                }
            } catch (error) {
                console.error(`[CSharpClassParser] Error reading file ${fileUri.fsPath}:`, error);
            }
        }

        console.log(`[CSharpClassParser] Definition for ${actualClassName} not found in workspace`);
        return null;
    }

    /**
     * Check if a type is a simple/primitive type
     */
    isSimpleType(type: string): boolean {
        const simpleTypes = [
            'string', 'int', 'long', 'short', 'byte',
            'uint', 'ulong', 'ushort', 'sbyte',
            'double', 'float', 'decimal',
            'bool', 'DateTime', 'DateTimeOffset',
            'Guid', 'char', 'object'
        ];

        const normalizedType = type.replace('?', '').toLowerCase();
        return simpleTypes.includes(normalizedType) ||
               simpleTypes.some(t => normalizedType === t.toLowerCase());
    }

    /**
     * Get the cache instance for external cache management
     */
    getCache(): ClassDefinitionCache {
        return this.cache;
    }
}
