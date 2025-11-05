import * as vscode from 'vscode';
import { ApiEndpointInfo, ApiParameter } from './apiEndpointDetector';
import { Environment } from './environmentManager';
import { ClassProperty, CSharpClassParser, EnumInfo } from './csharpClassParser';

export interface GeneratedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    queryParams: Record<string, any>;
    pathParams: Record<string, any>;
    body?: any;
    formData?: Record<string, any>;  // New: for form-data
    errors?: string[];  // Errors that occurred during request generation
}

export class ApiRequestGenerator {
    private classParser?: CSharpClassParser; // Optional: for accessing cached errors

    private sampleData = {
        string: [
            'sample_string', 'test_value', 'example', 'data',
            'hello world', 'test123', 'sample@email.com'
        ],
        number: [42, 123, 999, 0, -1, 3.14],
        boolean: [true, false],
        guid: ['550e8400-e29b-41d4-a716-446655440000', '12345678-1234-1234-1234-123456789012'],
        date: [
            '2024-01-01T00:00:00Z',
            '2024-12-31T23:59:59Z',
            new Date().toISOString()
        ],
        email: ['test@example.com', 'user@domain.com', 'contact@company.org'],
        url: ['https://example.com', 'http://localhost:8080', 'https://api.example.com']
    };

    constructor(classParser?: CSharpClassParser) {
        this.classParser = classParser || new CSharpClassParser();
    }

    generateRequest(endpoint: ApiEndpointInfo, baseUrl: string): GeneratedRequest {
        const request: GeneratedRequest = {
            url: '',
            method: endpoint.method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            queryParams: {},
            pathParams: {},
            body: undefined
        };

        // Process URL with parameters
        let fullUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        fullUrl += endpoint.route.startsWith('/') ? endpoint.route : `/${endpoint.route}`;

        // Replace path parameters with sample values
        fullUrl = this.fillPathParameters(fullUrl, endpoint.parameters);

        // Separate query parameters
        const queryParams = this.generateQueryParameters(endpoint.parameters);

        // Build final URL with query string
        const queryString = this.buildQueryString(queryParams);
        request.url = queryString ? `${fullUrl}?${queryString}` : fullUrl;

        // Generate body for POST/PUT methods
        if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            const result = this.generateRequestBody(endpoint.parameters);
            request.body = result.body;
            request.errors = result.errors;
        }

