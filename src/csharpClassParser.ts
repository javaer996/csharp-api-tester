import * as vscode from 'vscode';
import { ClassDefinitionCache } from './classDefinitionCache';

export interface ClassProperty {
    name: string;
    type: string;
    required: boolean;
    properties?: ClassProperty[];  // For nested complex types
    _baseClassWarning?: string;  // Warning message when base class parsing fails
}

export interface EnumInfo {
    isEnum: true;
    firstValue: string;
    allValues: string[];
}

export class CSharpClassParser {
    private cache: ClassDefinitionCache;
    private fileClassCache: Map<string, Set<string>>; // filePath -> Set of class names in that file
    private fileLinesCache: Map<string, string[]>; // ⭐ NEW: Cache document lines to avoid repeated getText() and split()

    constructor() {
        this.cache = new ClassDefinitionCache(100, 30); // Max 100 entries, 30 min TTL
        this.fileClassCache = new Map();
        this.fileLinesCache = new Map();
        console.log('[CSharpClassParser] Initialized with cache and file-level class cache');
    }

    /**
     * Get document lines with caching to avoid repeated getText() and split() operations
     * @param document The document to get lines from
     * @returns Array of lines
     */
    private getDocumentLines(document: vscode.TextDocument): string[] {
        const filePath = document.uri.fsPath;

        // Check cache first
        if (this.fileLinesCache.has(filePath)) {
            return this.fileLinesCache.get(filePath)!;
        }

        // Cache miss: read and split
        const text = document.getText();
        const lines = text.split('\n');

        // Cache for future use
        this.fileLinesCache.set(filePath, lines);
        console.log(`[CSharpClassParser] 💾 Cached ${lines.length} lines from ${filePath}`);

        return lines;
    }

