import * as vscode from 'vscode';
import { ClassProperty } from './csharpClassParser';

/**
 * Cached class definition data
 */
interface CachedClassDefinition {
    properties: ClassProperty[];
    classDefinition: string | null;
    filePath: string;
    timestamp: number;
    errors?: string[]; // 缓存解析错误信息,避免重复解析失败的类
}

/**
 * LRU Cache for C# class definitions
 * Improves performance by avoiding repeated file I/O and parsing
 */
export class ClassDefinitionCache {
    private cache: Map<string, CachedClassDefinition> = new Map();
    private maxSize: number;
    private maxAge: number; // milliseconds

    constructor(maxSize: number = 100, maxAgeMinutes: number = 30) {
        this.maxSize = maxSize;
        this.maxAge = maxAgeMinutes * 60 * 1000;
    }

    /**
     * Get cached class definition
     * @param className The class name to lookup
     * @returns Cached definition or null if not found/expired
     */
    get(className: string): CachedClassDefinition | null {
        const cached = this.cache.get(className);

        if (!cached) {
            console.log(`[ClassDefinitionCache] Cache MISS: ${className}`);
            return null;
        }

        // Check if expired
        const age = Date.now() - cached.timestamp;
        if (age > this.maxAge) {
            console.log(`[ClassDefinitionCache] Cache EXPIRED: ${className} (age: ${Math.round(age / 1000)}s)`);
            this.cache.delete(className);
            return null;
        }

        console.log(`[ClassDefinitionCache] Cache HIT: ${className} (age: ${Math.round(age / 1000)}s)`);

        // Move to end (LRU: most recently used)
        this.cache.delete(className);
        this.cache.set(className, cached);

        return cached;
    }

    /**
     * Store class definition in cache
     * @param className The class name
     * @param properties Parsed properties
     * @param classDefinition Full class text definition
     * @param filePath Source file path
     * @param errors Optional parsing error messages
     */
    set(
        className: string,
        properties: ClassProperty[],
        classDefinition: string | null,
        filePath: string,
        errors?: string[]
    ): void {
        console.log(`[ClassDefinitionCache] Caching: ${className} from ${filePath}${errors && errors.length > 0 ? ' (with errors)' : ''}`);

        // Enforce max size (LRU eviction)
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            console.log(`[ClassDefinitionCache] Cache FULL, evicting: ${firstKey}`);
            this.cache.delete(firstKey);
        }

        this.cache.set(className, {
            properties,
            classDefinition,
            filePath,
            timestamp: Date.now(),
            errors
        });

        console.log(`[ClassDefinitionCache] Cache size: ${this.cache.size}/${this.maxSize}`);
    }

    /**
     * Invalidate cached class definitions from a specific file
     * Called when a file is modified
     * @param filePath The file path that was modified
     */
    invalidateFile(filePath: string): void {
        let invalidatedCount = 0;

        for (const [className, cached] of this.cache.entries()) {
            if (cached.filePath === filePath) {
                this.cache.delete(className);
                invalidatedCount++;
            }
        }

        if (invalidatedCount > 0) {
            console.log(`[ClassDefinitionCache] Invalidated ${invalidatedCount} entries from ${filePath}`);
        }
    }

    /**
     * Invalidate specific class from cache
     * @param className The class name to invalidate
     */
    invalidateClass(className: string): void {
        if (this.cache.has(className)) {
            console.log(`[ClassDefinitionCache] Invalidating: ${className}`);
            this.cache.delete(className);
        }
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        console.log(`[ClassDefinitionCache] Clearing entire cache (${this.cache.size} entries)`);
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats(): { size: number; maxSize: number; entries: string[] } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            entries: Array.from(this.cache.keys())
        };
    }
}