        request.queryParams = queryParams;
        return request;
    }

    generateRequestForEnvironment(endpoint: ApiEndpointInfo, environment: Environment, skipErrors: boolean = false): GeneratedRequest {
        const request: GeneratedRequest = {
            url: '',
            method: endpoint.method,
            headers: {
                ...environment.headers, // Use environment headers as base
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            queryParams: {},
            pathParams: {},
            body: undefined,
            formData: undefined
        };

        // Process URL using environment base URL and base path
        let fullUrl = environment.baseUrl.endsWith('/') ? environment.baseUrl.slice(0, -1) : environment.baseUrl;
        let fullPath = environment.basePath;

        // Combine base path with endpoint route
        if (fullPath) {
            fullPath = fullPath.endsWith('/') ? fullPath : fullPath + '/';
            fullPath = fullPath.startsWith('/') ? fullPath.slice(1) : fullPath;

            let endpointRoute = endpoint.route;
            endpointRoute = endpointRoute.startsWith('/') ? endpointRoute.slice(1) : endpointRoute;
            endpointRoute = endpointRoute.startsWith('api/') ? endpointRoute.slice(4) : endpointRoute; // Remove redundant api prefix

            endpointRoute = endpointRoute.startsWith('/') ? endpointRoute.slice(1) : endpointRoute;

            fullUrl += '/' + fullPath + endpointRoute;
        } else {
            fullUrl += endpoint.route.startsWith('/') ? endpoint.route : `/${endpoint.route}`;
        }

        // Replace path parameters with sample values
        fullUrl = this.fillPathParameters(fullUrl, endpoint.parameters);

        // Separate query parameters
        const queryParams = this.generateQueryParameters(endpoint.parameters);

        // Build final URL with query string
        const queryString = this.buildQueryString(queryParams);
        request.url = queryString ? `${fullUrl}?${queryString}` : fullUrl;

        // Check for form parameters
        const formParams = endpoint.parameters.filter(p => p.source === 'form');
        if (formParams.length > 0) {
            // Generate form data
            request.formData = this.generateFormData(formParams);
            // Set multipart/form-data header
            request.headers['Content-Type'] = 'multipart/form-data';
        } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            // Generate body for POST/PUT methods
            const result = this.generateRequestBody(endpoint.parameters, skipErrors);
            request.body = result.body;
            request.errors = result.errors;
        }

        request.queryParams = queryParams;
        return request;
    }

    private fillPathParameters(url: string, parameters: ApiParameter[]): string {
        let processedUrl = url;

        const pathParams = parameters.filter(p => p.source === 'path');
        for (const param of pathParams) {
            const sampleValue = this.generateSampleValue(param.type, param.name);
            const placeholder = `{${param.name}}`;
            processedUrl = processedUrl.replace(placeholder, encodeURIComponent(sampleValue));
        }

        return processedUrl;
    }

    private generateQueryParameters(parameters: ApiParameter[]): Record<string, any> {
        const queryParams: Record<string, any> = {};
        const queryParamsList = parameters.filter(p => p.source === 'query');

        for (const param of queryParamsList) {
            queryParams[param.name] = this.generateSampleValue(param.type, param.name);
        }

        return queryParams;
    }

    private generateFormData(parameters: ApiParameter[]): Record<string, any> {
        const formData: Record<string, any> = {};

        for (const param of parameters) {
            // Check if it's a file parameter
            if (this.isFileType(param.type)) {
                formData[param.name] = '[FILE]'; // Placeholder for file
            } else {
                formData[param.name] = this.generateSampleValue(param.type, param.name);
            }
        }

        return formData;
    }

    private isFileType(type: string): boolean {
        const fileTypes = ['IFormFile', 'IFormFileCollection', 'Stream', 'byte[]'];
        return fileTypes.some(ft => type.includes(ft));
    }

    private generateRequestBody(parameters: ApiParameter[], skipErrors: boolean = false): { body: any, errors: string[] } {
        const bodyParams = parameters.filter(p => p.source === 'body');
        const formParams = parameters.filter(p => p.source === 'form');
        const errors: string[] = [];

        if (bodyParams.length === 1) {
            // Single body parameter - use class properties if available
            const bodyParam = bodyParams[0];
            console.log(`[ApiRequestGenerator] Processing body parameter: ${bodyParam.type}, properties:`, bodyParam.properties);
        if (bodyParam.properties && bodyParam.properties.length > 0) {
                // Check if this is an enum marker
                if (bodyParam.properties[0].name === '_enum' && bodyParam.properties[0]._baseClassWarning?.startsWith('ENUM_INFO:')) {
                    const enumData = bodyParam.properties[0]._baseClassWarning.substring('ENUM_INFO:'.length);
                    const [firstValue, allValuesStr] = enumData.split('|');

                    console.log(`[ApiRequestGenerator] Generating enum body with first value: ${firstValue}`);
                    return { body: firstValue, errors: [] };
                }

                console.log(`[ApiRequestGenerator] Generating body from ${bodyParam.properties.length} class properties`);

                // Check for base class warning
                if (bodyParam.properties[0]._baseClassWarning) {
                    const baseClassWarning = bodyParam.properties[0]._baseClassWarning;
                    const errorMsg = `_GLOBAL_|⚠️ 警告: 类 '${bodyParam.type}' 的${baseClassWarning}|解决方案: 请检查父类定义文件是否在工作区中,或手动补充继承的属性。当前请求体仅包含子类自身的属性,可能不完整`;
                    errors.push(errorMsg);
                }

                const { body, errors: objErrors } = this.generateObjectFromPropertiesWithErrors(bodyParam.properties);
                if (objErrors.length > 0) {
                    errors.push(...objErrors);
                }
                return { body, errors };
            } else {
                // ⭐ NEW: 如果没有解析到 properties,先尝试从缓存读取错误
                if (this.classParser) {
                    const cachedErrors = this.classParser.getCachedErrors(bodyParam.type);
                    console.log(`[ApiRequestGenerator] Cached errors for ${bodyParam.type}:`, cachedErrors);
                    if (cachedErrors && cachedErrors.length > 0) {
                        console.log(`[ApiRequestGenerator] Using cached errors for ${bodyParam.type}:`, cachedErrors);
                        // 将缓存的错误转换为我们的错误格式
                        const formattedErrors = cachedErrors.map(err => {
                            if (err.includes('未在工作区找到')) {
                                return `_GLOBAL_|${err}|解决方案: 请在工作区定义此类型,或手动填写完整的请求体`;
                            }
                            return `_GLOBAL_|${err}|请检查类型定义`;
                        });
                        errors.push(...formattedErrors);
                        return { body: null, errors };
                    } else {
                        console.log(`[ApiRequestGenerator] No cached errors found for ${bodyParam.type}, generating default warning`);
                    }
                } else {
                    console.log(`[ApiRequestGenerator] No classParser available for ${bodyParam.type}`);
                }

                // 如果没有缓存的错误
                if (skipErrors) {
                    // 初始渲染时，不记录错误，只返回 null
                    console.log(`[ApiRequestGenerator] No properties found for ${bodyParam.type}, skipping error (initial render)`);
                    return { body: null, errors: [] };
                } else {
                    // 解析完成后，记录错误信息
                    console.log(`[ApiRequestGenerator] No properties found for ${bodyParam.type}, returning null with error info`);
                    const errorMsg = `_GLOBAL_|⚠️ 警告: 类 '${bodyParam.type}' 未在工作区找到|解决方案: 请在工作区定义此类型,或手动填写完整的请求体`;
                    errors.push(errorMsg);
                    return { body: null, errors };
                }
            }
        } else if (bodyParams.length > 1) {
            // Multiple body parameters (wrap in object)
            const body: Record<string, any> = {};
            for (const param of bodyParams) {
                body[param.name] = this.generateSampleValue(param.type, param.name);
            }
            return { body, errors: [] };
        } else if (formParams.length > 0) {
            // Form data
            const formData: Record<string, any> = {};
            for (const param of formParams) {
                formData[param.name] = this.generateSampleValue(param.type, param.name);
            }
            return { body: formData, errors: [] };
        }

        return { body: null, errors: [] };
    }

    private generateObjectFromPropertiesWithErrors(properties: ClassProperty[]): { body: Record<string, any>, errors: string[] } {
        const obj: Record<string, any> = {};
        const errors: string[] = [];

        for (const prop of properties) {
            // Check if this property is marked as an enum
            if (prop._baseClassWarning?.startsWith('ENUM_INFO:')) {
                // Extract enum info from the warning message
                const enumData = prop._baseClassWarning.substring('ENUM_INFO:'.length);
                const [firstValue, allValuesStr] = enumData.split('|');
                const allValues = allValuesStr.split(',');

                console.log(`[ApiRequestGenerator] Processing enum property ${prop.name} with values: [${allValues.join(', ')}]`);

                // Set the enum value directly
                obj[prop.name] = firstValue;
                continue;
            }

            // Check if property type is a complex type that might have nested properties
            const isComplexType = !this.isSimpleType(prop.type);

            // Check if it's a collection type (List, IEnumerable, ICollection, Array, etc.)
            const isCollectionType = this.isCollectionType(prop.type);

            if (isCollectionType) {
                // Handle List/array types: generate array with one sample item
                const innerType = this.extractInnerType(prop.type);

                // Check if the property itself has nested properties (recursively parsed)
                if (prop.properties && prop.properties.length > 0) {
                    console.log(`[ApiRequestGenerator] Generating array from nested properties for ${prop.name}`);
                    const { body: nestedBody, errors: nestedErrors } = this.generateObjectFromPropertiesWithErrors(prop.properties);
                    obj[prop.name] = [nestedBody];
                    if (nestedErrors.length > 0) {
                        errors.push(...nestedErrors);
                    }
                } else if (!this.isSimpleType(innerType)) {
                    // Inner type is complex but wasn't parsed - record error instead of returning error marker
                    console.warn(`[ApiRequestGenerator] ⚠️ Collection inner type ${innerType} not parsed for ${prop.name}!`);
                    const errorMsg = `${prop.name}|⚠️ 警告: 无法解析集合内部类型 '${innerType}'|解决方案: 请在工作区定义此类型,或手动添加 ${innerType} 对象到此数组`;
                    errors.push(errorMsg);
                    obj[prop.name] = [];  // Empty array for user to fill
                } else {
                    // Simple type array
                    obj[prop.name] = [this.generateSampleValue(innerType, prop.name)];
                }
            } else if (isComplexType) {
                // For complex types, check if we have recursively parsed properties
                if (prop.properties && prop.properties.length > 0) {
                    console.log(`[ApiRequestGenerator] Generating object from ${prop.properties.length} nested properties for ${prop.name}`);
                    const { body: nestedBody, errors: nestedErrors } = this.generateObjectFromPropertiesWithErrors(prop.properties);
                    obj[prop.name] = nestedBody;
                    if (nestedErrors.length > 0) {
                        errors.push(...nestedErrors);
                    }
                } else {
                    // Complex type not parsed - record error instead of fake data
                    console.warn(`[ApiRequestGenerator] ⚠️ Complex type ${prop.type} not parsed for ${prop.name}!`);
                    const errorMsg = `${prop.name}|⚠️ 警告: 无法解析复杂类型 '${prop.type}'|解决方案: 请在工作区定义此类型,或手动填写 ${prop.type} 对象`;
                    errors.push(errorMsg);
                    obj[prop.name] = null;  // Null for user to fill
                }
            } else {
                // Generate value based on property name and type
                obj[prop.name] = this.generateSampleValue(prop.type, prop.name);
            }

            console.log(`[ApiRequestGenerator] Generated ${prop.name}: ${typeof obj[prop.name] === 'object' ? JSON.stringify(obj[prop.name]).substring(0, 100) : obj[prop.name]} (type: ${prop.type})`);
        }

        return { body: obj, errors };
    }

    /**
     * Legacy method for backward compatibility - now just calls the new method
     */
    private generateObjectFromProperties(properties: ClassProperty[]): Record<string, any> {
        const { body } = this.generateObjectFromPropertiesWithErrors(properties);
        return body;
    }

    /**
     * Check if a type is a collection type (List, IEnumerable, Array, etc.)
     */
    private isCollectionType(type: string): boolean {
        const cleanType = type.replace('?', '').toLowerCase();
        return cleanType.includes('list<') ||
               cleanType.includes('ienumerable<') ||
               cleanType.includes('icollection<') ||
               cleanType.includes('ilist<') ||
               cleanType.includes('[]') ||
               cleanType.includes('array<');
    }

    /**
     * Extract inner type from generic type (e.g., List<User> -> User)
     */
    private extractInnerType(type: string): string {
        const match = type.match(/<([^<>]+)>/);
        return match ? match[1].trim() : type;
    }

    /**
     * Check if a type is simple/primitive
     */
    private isSimpleType(type: string): boolean {
        const simpleTypes = [
            'string', 'int', 'long', 'short', 'byte',
            'uint', 'ulong', 'ushort', 'sbyte',
            'double', 'float', 'decimal',
            'bool', 'boolean', 'DateTime', 'DateTimeOffset',
            'Guid', 'char', 'object'
        ];

        const cleanType = type.replace('?', '').replace('[]', '').toLowerCase();
        // Check if it's a generic collection
        if (cleanType.startsWith('list<') || cleanType.startsWith('ienumerable<') ||
            cleanType.startsWith('icollection<') || cleanType.startsWith('ilist<')) {
            return false;
        }

        return simpleTypes.some(t => cleanType === t.toLowerCase());
    }

    private generateComplexObject(type: string): any {
        // Handle array types
        if (type.includes('[]') || type.includes('List<') || type.includes('IEnumerable<')) {
            const innerType = this.extractInnerType(type.replace('[]', ''));
            return [this.generateSampleValueByType(innerType)];
        }

        // Handle common simple object types
        if (type.includes('string')) {
            return this.sampleData.string[0];
        }

        if (type.includes('int') || type.includes('long') || type.includes('double') || type.includes('decimal')) {
            return this.sampleData.number[0];
        }

        if (type.includes('bool')) {
            return this.sampleData.boolean[0];
        }

        if (type.includes('DateTime')) {
            return this.sampleData.date[0];
        }

        if (type.includes('Guid')) {
            return this.sampleData.guid[0];
        }

        // Generate generic object for complex types
        const sampleObject: Record<string, any> = {};

        // More comprehensive common property names
        const commonProperties = [
            'id', 'name', 'title', 'description',
            'email', 'phone', 'address',
            'createdDate', 'updatedDate',
            'isActive', 'status'
        ];

        // Generate 4-6 properties for a realistic object
        const propertyCount = Math.min(6, commonProperties.length);
        for (let i = 0; i < propertyCount; i++) {
            const prop = commonProperties[i];
            sampleObject[prop] = this.generateSampleValueByPropertyName(prop);
        }

        return sampleObject;
    }

    private generateSampleValue(type: string, propertyName: string): any {
        // Try to generate based on property name first
        const nameBasedValue = this.generateSampleValueByPropertyName(propertyName);
        if (nameBasedValue !== null) {
            return nameBasedValue;
        }

        // Fall back to type-based generation
        return this.generateSampleValueByType(type);
    }

    private generateSampleValueByPropertyName(propertyName: string): any {
        const lowerName = propertyName.toLowerCase();

        if (lowerName.includes('id') || lowerName.includes('identifier')) {
            return Math.floor(Math.random() * 1000) + 1;
        }

        if (lowerName.includes('email') || lowerName.includes('mail')) {
            return this.sampleData.email[0];
        }

        if (lowerName.includes('password') || lowerName.includes('pwd')) {
            return 'Sample@Password123';
        }

        if (lowerName.includes('phone') || lowerName.includes('telephone') || lowerName.includes('mobile')) {
            return '+1-555-0123';
        }

        if (lowerName.includes('address')) {
            return '123 Main Street';
        }

        if (lowerName.includes('city')) {
            return 'New York';
        }

        if (lowerName.includes('country')) {
            return 'USA';
        }

        if (lowerName.includes('zip') || lowerName.includes('postal')) {
            return '10001';
        }

        if (lowerName.includes('price') || lowerName.includes('amount') || lowerName.includes('cost')) {
            return 99.99;
        }

        if (lowerName.includes('quantity') || lowerName.includes('count')) {
            return 1;
        }

        if (lowerName.includes('category')) {
            return 'General';
        }

        if (lowerName.includes('url') || lowerName.includes('link')) {
            return this.sampleData.url[0];
        }

        if (lowerName.includes('date') || lowerName.includes('time')) {
            return this.sampleData.date[0];
        }

        if (lowerName.includes('name') || lowerName.includes('title')) {
            return 'Sample Name';
        }

        if (lowerName.includes('description') || lowerName.includes('comment')) {
            return 'This is a sample description';
        }

        if (lowerName.includes('status')) {
            return 'active';
        }

        if (lowerName.includes('is') || lowerName.includes('has') || lowerName.includes('can')) {
            return true;
        }

        return null;
    }

    private generateSampleValueByType(type: string): any {
        const cleanType = type.toLowerCase().replace('?', '');

        if (cleanType === 'string') {
            return this.sampleData.string[0];
        }

        if (['int', 'int32', 'int64', 'long', 'short', 'byte', 'uint', 'ulong', 'ushort'].includes(cleanType)) {
            return this.sampleData.number[0];
        }

        if (['double', 'float', 'decimal'].includes(cleanType)) {
            return this.sampleData.number[5]; // 3.14
        }

        if (cleanType === 'bool') {
            return this.sampleData.boolean[0];
        }

        if (cleanType === 'guid') {
            return this.sampleData.guid[0];
        }

        if (cleanType.includes('datetime')) {
            return this.sampleData.date[0];
        }

        // Default to string for unknown types
        return this.sampleData.string[0];
    }

    private buildQueryString(params: Record<string, any>): string {
        const entries = Object.entries(params);
        if (entries.length === 0) {
            return '';
        }

        return entries
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
    }
}