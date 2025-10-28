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
    parseClassDefinition(document: vscode.TextDocument, className: string, parsedClasses: Set<string> = new Set()): ClassProperty[] | null {
        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        // Prevent infinite recursion
        if (parsedClasses.has(actualClassName)) {
            console.log(`[CSharpClassParser] 🔄 Skipping already parsed class: ${actualClassName}`);
            return [];
        }

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

        // Add to parsed set to prevent infinite recursion
        parsedClasses.add(actualClassName);

        // Extract base class name from class definition
        const classDefinitionLine = lines[classLineIndex].trim();
        const baseClassName = this.extractBaseClassName(classDefinitionLine);

        let allProperties: ClassProperty[] = [];

        // If there's a base class, recursively parse it first
        if (baseClassName && !this.isSimpleType(baseClassName)) {
            console.log(`[CSharpClassParser] 🧬 Found base class: ${baseClassName}`);
            const baseClassProperties = this.parseClassDefinition(document, baseClassName, parsedClasses);
            if (baseClassProperties && baseClassProperties.length > 0) {
                console.log(`[CSharpClassParser]   ✅ Extracted ${baseClassProperties.length} properties from base class`);
                allProperties = [...baseClassProperties];
            }
        }

        // Extract properties from the current class
        const currentClassProperties = this.extractClassProperties(lines, classLineIndex);
        console.log(`[CSharpClassParser] Extracted ${currentClassProperties.length} properties from ${actualClassName}`);

        // Merge properties: current class properties override base class properties with the same name
        const propertyMap = new Map<string, ClassProperty>();

        // First, add all base class properties
        for (const prop of allProperties) {
            propertyMap.set(prop.name, prop);
        }

        // Then, add current class properties (overriding any duplicate names)
        for (const prop of currentClassProperties) {
            propertyMap.set(prop.name, prop);
            if (allProperties.some(p => p.name === prop.name)) {
                console.log(`[CSharpClassParser]   🔄 Property '${prop.name}' overridden in ${actualClassName}`);
            }
        }

        // Convert back to array
        allProperties = Array.from(propertyMap.values());
        console.log(`[CSharpClassParser] Total properties (including inherited, with overrides): ${allProperties.length}`);

        // Cache the result
        if (allProperties.length > 0) {
            this.cache.set(actualClassName, allProperties, null, document.uri.fsPath);
        }

        return allProperties;
    }

    /**
     * Extract using statements from a document
     * @param document The document to extract using statements from
     * @returns Array of namespace strings
     */
    private extractUsingStatements(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const lines = text.split('\n');
        const usings: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            // Match: using Namespace.SubNamespace;
            const usingMatch = trimmed.match(/^using\s+([\w\.]+)\s*;/);
            if (usingMatch) {
                usings.push(usingMatch[1]);
            }

            // Stop when we reach the first class/namespace declaration
            if (trimmed.startsWith('namespace ') || trimmed.includes('class ')) {
                break;
            }
        }

        console.log(`[CSharpClassParser] 📋 Extracted ${usings.length} using statements: [${usings.join(', ')}]`);
        return usings;
    }

    /**
     * Get search file limit based on configured strategy
     * @param pattern The search pattern to get limit for
     * @returns The maximum number of files to search
     */
    private getSearchFileLimit(pattern?: string): number {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        const strategy = config.get<string>('searchStrategy', 'balanced');

        // For specific patterns (non-global), use smaller limit
        if (pattern && pattern !== '**/*.cs') {
            return 200;
        }

        switch (strategy) {
            case 'fast':
                return 500;
            case 'balanced':
                return 1000;
            case 'thorough':
                return 2000;
            case 'custom':
                return config.get<number>('searchFileLimit', 2000);
            default:
                return 1000;
        }
    }

    /**
     * Generate search patterns based on using statements and class name
     * @param className The class name to search for
     * @param usingStatements Array of namespace strings
     * @returns Array of glob patterns to search
     */
    private generateSearchPatterns(className: string, usingStatements: string[]): string[] {
        const patterns: string[] = [];

        // Pattern 1: Direct class file name match (most common)
        patterns.push(`**/${className}.cs`);

        // Pattern 2: Based on using statements, generate namespace-based paths
        for (const namespace of usingStatements) {
            // Convert namespace to path: Fy.Hospital.Mobile.Model.VM -> **/Fy.Hospital.Mobile.Model/VM/**/${className}.cs
            const pathParts = namespace.split('.');

            // Try full namespace path
            patterns.push(`**/${pathParts.join('/')}/**/${className}.cs`);

            // Try last 2 segments (e.g., Model/VM)
            if (pathParts.length >= 2) {
                const lastTwo = pathParts.slice(-2).join('/');
                patterns.push(`**/${lastTwo}/**/${className}.cs`);
            }

            // Try last segment (e.g., VM)
            if (pathParts.length >= 1) {
                const lastOne = pathParts[pathParts.length - 1];
                patterns.push(`**/${lastOne}/**/${className}.cs`);
            }
        }

        // Pattern 3: Global C# file search - search all .cs files as a fallback
        patterns.push(`**/*.cs`);

        // Remove duplicates
        const uniquePatterns = Array.from(new Set(patterns));
        console.log(`[CSharpClassParser] 🔍 Generated ${uniquePatterns.length} search patterns for ${className}`);
        return uniquePatterns;
    }

    /**
     * Search for a class file using intelligent patterns based on using statements
     * @param className The class name to find
     * @param currentDocument Current document to extract using statements from
     * @returns The found document, or null if not found
     */
    private async findClassFileByUsing(className: string, currentDocument: vscode.TextDocument): Promise<vscode.TextDocument | null> {
        // Extract using statements from current document
        const usingStatements = this.extractUsingStatements(currentDocument);

        // Generate search patterns
        const patterns = this.generateSearchPatterns(className, usingStatements);

        // Track whether we found the class
        let found = false;

        // Search using each pattern until we find the class
        for (const pattern of patterns) {
            console.log(`[CSharpClassParser]   🔍 Trying pattern: ${pattern}`);

            // Get file limit for this pattern
            const fileLimit = this.getSearchFileLimit(pattern);
            console.log(`[CSharpClassParser]     Using search limit: ${fileLimit} files`);

            try {
                // For global patterns like **/*.cs, use optimized exclusions
                const isGlobalPattern = pattern === '**/*.cs';
                const excludePattern = isGlobalPattern
                    ? '**/node_modules/**,**/bin/**,**/obj/**,**/.git/**,**/packages/**,**/test/**,**/tests/**,**/Test/**,**/Tests/**,**/__tests__/**'
                    : '**/node_modules/**,**/bin/**,**/obj/**,**/.git/**,**/packages/**';

                const files = await vscode.workspace.findFiles(
                    pattern,
                    excludePattern,
                    fileLimit
                );

                console.log(`[CSharpClassParser]     Found ${files.length} files matching pattern`);

                // If we hit the limit, warn the user
                if (files.length >= fileLimit && isGlobalPattern) {
                    const config = vscode.workspace.getConfiguration('csharpApiTester');
                    const strategy = config.get<string>('searchStrategy', 'balanced');
                    console.warn(`[CSharpClassParser]   ⚠️ Reached search limit of ${fileLimit} files. Class not found. Consider changing searchStrategy to 'thorough' or 'custom'.`);
                }

                // If no files found and this is a global search, skip to next pattern
                if (files.length === 0 && isGlobalPattern) {
                    console.log(`[CSharpClassParser]     ⏭️ No .cs files found in global search, skipping...`);
                    continue;
                }

                // Check each file to see if it contains the class
                let checkedCount = 0;
                for (const fileUri of files) {
                    checkedCount++;
                    try {
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        const text = document.getText();

                        // Quick check: does this file contain the class definition?
                        const classRegex = new RegExp(`\\bclass\\s+${className}\\b`);
                        if (classRegex.test(text)) {
                            console.log(`[CSharpClassParser]     ✅ Found ${className} in ${fileUri.fsPath} (checked ${checkedCount}/${files.length} files)`);
                            found = true;
                            return document;
                        }
                    } catch (fileError) {
                        console.error(`[CSharpClassParser]     ⚠️ Error reading file ${fileUri.fsPath}:`, fileError);
                        continue;
                    }
                }

                console.log(`[CSharpClassParser]     Checked ${checkedCount} files, class not found`);
            } catch (searchError) {
                console.error(`[CSharpClassParser]   ❌ Error searching with pattern ${pattern}:`, searchError);
                continue;
            }

            // If we found the class, break out of the loop
            if (found) {
                break;
            }
        }

        console.log(`[CSharpClassParser] ❌ Class ${className} not found in any file`);
        return null;
    }

    /**
     * Parse a C# class definition from workspace files
     * @param className The name of the class to find
     * @param currentDocument The current document (for relative path resolution)
     * @param recursive Whether to recursively parse nested complex types (default: true)
     * @param parsedClasses Set of already parsed classes to prevent infinite recursion
     * @param depth Current recursion depth (for safety)
     * @returns Array of class properties, or null if class not found
     */
    async parseClassDefinitionFromWorkspace(
        className: string,
        currentDocument: vscode.TextDocument,
        recursive: boolean = true,
        parsedClasses: Set<string> = new Set(),
        depth: number = 0
    ): Promise<ClassProperty[] | null> {
        // Safety limit: max recursion depth
        const MAX_DEPTH = 10;
        if (depth >= MAX_DEPTH) {
            console.log(`[CSharpClassParser] ⚠️ Max recursion depth (${MAX_DEPTH}) reached for ${className}`);
            return null;
        }

        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        // Skip simple types
        if (this.isSimpleType(actualClassName)) {
            return null;
        }

        // Prevent infinite recursion
        if (parsedClasses.has(actualClassName)) {
            console.log(`[CSharpClassParser] 🔄 Skipping already parsed class: ${actualClassName}`);
            return null;
        }

        console.log(`[CSharpClassParser] Searching workspace for class: ${actualClassName} (depth: ${depth}, recursive: ${recursive})`);

        // Add to parsed set
        parsedClasses.add(actualClassName);

        // First, try the current document (fast path)
        let properties = this.parseClassDefinition(currentDocument, actualClassName);
        if (properties && properties.length > 0) {
            // Recursively parse nested complex types if enabled
            if (recursive) {
                console.log(`[CSharpClassParser] 🔄 Starting recursive parsing for ${actualClassName}`);
                await this.parseNestedComplexTypes(properties, currentDocument, parsedClasses, depth + 1);
            }
            return properties;
        }

        // Use intelligent search based on using statements
        console.log(`[CSharpClassParser] 🎯 Starting intelligent search based on using statements...`);
        const foundDocument = await this.findClassFileByUsing(actualClassName, currentDocument);

        if (foundDocument) {
            properties = this.parseClassDefinition(foundDocument, actualClassName);
            if (properties && properties.length > 0) {
                console.log(`[CSharpClassParser] ✅ Found ${actualClassName} with ${properties.length} properties via intelligent search`);

                // Recursively parse nested complex types if enabled
                if (recursive) {
                    console.log(`[CSharpClassParser] 🔄 Starting recursive parsing for ${actualClassName}`);
                    await this.parseNestedComplexTypes(properties, foundDocument, parsedClasses, depth + 1);
                }

                return properties;
            }
        }

        console.log(`[CSharpClassParser] ❌ Class ${actualClassName} not found via using-based search`);
        return null;
    }

    /**
     * Recursively parse nested complex types in properties
     * @param properties Array of properties to analyze
     * @param currentDocument Current document for searching
     * @param parsedClasses Set of already parsed classes
     * @param depth Current recursion depth
     */
    private async parseNestedComplexTypes(
        properties: ClassProperty[],
        currentDocument: vscode.TextDocument,
        parsedClasses: Set<string>,
        depth: number
    ): Promise<void> {
        console.log(`[CSharpClassParser] 🔍 parseNestedComplexTypes called with ${properties.length} properties at depth ${depth}`);
        console.log(`[CSharpClassParser] 📋 parsedClasses contains: [${Array.from(parsedClasses).join(', ')}]`);

        // Build a map to store parsed results for reuse
        const parsedResults = new Map<string, ClassProperty[]>();

        for (const prop of properties) {
            // Extract the actual type (handle List<T>, IEnumerable<T>, T[], T?, etc.)
            const baseType = this.extractBaseType(prop.type);

            console.log(`[CSharpClassParser]   - Property ${prop.name} (type: ${prop.type}, baseType: ${baseType})`);

            // Skip if it's a simple type
            if (this.isSimpleType(baseType)) {
                console.log(`[CSharpClassParser]     ✓ Skipped (simple type)`);
                continue;
            }

            // Check if we already parsed this type in this batch
            if (parsedResults.has(baseType)) {
                console.log(`[CSharpClassParser]     ♻️ Reusing already parsed results for ${baseType}`);
                prop.properties = parsedResults.get(baseType)!;
                console.log(`[CSharpClassParser]     ✅ Reused ${prop.properties.length} properties for ${prop.name}`);
                continue;
            }

            // Skip if already parsed in previous recursion levels (prevent infinite loops)
            if (parsedClasses.has(baseType)) {
                console.log(`[CSharpClassParser]     ⏭️ Skipped ${baseType} (already in parsedClasses, prevents circular reference)`);
                continue;
            }

            console.log(`[CSharpClassParser]     🔄 Recursively parsing ${baseType}...`);

            // Recursively parse the nested type
            const nestedProperties = await this.parseClassDefinitionFromWorkspace(
                baseType,
                currentDocument,
                true,
                parsedClasses,
                depth
            );

            // Attach nested properties to the property and cache for reuse
            if (nestedProperties && nestedProperties.length > 0) {
                prop.properties = nestedProperties;
                parsedResults.set(baseType, nestedProperties);  // Cache for reuse in this batch
                console.log(`[CSharpClassParser]     ✅ Attached ${nestedProperties.length} nested properties to ${prop.name}`);
            } else {
                console.log(`[CSharpClassParser]     ⚠️ WARNING: No nested properties found for ${baseType} in ${prop.name}!`);
            }
        }

        console.log(`[CSharpClassParser] ✅ parseNestedComplexTypes completed for ${properties.length} properties`);
    }

    /**
     * Extract base type from complex types (List<T>, T[], T?, etc.)
     */
    private extractBaseType(type: string): string {
        // Remove nullable marker
        let baseType = type.replace('?', '');

        // Handle array types: User[] -> User
        if (baseType.endsWith('[]')) {
            return baseType.slice(0, -2);
        }

        // Handle generic types: List<User>, IEnumerable<Product>, etc.
        const genericMatch = baseType.match(/<(.+)>/);
        if (genericMatch) {
            return genericMatch[1].trim();
        }

        return baseType;
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

    /**
     * Extract base class name from class definition line
     * @param classDefinitionLine The class definition line (e.g., "public class UpdateProductDto : BaseDto")
     * @returns The base class name, or null if no base class
     */
    private extractBaseClassName(classDefinitionLine: string): string | null {
        // Match patterns like:
        // "public class UpdateProductDto : BaseDto"
        // "class ProductDto : Entity<int>"
        // "public class CreateProductDto : ProductDto"
        const baseClassMatch = classDefinitionLine.match(/:\s*([\w\.]+)/);
        if (baseClassMatch) {
            let baseClassName = baseClassMatch[1].trim();

            // Remove generic type parameters, e.g., "Entity<int>" -> "Entity"
            baseClassName = baseClassName.replace(/<[^>]+>/g, '').trim();

            // Skip System.Object and its aliases
            if (baseClassName.toLowerCase() === 'object') {
                return null;
            }

            return baseClassName;
        }
        return null;
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
            console.log(`[CSharpClassParser] ✅ Cache hit for ${actualClassName} definition`);
            return cached.classDefinition;
        }

        // First, try the current document
        const definitionFromCurrent = this.getClassDefinitionText(currentDocument, actualClassName);
        if (definitionFromCurrent) {
            return definitionFromCurrent;
        }

        // Use intelligent search based on using statements
        console.log(`[CSharpClassParser] 🎯 Starting intelligent search for class definition using using statements...`);
        const foundDocument = await this.findClassFileByUsing(actualClassName, currentDocument);

        if (foundDocument) {
            const definition = this.getClassDefinitionText(foundDocument, actualClassName);
            if (definition) {
                console.log(`[CSharpClassParser] ✅ Found definition for ${actualClassName} via intelligent search`);
                return definition;
            }
        }

        console.log(`[CSharpClassParser] ❌ Definition for ${actualClassName} not found via using-based search`);
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