    /**
     * Extract all class and enum names from a document
     * @param document The document to scan
     * @returns Set of type names found in the document
     */
    private extractAllClassNamesFromDocument(document: vscode.TextDocument): Set<string> {
        const lines = this.getDocumentLines(document);
        const typeNames = new Set<string>();

        let braceCount = 0;
        let inClass = false;
        let currentOuterClass = '';

        // Scan line by line to properly handle nested classes
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Match class definitions: public class ClassName, class ClassName : BaseClass, etc.
            const classMatch = line.match(/\bclass\s+(\w+)/);
            if (classMatch) {
                const className = classMatch[1];

                if (braceCount > 0 && currentOuterClass) {
                    // This is a nested class
                    const nestedClassName = `${currentOuterClass}.${className}`;
                    typeNames.add(nestedClassName);
                    console.log(`[CSharpClassParser] 📄 Found nested class: ${nestedClassName}`);
                } else {
                    // This is a top-level class
                    typeNames.add(className);
                    currentOuterClass = className;
                    inClass = true;
                    console.log(`[CSharpClassParser] 📄 Found top-level class: ${className}`);
                }
            }

            // Track braces to identify class scope (check after class definition)
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                }
                if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        inClass = false;
                        currentOuterClass = '';
                    }
                }
            }

            // Match all enum definitions: public enum EnumName, enum EnumName, etc.
            const enumMatch = line.match(/\benum\s+(\w+)/);
            if (enumMatch) {
                const enumName = enumMatch[1];
                typeNames.add(enumName);
                console.log(`[CSharpClassParser] 📄 Found enum: ${enumName}`);
            }
        }

        console.log(`[CSharpClassParser] 📄 Extracted ${typeNames.size} type names from ${document.uri.fsPath}: [${Array.from(typeNames).join(', ')}]`);
        return typeNames;
    }

    /**
     * Check if a class exists in the file-level cache
     * @param className The class name to check
     * @returns The file path if found, null otherwise
     */
    private findClassInFileCache(className: string): string | null {
        for (const [filePath, classNames] of this.fileClassCache.entries()) {
            if (classNames.has(className)) {
                console.log(`[CSharpClassParser] 🎯 File cache hit! ${className} found in ${filePath}`);
                return filePath;
            }

            // ⭐ NESTED CLASS SUPPORT: For nested classes, also check if this file contains the outer class
            if (className.includes('.')) {
                const parts = className.split('.');
                if (parts.length === 2) {
                    const [outerClass, innerClass] = parts;
                    // Check if this file contains both the outer and inner classes
                    if (classNames.has(outerClass) && classNames.has(innerClass)) {
                        console.log(`[CSharpClassParser] 🎯 File cache hit! Nested class ${className} found in ${filePath} (contains both ${outerClass} and ${innerClass})`);
                        return filePath;
                    }
                }
            }
        }
        return null;
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
    async parseClassDefinition(document: vscode.TextDocument, className: string, parsedClasses: Set<string> = new Set()): Promise<ClassProperty[] | null> {
        // Extract inner type if generic
        const actualClassName = this.extractInnerType(className);

        // Prevent infinite recursion
        if (parsedClasses.has(actualClassName)) {
            console.log(`[CSharpClassParser] 🔄 Skipping already parsed class: ${actualClassName}`);
            return [];
        }

        // Check cache first - but don't return yet, we need to verify it includes base class properties
        const cached = this.cache.get(actualClassName);
        if (cached) {
            console.log(`[CSharpClassParser] 🎯 Cache HIT for ${actualClassName}, found ${cached.properties.length} properties`);
            // We'll verify if we need to reparse after checking for base classes
        }

        // ⭐ PERFORMANCE: Use cached lines instead of repeated getText() and split()
        const lines = this.getDocumentLines(document);

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
        let baseClassWarning: string | undefined = undefined;

        // If there's a base class, recursively parse it first using the same search logic as main classes
        if (baseClassName && !this.isSimpleType(baseClassName)) {
            console.log(`[CSharpClassParser] 🧬 Found base class: ${baseClassName}`);

            // ⭐ CRITICAL: Use the same search logic as main classes (not just current document)
            // Create a copy of parsedClasses to avoid contamination
            const baseClassParsedClasses = new Set(parsedClasses);
            const baseClassProperties = await this.parseClassDefinitionFromWorkspace(
                baseClassName,
                document,
                false, // Don't recursively parse base classes' nested types for performance
                baseClassParsedClasses,
                0,
                undefined, // No lastFoundDocument for base classes
                document // Use current document as hint
            );

            if (baseClassProperties && baseClassProperties.length > 0) {
                console.log(`[CSharpClassParser]   ✅ Extracted ${baseClassProperties.length} properties from base class using workspace search`);
                allProperties = [...baseClassProperties];
            } else {
                // Base class parsing failed - record warning
                console.warn(`[CSharpClassParser] ⚠️ WARNING: Base class '${baseClassName}' not found for '${actualClassName}' - inherited properties will be missing!`);
                baseClassWarning = `父类 '${baseClassName}' 未在工作区找到`;
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

        // Attach base class warning to the first property if warning exists
        if (baseClassWarning && allProperties.length > 0) {
            allProperties[0]._baseClassWarning = baseClassWarning;
        }

        // Decide whether to use cached result or new result
        if (cached) {
            // If new parse found more properties (including base class properties), use the new result
            if (allProperties.length > cached.properties.length) {
                console.log(`[CSharpClassParser] 🔄 Cache OUTDATED: cached had ${cached.properties.length} properties, but new parse found ${allProperties.length} properties (likely including base class). Updating cache.`);
                this.cache.set(actualClassName, allProperties, null, document.uri.fsPath);
                return allProperties;
            } else {
                // Cache is complete, use cached result
                console.log(`[CSharpClassParser] ✅ Cache is complete (${cached.properties.length} properties), using cached result`);
                return cached.properties;
            }
        } else {
            // No cache, store new result
            if (allProperties.length > 0) {
                console.log(`[CSharpClassParser] 💾 Caching ${actualClassName} with ${allProperties.length} properties (including base classes)`);
                this.cache.set(actualClassName, allProperties, null, document.uri.fsPath);
            }
            return allProperties;
        }
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
     * Ensure the file-level class cache is populated for a document
     * @param document Document whose classes should be cached
     * @returns Set of class names discovered in the document
     */
    private ensureDocumentClassCache(document: vscode.TextDocument): Set<string> {
        const filePath = document.uri.fsPath;

        if (this.fileClassCache.has(filePath)) {
            return this.fileClassCache.get(filePath)!;
        }

        const allClassNames = this.extractAllClassNamesFromDocument(document);
        this.fileClassCache.set(filePath, allClassNames);
        console.log(`[CSharpClassParser] 💾 Populated class cache for ${filePath} with ${allClassNames.size} entries`);
        return allClassNames;
    }

    /**
     * Get search file limit based on configured strategy and pattern type
     * @param pattern The search pattern to get limit for
     * @param patternType The type of pattern (direct, using_precise, using_fuzzy, global)
     * @returns The maximum number of files to search
     */
    private getSearchFileLimit(pattern?: string, patternType?: 'direct' | 'using_precise' | 'using_fuzzy' | 'global'): number {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        const strategy = config.get<string>('searchStrategy', 'balanced');

        // Gradual limits based on pattern specificity
        if (patternType === 'direct') {
            // Direct file name match - very specific, small limit is fine
            return 50;
        } else if (patternType === 'using_precise') {
            // Full namespace path - quite specific
            return 200;
        } else if (patternType === 'using_fuzzy') {
            // Partial namespace path - moderately specific
            return 300;
        } else if (patternType === 'global' || pattern === '**/*.cs') {
            // Global search - needs larger limit
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

        // Fallback: For specific patterns (non-global), use smaller limit
        if (pattern && pattern !== '**/*.cs') {
            return 200;
        }

        // Default to balanced strategy
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
     * @returns Array of pattern objects with type information
     */
    private generateSearchPatterns(className: string, usingStatements: string[]): Array<{pattern: string, type: 'direct' | 'using_precise' | 'using_fuzzy' | 'global'}> {
        const patterns: Array<{pattern: string, type: 'direct' | 'using_precise' | 'using_fuzzy' | 'global'}> = [];
        const addedPatterns = new Set<string>();

        const addPattern = (pattern: string, type: 'direct' | 'using_precise' | 'using_fuzzy' | 'global') => {
            if (addedPatterns.has(pattern)) {
                return;
            }
            addedPatterns.add(pattern);
            patterns.push({pattern, type});
        };

        const isNestedClass = className.includes('.');
        const classParts = className.split('.');
        const outerClassName = classParts[0];
        const innerClassName = classParts[classParts.length - 1];

        // Candidate file names to try (prioritized): outer class, inner class, full name
        const candidateNames: string[] = [];
        if (isNestedClass) {
            candidateNames.push(outerClassName);

            // Include intermediate prefixes for multi-level nesting (e.g., Outer.Inner => Outer.Inner)
            if (classParts.length > 2) {
                for (let i = 1; i < classParts.length - 1; i++) {
                    candidateNames.push(classParts.slice(0, i + 1).join('.'));
                }
            }

            if (innerClassName !== outerClassName) {
                candidateNames.push(innerClassName);
            }

            candidateNames.push(className);
        } else {
            candidateNames.push(className);
        }

        // Pattern 1: Direct class file name match (most common)
        for (const candidate of candidateNames) {
            addPattern(`**/${candidate}.cs`, 'direct');

            // For nested names containing dots, also try replacing dots with path separators
            if (candidate.includes('.')) {
                addPattern(`**/${candidate.replace(/\./g, '/')}.cs`, 'direct');
            }
        }

        // Pattern 2: Based on using statements, generate namespace-based paths
        for (const namespace of usingStatements) {
            const pathParts = namespace.split('.');
            const namespacePath = pathParts.join('/');

            for (const candidate of candidateNames) {
                addPattern(`**/${namespacePath}/**/${candidate}.cs`, 'using_precise');

                if (candidate.includes('.')) {
                    addPattern(`**/${namespacePath}/**/${candidate.replace(/\./g, '/')}.cs`, 'using_precise');
                }
            }

            if (pathParts.length >= 2) {
                const lastTwo = pathParts.slice(-2).join('/');
                for (const candidate of candidateNames) {
                    addPattern(`**/${lastTwo}/**/${candidate}.cs`, 'using_fuzzy');
                    if (candidate.includes('.')) {
                        addPattern(`**/${lastTwo}/**/${candidate.replace(/\./g, '/')}.cs`, 'using_fuzzy');
                    }
                }
            }

            if (pathParts.length >= 1) {
                const lastOne = pathParts[pathParts.length - 1];
                for (const candidate of candidateNames) {
                    addPattern(`**/${lastOne}/**/${candidate}.cs`, 'using_fuzzy');
                    if (candidate.includes('.')) {
                        addPattern(`**/${lastOne}/**/${candidate.replace(/\./g, '/')}.cs`, 'using_fuzzy');
                    }
                }
            }
        }

        // Pattern 3: Global C# file search - search all .cs files as a fallback (LAST RESORT)
        addPattern(`**/*.cs`, 'global');

        console.log(`[CSharpClassParser] 🔍 Generated ${patterns.length} search patterns for ${className}`);
        return patterns;
    }

    /**
     * Search for a class file using intelligent patterns based on using statements
     * @param className The class name to find
     * @param currentDocument Current document to extract using statements from
     * @returns The found document, or null if not found
     */
    private async findClassFileByUsing(className: string, currentDocument: vscode.TextDocument): Promise<vscode.TextDocument | null> {
        // First, check the file-level cache to see if we know which file contains this class
        const cachedFilePath = this.findClassInFileCache(className);
        if (cachedFilePath) {
            try {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(cachedFilePath));
                console.log(`[CSharpClassParser]     ✅ Loaded ${className} from cached file path`);
                return document;
            } catch (error) {
                console.warn(`[CSharpClassParser]     ⚠️ Cached file path invalid, removing from cache`);
                this.fileClassCache.delete(cachedFilePath);
            }
        }

        // Extract using statements from current document
        const usingStatements = this.extractUsingStatements(currentDocument);

        // Generate search patterns with type information
        const patterns = this.generateSearchPatterns(className, usingStatements);

        // Track whether we found the class
        let found = false;

        // Search using each pattern until we find the class
        for (const {pattern, type} of patterns) {
            console.log(`[CSharpClassParser]   🔍 Trying pattern: ${pattern} (type: ${type})`);

            // Get file limit for this pattern type
            const fileLimit = this.getSearchFileLimit(pattern, type);
            console.log(`[CSharpClassParser]     Using search limit: ${fileLimit} files for ${type} pattern`);

            try {
                // For global patterns like **/*.cs, use optimized exclusions
                const isGlobalPattern = type === 'global';
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

                        // Quick check: does this file contain the class or enum definition?
                        // ⭐ NESTED CLASS SUPPORT: Check for both regular and nested class patterns
                        const classRegex = new RegExp(`\\bclass\\s+${className.replace('.', '\\.')}\\b`);
                        const enumRegex = new RegExp(`\\benum\\s+${className}\\b`);

                        // For nested classes, also check if the file contains the nested class pattern
                        let containsClass = classRegex.test(text) || enumRegex.test(text);

                        if (!containsClass && className.includes('.')) {
                            // For nested classes like "HealthNews.MediaInfo", check if the file contains both classes
                            const parts = className.split('.');
                            if (parts.length === 2) {
                                const [outerClass, innerClass] = parts;
                                const outerRegex = new RegExp(`\\bclass\\s+${outerClass}\\b`);
                                const innerRegex = new RegExp(`\\bclass\\s+${innerClass}\\b`);
                                containsClass = outerRegex.test(text) && innerRegex.test(text);
                            }
                        }

                        if (containsClass) {
                            console.log(`[CSharpClassParser]     ✅ Found ${className} in ${fileUri.fsPath} (checked ${checkedCount}/${files.length} files)`);

                            // ⭐ KEY OPTIMIZATION: Extract and cache all class names from this file
                            const allClassNames = this.extractAllClassNamesFromDocument(document);
                            this.fileClassCache.set(document.uri.fsPath, allClassNames);
                            console.log(`[CSharpClassParser]     💾 Cached ${allClassNames.size} class names from ${document.uri.fsPath}`);

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
     * @param currentDocument The current document (for relative path resolution, e.g., Controller file)
     * @param recursive Whether to recursively parse nested complex types (default: true)
     * @param parsedClasses Set of already parsed classes to prevent infinite recursion
     * @param depth Current recursion depth (for safety)
     * @param lastFoundDocument Last document where we found a class (for smart same-file inference)
     * @param currentClassDocument Document where the parent class is defined (for same-file dependency lookup)
     * @returns Array of class properties, or null if class not found
     */
    async parseClassDefinitionFromWorkspace(
        className: string,
        currentDocument: vscode.TextDocument,
        recursive: boolean = true,
        parsedClasses: Set<string> = new Set(),
        depth: number = 0,
        lastFoundDocument?: vscode.TextDocument,
        currentClassDocument?: vscode.TextDocument
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

        // ⭐ HIGHEST PRIORITY: Try currentClassDocument first (dependencies often in same file)
        if (currentClassDocument) {
            console.log(`[CSharpClassParser] 🎯 PRIORITY 1: Trying currentClassDocument (same-file dependencies): ${currentClassDocument.uri.fsPath}`);

            // ⭐ OPTIMIZATION: Cache all classes in this file BEFORE parsing to avoid repeated extraction
            if (!this.fileClassCache.has(currentClassDocument.uri.fsPath)) {
                const allClassNames = this.extractAllClassNamesFromDocument(currentClassDocument);
                this.fileClassCache.set(currentClassDocument.uri.fsPath, allClassNames);
                console.log(`[CSharpClassParser]     💾 Cached ${allClassNames.size} class names from ${currentClassDocument.uri.fsPath}`);
            } else {
                console.log(`[CSharpClassParser]     ✓ File cache already exists for ${currentClassDocument.uri.fsPath}`);
            }

            let properties = await this.parseClassDefinition(currentClassDocument, actualClassName);
            if (properties && properties.length > 0) {
                console.log(`[CSharpClassParser] ✅ Found ${actualClassName} in currentClassDocument (same-file optimization!)`);

                // ⭐ CRITICAL FIX: Check if base class parsing failed and retry with workspace search
                const hasBaseClassWarning = properties.some(p => p._baseClassWarning);
                if (hasBaseClassWarning) {
                    console.log(`[CSharpClassParser] ⚠️ Base class parsing failed in same-file search, trying workspace search...`);

                    // Retry with workspace search to find base class
                    const workspaceProperties = await this.parseClassDefinitionFromWorkspace(
                        actualClassName,
                        currentDocument,
                        recursive,
                        parsedClasses,
                        depth,
                        undefined, // Don't use lastFoundDocument to force fresh search
                        undefined // Don't use currentClassDocument to allow workspace search
                    );

                    if (workspaceProperties && workspaceProperties.length > 0) {
                        console.log(`[CSharpClassParser] ✅ Found ${actualClassName} with base classes via workspace search!`);
                        properties = workspaceProperties;
                    }
                }

                // Recursively parse nested complex types if enabled
                if (recursive) {
                    console.log(`[CSharpClassParser] 🔄 Starting recursive parsing for ${actualClassName}`);
                    await this.parseNestedComplexTypes(properties, currentDocument, parsedClasses, depth + 1, lastFoundDocument, currentClassDocument, actualClassName);
                }
                return properties;
            }
        }

        // OPTIMIZATION 2: If we have a lastFoundDocument, try it next
        if (lastFoundDocument && lastFoundDocument.uri.fsPath !== currentDocument.uri.fsPath &&
            (!currentClassDocument || lastFoundDocument.uri.fsPath !== currentClassDocument.uri.fsPath)) {
            console.log(`[CSharpClassParser] 🎯 PRIORITY 2: Trying lastFoundDocument: ${lastFoundDocument.uri.fsPath}`);
            let properties = await this.parseClassDefinition(lastFoundDocument, actualClassName);
            if (properties && properties.length > 0) {
                console.log(`[CSharpClassParser] ✅ Found ${actualClassName} in lastFoundDocument`);

                // Recursively parse nested complex types if enabled
                if (recursive) {
                    console.log(`[CSharpClassParser] 🔄 Starting recursive parsing for ${actualClassName}`);
                    await this.parseNestedComplexTypes(properties, lastFoundDocument, parsedClasses, depth + 1, lastFoundDocument, lastFoundDocument, actualClassName);
                }
                return properties;
            }
        }

        // OPTIMIZATION 3: Try the current document (Controller file)
        if (!currentClassDocument || currentDocument.uri.fsPath !== currentClassDocument.uri.fsPath) {
            console.log(`[CSharpClassParser] 🎯 PRIORITY 3: Trying currentDocument (Controller file): ${currentDocument.uri.fsPath}`);
            let properties = await this.parseClassDefinition(currentDocument, actualClassName);
            if (properties && properties.length > 0) {
                console.log(`[CSharpClassParser] ✅ Found ${actualClassName} in currentDocument`);

                // Recursively parse nested complex types if enabled
                if (recursive) {
                    console.log(`[CSharpClassParser] 🔄 Starting recursive parsing for ${actualClassName}`);
                    await this.parseNestedComplexTypes(properties, currentDocument, parsedClasses, depth + 1, currentDocument, currentDocument, actualClassName);
                }
                return properties;
            }
        }

        // OPTIMIZATION 4: Use intelligent search based on using statements
        console.log(`[CSharpClassParser] 🎯 PRIORITY 4: Starting intelligent search based on using statements...`);
        const foundDocument = await this.findClassFileByUsing(actualClassName, currentDocument);

        if (foundDocument) {
            let properties = await this.parseClassDefinition(foundDocument, actualClassName);
            if (properties && properties.length > 0) {
                console.log(`[CSharpClassParser] ✅ Found ${actualClassName} with ${properties.length} properties via intelligent search`);

                // Recursively parse nested complex types if enabled, passing foundDocument as hint
                if (recursive) {
                    console.log(`[CSharpClassParser] 🔄 Starting recursive parsing for ${actualClassName}`);
                    await this.parseNestedComplexTypes(properties, foundDocument, parsedClasses, depth + 1, foundDocument, foundDocument, actualClassName);
                }

                return properties;
            }
        }

        console.log(`[CSharpClassParser] ❌ Class ${actualClassName} not found via using-based search`);

        // ⭐ ENHANCED ERROR HANDLING: Provide more specific error messages for nested classes
        let errorMsg = `⚠️ 警告: 类 '${actualClassName}' 未在工作区找到`;
        if (actualClassName.includes('.')) {
            const parts = actualClassName.split('.');
            if (parts.length === 2) {
                errorMsg = `⚠️ 警告: 嵌套类 '${actualClassName}' 未在工作区找到。请确保文件中同时定义了外部类 '${parts[0]}' 和内部类 '${parts[1]}'`;
            } else {
                errorMsg = `⚠️ 警告: 复杂嵌套类 '${actualClassName}' 格式不支持。当前仅支持 'OuterClass.InnerClass' 格式`;
            }
        }

        console.log(`[CSharpClassParser] 💾 Caching parse failure for ${actualClassName} with enhanced error message`);
        this.cache.set(
            actualClassName,
            [], // Empty properties
            null, // No class definition
            currentDocument.uri.fsPath,
            [errorMsg] // Enhanced error message
        );

        return null;
    }

    /**
     * Resolve a property base type to a fully-qualified nested class name when necessary
     * @param baseType The extracted base type from the property (e.g., MediaInfo)
     * @param parentClassName Name of the parent class currently being parsed
     * @param candidateDocuments Documents likely containing the nested class (current, lastFound, etc.)
     * @returns Resolved type name (possibly qualified with outer class)
     */
    private resolveNestedClassName(
        baseType: string,
        parentClassName: string | undefined,
        candidateDocuments: vscode.TextDocument[]
    ): string {
        // If already fully-qualified or clearly namespaced, return as-is
        if (baseType.includes('.')) {
            return baseType;
        }

        // Prepare candidate document caches (deduplicated by path)
        const uniqueDocsMap = new Map<string, vscode.TextDocument>();
        for (const doc of candidateDocuments) {
            uniqueDocsMap.set(doc.uri.fsPath, doc);
        }
        const uniqueDocs = Array.from(uniqueDocsMap.values());

        // Collect class name sets for each candidate document
        const classSets = uniqueDocs.map(doc => this.ensureDocumentClassCache(doc));

        // If the base type exists as a top-level class, keep it unqualified
        for (const classSet of classSets) {
            if (classSet.has(baseType)) {
                return baseType;
            }
        }

        if (parentClassName) {
            const hierarchyParts = parentClassName.split('.');

            // Try most specific outer class first (e.g., Outer.Inner -> [Outer.Inner, Outer])
            for (let i = hierarchyParts.length; i >= 1; i--) {
                const outerPrefix = hierarchyParts.slice(0, i).join('.');
                const candidateName = `${outerPrefix}.${baseType}`;

                for (const classSet of classSets) {
                    if (classSet.has(candidateName)) {
                        console.log(`[CSharpClassParser] 🧭 Resolved nested type ${baseType} -> ${candidateName}`);
                        return candidateName;
                    }
                }

                // Fallback: search global cache if we previously scanned other files
                for (const [filePath, classNames] of this.fileClassCache.entries()) {
                    if (classNames.has(candidateName)) {
                        console.log(`[CSharpClassParser] 🧭 Resolved nested type ${baseType} -> ${candidateName} via cached file ${filePath}`);
                        return candidateName;
                    }
                }
            }
        }

        // Final fallback: if base type exists in any cached file as top-level, keep original name
        for (const classNames of this.fileClassCache.values()) {
            if (classNames.has(baseType)) {
                return baseType;
            }
        }

        return baseType;
    }

    /**
     * Recursively parse nested complex types in properties
     * @param properties Array of properties to analyze
     * @param currentDocument Current document for searching
     * @param parsedClasses Set of already parsed classes
     * @param depth Current recursion depth
     * @param lastFoundDocument Document where the parent class was found (for same-file inference)
     * @param currentClassDocument Document where the current class is defined (for same-file dependency lookup)
     * @param parentClassName Name of the class currently being parsed (used for resolving nested types)
     */
    private async parseNestedComplexTypes(
        properties: ClassProperty[],
        currentDocument: vscode.TextDocument,
        parsedClasses: Set<string>,
        depth: number,
        lastFoundDocument?: vscode.TextDocument,
        currentClassDocument?: vscode.TextDocument,
        parentClassName?: string
    ): Promise<void> {
        console.log(`[CSharpClassParser] 🔍 parseNestedComplexTypes called with ${properties.length} properties at depth ${depth}`);
        console.log(`[CSharpClassParser] 📋 parsedClasses contains: [${Array.from(parsedClasses).join(', ')}]`);
        console.log(`[CSharpClassParser] 📁 currentDocument: ${currentDocument.uri.fsPath}`);
        console.log(`[CSharpClassParser] 📁 lastFoundDocument: ${lastFoundDocument?.uri.fsPath || 'undefined'}`);
        console.log(`[CSharpClassParser] 📁 currentClassDocument: ${currentClassDocument?.uri.fsPath || 'undefined'}`);

        // Determine candidate documents for resolving nested types (deduplicated in order of relevance)
        const candidateDocuments: vscode.TextDocument[] = [];
        const addCandidateDocument = (doc?: vscode.TextDocument) => {
            if (!doc) {
                return;
            }
            if (candidateDocuments.some(existing => existing.uri.fsPath === doc.uri.fsPath)) {
                return;
            }
            candidateDocuments.push(doc);
        };

        addCandidateDocument(currentClassDocument);
        addCandidateDocument(lastFoundDocument);
        addCandidateDocument(currentDocument);

        // Build a map to store parsed results for reuse
        const parsedResults = new Map<string, ClassProperty[]>();

        // ⭐ OPTIMIZATION: Collect all types that need parsing for parallel processing
        const typesToParse: Array<{prop: ClassProperty, baseType: string}> = [];

        for (const prop of properties) {
            // Extract the actual type (handle List<T>, IEnumerable<T>, T[], T?, etc.)
            const originalBaseType = this.extractBaseType(prop.type);

            // Resolve potential nested class references when no namespace was specified
            const baseType = this.resolveNestedClassName(
                originalBaseType,
                parentClassName,
                candidateDocuments
            );

            if (baseType !== originalBaseType) {
                console.log(`[CSharpClassParser]   - Property ${prop.name} (type: ${prop.type}) resolved nested base type: ${originalBaseType} -> ${baseType}`);
            } else {
                console.log(`[CSharpClassParser]   - Property ${prop.name} (type: ${prop.type}, baseType: ${baseType})`);
            }

            // Skip if it's a simple type
            if (this.isSimpleType(baseType)) {
                console.log(`[CSharpClassParser]     ✓ Skipped (simple type)`);
                continue;
            }

            // Check if this type is an enum - if so, handle it specially
            console.log(`[CSharpClassParser] 🔍 Checking if ${baseType} is an enum...`);
            const enumInfo = await this.findEnumInWorkspace(baseType, currentDocument);
            if (enumInfo) {
                console.log(`[CSharpClassParser] ✅ Found enum ${baseType}, marking as enum type`);
                // Mark this property as an enum by storing enum info in a special field
                prop._baseClassWarning = `ENUM_INFO:${enumInfo.firstValue}|${enumInfo.allValues.join(',')}`;
                console.log(`[CSharpClassParser] ✅ Enum ${baseType} marked for property ${prop.name}`);
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

            // Add to the list of types to parse
            typesToParse.push({prop, baseType});
        }

        // ⭐ PARALLEL OPTIMIZATION: Parse all unique types in parallel
        if (typesToParse.length > 0) {
            // ⭐ CRITICAL: Pre-cache the currentClassDocument to avoid race conditions in parallel parsing
            if (currentClassDocument && !this.fileClassCache.has(currentClassDocument.uri.fsPath)) {
                const allClassNames = this.extractAllClassNamesFromDocument(currentClassDocument);
                this.fileClassCache.set(currentClassDocument.uri.fsPath, allClassNames);
                console.log(`[CSharpClassParser] 💾 Pre-cached ${allClassNames.size} class names from ${currentClassDocument.uri.fsPath} before parallel parsing`);
            }

            // Get unique base types to avoid redundant parallel requests
            const uniqueTypes = new Map<string, ClassProperty[]>();
            for (const {baseType} of typesToParse) {
                if (!uniqueTypes.has(baseType)) {
                    uniqueTypes.set(baseType, []);
                }
            }

            console.log(`[CSharpClassParser] 🚀 Starting parallel parsing of ${uniqueTypes.size} unique types: [${Array.from(uniqueTypes.keys()).join(', ')}]`);

            // Parse all unique types in parallel
            const parsePromises = Array.from(uniqueTypes.keys()).map(async (baseType) => {
                console.log(`[CSharpClassParser]     🔄 Parsing ${baseType} in parallel...`);
                const nestedProperties = await this.parseClassDefinitionFromWorkspace(
                    baseType,
                    currentDocument,
                    true,
                    parsedClasses,
                    depth,
                    lastFoundDocument,  // ⭐ Pass the hint for same-file optimization
                    currentClassDocument  // ⭐ Pass current class document for same-file dependency lookup
                );
                return {baseType, nestedProperties};
            });

            // Wait for all parallel parsing to complete
            const parseResults = await Promise.all(parsePromises);

            // Store results in parsedResults map
            for (const {baseType, nestedProperties} of parseResults) {
                if (nestedProperties && nestedProperties.length > 0) {
                    parsedResults.set(baseType, nestedProperties);
                    console.log(`[CSharpClassParser]     ✅ Parsed ${baseType} with ${nestedProperties.length} properties`);
                    console.log(`[CSharpClassParser]        Properties: [${nestedProperties.map(p => p.name).join(', ')}]`);
                } else {
                    console.log(`[CSharpClassParser]     ⚠️ WARNING: No nested properties found for ${baseType}!`);
                    console.log(`[CSharpClassParser]        nestedProperties is:`, nestedProperties);
                }
            }

            // Attach parsed properties to the corresponding props
            for (const {prop, baseType} of typesToParse) {
                if (parsedResults.has(baseType)) {
                    prop.properties = parsedResults.get(baseType)!;
                    console.log(`[CSharpClassParser]     ✅ Attached ${prop.properties.length} nested properties to ${prop.name}`);
                } else {
                    console.log(`[CSharpClassParser]     ❌ Failed to attach properties to ${prop.name} (baseType: ${baseType})`);
                    console.log(`[CSharpClassParser]        Available types in parsedResults: [${Array.from(parsedResults.keys()).join(', ')}]`);
                }
            }
        }

        console.log(`[CSharpClassParser] ✅ parseNestedComplexTypes completed for ${properties.length} properties`);
    }

    /**
     * Extract base type from complex types (List<T>, T[], T?, etc.)
     * Also handles nested class types like OuterClass.InnerClass
     */
    private extractBaseType(type: string): string {
        // Remove nullable marker
        let baseType = type.replace('?', '');

        // Handle array types: User[] -> User
        if (baseType.endsWith('[]')) {
            return baseType.slice(0, -2);
        }

        // Handle generic types: List<User>, IEnumerable<Product>, List<OuterClass.InnerClass>, etc.
        const genericMatch = baseType.match(/<(.+)>/);
        if (genericMatch) {
            return genericMatch[1].trim();
        }

        return baseType;
    }

    private findClassDefinition(lines: string[], className: string): number {
        // ⭐ NESTED CLASS SUPPORT: Check if this is a nested class (OuterClass.InnerClass)
        if (className.includes('.')) {
            return this.findNestedClassDefinition(lines, className);
        }

        // ⭐ PERFORMANCE: Create regex once, not in every loop iteration
        const classRegex = new RegExp(`\\bclass\\s+${className}\\b`);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for class definition: public class ClassName, class ClassName, etc.
            if (classRegex.test(line)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find nested class definition (OuterClass.InnerClass)
     * @param lines Array of lines to search
     * @param nestedClassName The nested class name in format "OuterClass.InnerClass"
     * @returns Line index where nested class is found, or -1 if not found
     */
    private findNestedClassDefinition(lines: string[], nestedClassName: string): number {
        const parts = nestedClassName.split('.');
        if (parts.length !== 2) {
            console.log(`[CSharpClassParser] ⚠️ Unsupported nested class format: ${nestedClassName} (expected: OuterClass.InnerClass)`);
            return -1;
        }

        const [outerClassName, innerClassName] = parts;
        console.log(`[CSharpClassParser] 🔍 Searching for nested class: ${innerClassName} inside ${outerClassName}`);

        let outerClassLineIndex = -1;
        let braceCount = 0;
        let inOuterClass = false;

        // First, find the outer class
        const outerClassRegex = new RegExp(`\\bclass\\s+${outerClassName}\\b`);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!inOuterClass) {
                // Look for outer class definition
                if (outerClassRegex.test(line)) {
                    outerClassLineIndex = i;
                    console.log(`[CSharpClassParser] ✅ Found outer class ${outerClassName} at line ${i}`);
                    inOuterClass = true;
                }
            } else {
                // We're inside the outer class, track braces
                for (const char of line) {
                    if (char === '{') {
                        braceCount++;
                    }
                    if (char === '}') {
                        braceCount--;
                    }
                }

                // Look for inner class definition within the outer class
                const innerClassRegex = new RegExp(`\\bclass\\s+${innerClassName}\\b`);
                if (innerClassRegex.test(line)) {
                    console.log(`[CSharpClassParser] ✅ Found inner class ${innerClassName} at line ${i} inside ${outerClassName}`);
                    return i;
                }

                // If we've exited the outer class, stop searching
                if (braceCount === 0) {
                    console.log(`[CSharpClassParser] ❌ Inner class ${innerClassName} not found within ${outerClassName}`);
                    return -1;
                }
            }
        }

        return -1;
    }

    /**
     * Find enum definition in lines
     * @param lines Array of lines to search
     * @param enumName The enum name to find
     * @returns Line index where enum is found, or -1 if not found
     */
    private findEnumDefinition(lines: string[], enumName: string): number {
        // ⭐ PERFORMANCE: Create regex once, not in every loop iteration
        const enumRegex = new RegExp(`\\benum\\s+${enumName}\\b`);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for enum definition: public enum EnumName, enum EnumName, etc.
            if (enumRegex.test(line)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Parse enum definition and extract enum values
     * @param lines Array of lines containing the enum
     * @param enumLineIndex Line index where enum starts
     * @returns EnumInfo with extracted values, or null if parsing failed
     */
    private parseEnumDefinition(lines: string[], enumLineIndex: number): EnumInfo | null {
        const enumValues: string[] = [];
        let braceCount = 0;
        let inEnum = false;

        console.log(`[CSharpClassParser] Parsing enum starting at line ${enumLineIndex}`);

        // Start from the enum line and parse until we exit the enum
        for (let i = enumLineIndex; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Count braces to track scope
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    if (!inEnum) inEnum = true;
                }
                if (char === '}') {
                    braceCount--;
                }
            }

            // If we've exited the enum, stop
            if (inEnum && braceCount === 0) {
                break;
            }

            // Skip comments, attributes, and empty lines when not in enum scope
            if (!inEnum && (trimmedLine.startsWith('//') || trimmedLine.startsWith('///') ||
                trimmedLine.startsWith('[') || trimmedLine.startsWith('*') ||
                trimmedLine === '')) {
                continue;
            }

            // Extract enum values when inside enum scope
            if (inEnum && trimmedLine && !trimmedLine.startsWith('//') &&
                !trimmedLine.startsWith('///') && !trimmedLine.startsWith('[') &&
                !trimmedLine.startsWith('*')) {

                // Match enum member patterns: VALUE, VALUE = 1, [EnumMember(Value = "SMALL")] SMALL, etc.
                const enumMemberRegex = /(?:\[[^\]]*\]\s*)?(\w+)(?:\s*=\s*[^,}]+)?/;
                const match = trimmedLine.match(enumMemberRegex);

                if (match && match[1]) {
                    const enumValue = match[1];
                    enumValues.push(enumValue);
                    console.log(`[CSharpClassParser] Found enum value: ${enumValue}`);
                }
            }
        }

        if (enumValues.length === 0) {
            console.log(`[CSharpClassParser] No enum values found`);
            return null;
        }

        console.log(`[CSharpClassParser] Extracted ${enumValues.length} enum values: [${enumValues.join(', ')}]`);

        return {
            isEnum: true,
            firstValue: enumValues[0],
            allValues: enumValues
        };
    }

    /**
     * Check if a type is an enum and parse it
     * @param document The document to search in
     * @param typeName The type name to check
     * @returns EnumInfo if it's an enum, null otherwise
     */
    async parseEnumIfEnum(document: vscode.TextDocument, typeName: string): Promise<EnumInfo | null> {
        const lines = this.getDocumentLines(document);

        // Try to find enum definition
        const enumLineIndex = this.findEnumDefinition(lines, typeName);
        if (enumLineIndex === -1) {
            return null; // Not an enum in this document
        }

        console.log(`[CSharpClassParser] Found enum ${typeName} at line ${enumLineIndex}`);
        return this.parseEnumDefinition(lines, enumLineIndex);
    }

    /**
     * Search for an enum in workspace files
     * @param enumName The enum name to find
     * @param currentDocument Current document to extract using statements from
     * @returns EnumInfo if found, null otherwise
     */
    async findEnumInWorkspace(enumName: string, currentDocument: vscode.TextDocument): Promise<EnumInfo | null> {
        console.log(`[CSharpClassParser] Searching workspace for enum: ${enumName}`);

        // First, try current document
        const enumInCurrent = await this.parseEnumIfEnum(currentDocument, enumName);
        if (enumInCurrent) {
            console.log(`[CSharpClassParser] ✅ Found enum ${enumName} in current document`);
            return enumInCurrent;
        }

        // Use intelligent search based on using statements (same as class search)
        const foundDocument = await this.findClassFileByUsing(enumName, currentDocument);
        if (foundDocument) {
            const enumInfo = await this.parseEnumIfEnum(foundDocument, enumName);
            if (enumInfo) {
                console.log(`[CSharpClassParser] ✅ Found enum ${enumName} in workspace`);
                return enumInfo;
            }
        }

        console.log(`[CSharpClassParser] ❌ Enum ${enumName} not found in workspace`);
        return null;
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
        const propertyRegex = /^\s*(?:public|private|protected|internal)?\s+([\w<>\?\.,\[\]\s]+?)\s+(\w+)\s*\{\s*get;?\s*set;?\s*\}(?:\s*=\s*[^;]+)?;?$/i;
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
        const declRegex = /^\s*(?:public|private|protected|internal)\s+([\w<>\?\.,\[\]\s]+?)\s+(\w+)\s*(?:\{)?$/i;
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

        // ⭐ PERFORMANCE: Use cached lines instead of repeated getText() and split()
        const lines = this.getDocumentLines(document);

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

    /**
     * Get cached parsing errors for a class
     * @param className The class name to check
     * @returns Array of error messages if cached, null otherwise
     */
    getCachedErrors(className: string): string[] | null {
        const actualClassName = this.extractInnerType(className);
        const cached = this.cache.get(actualClassName);
        if (cached && cached.errors && cached.errors.length > 0) {
            console.log(`[CSharpClassParser] 📋 Retrieved ${cached.errors.length} cached error(s) for ${actualClassName}`);
            return cached.errors;
        }
        return null;
    }
}
