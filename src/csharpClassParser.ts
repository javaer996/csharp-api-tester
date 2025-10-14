import * as vscode from 'vscode';

export interface ClassProperty {
    name: string;
    type: string;
    required: boolean;
}

export class CSharpClassParser {
    /**
     * Parse a C# class definition from the document
     * @param document The text document to search in
     * @param className The name of the class to find
     * @returns Array of class properties, or null if class not found
     */
    parseClassDefinition(document: vscode.TextDocument, className: string): ClassProperty[] | null {
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[CSharpClassParser] Searching for class: ${className}`);

        // Find the class definition
        const classLineIndex = this.findClassDefinition(lines, className);
        if (classLineIndex === -1) {
            console.log(`[CSharpClassParser] Class ${className} not found in document`);
            return null;
        }

        console.log(`[CSharpClassParser] Found class ${className} at line ${classLineIndex}`);

        // Extract properties from the class
        const properties = this.extractClassProperties(lines, classLineIndex);
        console.log(`[CSharpClassParser] Extracted ${properties.length} properties from ${className}`);

        return properties;
    }

    /**
     * Parse a C# class definition from workspace files
     * @param className The name of the class to find
     * @param currentDocument The current document (for relative path resolution)
     * @returns Array of class properties, or null if class not found
     */
    async parseClassDefinitionFromWorkspace(className: string, currentDocument: vscode.TextDocument): Promise<ClassProperty[] | null> {
        console.log(`[CSharpClassParser] Searching workspace for class: ${className}`);

        // First, try the current document
        const propertiesFromCurrent = this.parseClassDefinition(currentDocument, className);
        if (propertiesFromCurrent) {
            return propertiesFromCurrent;
        }

        // Search in workspace C# files
        const files = await vscode.workspace.findFiles('**/*.cs', '**/node_modules/**', 50);
        console.log(`[CSharpClassParser] Found ${files.length} C# files in workspace`);

        for (const fileUri of files) {
            try {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const properties = this.parseClassDefinition(document, className);
                if (properties) {
                    console.log(`[CSharpClassParser] Found ${className} in ${fileUri.fsPath}`);
                    return properties;
                }
            } catch (error) {
                console.error(`[CSharpClassParser] Error reading file ${fileUri.fsPath}:`, error);
            }
        }

        console.log(`[CSharpClassParser] Class ${className} not found in workspace`);
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

        // Start from the class line and parse until we exit the class
        for (let i = classLineIndex; i < lines.length; i++) {
            const line = lines[i];

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

            // Parse property declarations
            const property = this.parsePropertyLine(line);
            if (property) {
                properties.push(property);
                console.log(`[CSharpClassParser] Found property: ${property.name} (${property.type})`);
            }
        }

        return properties;
    }

    private parsePropertyLine(line: string): ClassProperty | null {
        const trimmedLine = line.trim();

        // Look for property patterns:
        // public string Name { get; set; }
        // public int? Age { get; set; }
        // public List<string> Tags { get; set; }
        const propertyRegex = /^\s*(?:public|private|protected|internal)?\s+(\S+(?:<[^>]+>)?)\s+(\w+)\s*\{\s*get;?\s*set;?\s*\}/i;
        const match = trimmedLine.match(propertyRegex);

        if (!match) {
            return null;
        }

        const type = match[1];
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
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[CSharpClassParser] Getting full definition for class: ${className}`);

        // Find the class definition
        const classLineIndex = this.findClassDefinition(lines, className);
        if (classLineIndex === -1) {
            console.log(`[CSharpClassParser] Class ${className} not found in document`);
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

        console.log(`[CSharpClassParser] Captured ${classDefinition.split('\n').length} lines for ${className}`);
        return classDefinition.trim();
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
}
