import * as vscode from 'vscode';
import axios from 'axios';

export interface AIConfig {
    enabled: boolean;
    provider: string;
    apiKey: string;
    endpoint: string;
    model: string;
    maxTokens: number;
    systemPrompt: string;
}

export interface APIContext {
    method: string;
    route: string;
    methodSignature?: string;
    parameters?: string[];
    returnType?: string;
    comments?: string[];
    classProperties?: Array<{ name: string; type: string; }>;
    classDefinitions?: Array<{ className: string; definition: string; }>;
}

export interface AIConversation {
    systemPrompt: string;
    userPrompt: string;
    aiResponse: string;
    timestamp: number;
}

export class AIService {
    private static instance: AIService;
    private lastConversation: AIConversation | null = null;

    private constructor() {}

    public static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    /**
     * Get AI configuration from VS Code settings
     */
    private getConfig(): AIConfig {
        const config = vscode.workspace.getConfiguration('csharpApiTester');
        return {
            enabled: config.get<boolean>('ai.enabled', false),
            provider: config.get<string>('ai.provider', 'openai'),
            apiKey: config.get<string>('ai.apiKey', ''),
            endpoint: config.get<string>('ai.endpoint', 'https://api.openai.com/v1/chat/completions'),
            model: config.get<string>('ai.model', 'gpt-3.5-turbo'),
            maxTokens: config.get<number>('ai.maxTokens', 1000),
            systemPrompt: config.get<string>('ai.systemPrompt', 'You are a professional API testing assistant.')
        };
    }

    /**
     * Check if AI service is configured and enabled
     */
    public isConfigured(): boolean {
        const config = this.getConfig();
        return config.enabled && config.apiKey.length > 0;
    }

    /**
     * Generate smart JSON values based on API context
     * @param jsonTemplate The JSON template with keys (can be empty)
     * @param apiContext Context about the API endpoint
     */
    public async generateSmartJson(jsonTemplate: string | null, apiContext: APIContext): Promise<string> {
        const config = this.getConfig();

        if (!config.enabled) {
            throw new Error('AI service is not enabled. Please enable it in settings.');
        }

        if (!config.apiKey) {
            throw new Error('AI API key is not configured. Please set it in settings.');
        }

        console.log('[AIService] Generating smart JSON with AI...');
        console.log('[AIService] API Context:', apiContext);
        console.log('[AIService] Template:', jsonTemplate);

        // Build prompt for AI
        const { systemPrompt, userPrompt } = this.buildPrompt(jsonTemplate, apiContext, config);

        try {
            const response = await this.callAI(systemPrompt, userPrompt, config);
            console.log('[AIService] AI response received:', response);

            // Store conversation
            this.lastConversation = {
                systemPrompt,
                userPrompt,
                aiResponse: response,
                timestamp: Date.now()
            };

            return response;
        } catch (error) {
            console.error('[AIService] AI generation failed:', error);
            throw error;
        }
    }

    /**
     * Get the last AI conversation
     */
    public getLastConversation(): AIConversation | null {
        return this.lastConversation;
    }

    /**
     * Build prompt for AI
     */
    private buildPrompt(jsonTemplate: string | null, apiContext: APIContext, config: AIConfig): { systemPrompt: string; userPrompt: string } {
        // Enhanced system prompt to ensure single JSON output
        const systemPrompt = `${config.systemPrompt}

CRITICAL INSTRUCTION: You are a JSON generation tool. You MUST return ONLY a single, valid JSON object.
- No explanations, no comments, no markdown formatting
- No multiple JSON objects
- Start with { and end with }
- Only valid JSON syntax`;

        // Build user prompt with rich context
        let userPrompt = `Generate realistic test data for the following API endpoint:\n\n`;

        userPrompt += `## API Endpoint Information\n`;
        userPrompt += `- HTTP Method: ${apiContext.method}\n`;
        userPrompt += `- Route: ${apiContext.route}\n`;

        if (apiContext.methodSignature) {
            userPrompt += `- Method Signature: ${apiContext.methodSignature}\n`;
        }

        if (apiContext.returnType) {
            userPrompt += `- Return Type: ${apiContext.returnType}\n`;
        }

        if (apiContext.parameters && apiContext.parameters.length > 0) {
            userPrompt += `\n## Parameters\n`;
            apiContext.parameters.forEach(param => {
                userPrompt += `- ${param}\n`;
            });
        }

        if (apiContext.comments && apiContext.comments.length > 0) {
            userPrompt += `\n## Code Comments\n`;
            apiContext.comments.forEach(comment => {
                userPrompt += `${comment}\n`;
            });
        }

        if (apiContext.classProperties && apiContext.classProperties.length > 0) {
            userPrompt += `\n## Request Body Structure\n`;
            userPrompt += `The request body should have the following properties:\n`;
            apiContext.classProperties.forEach(prop => {
                userPrompt += `- ${prop.name}: ${prop.type}\n`;
            });
        }

        if (apiContext.classDefinitions && apiContext.classDefinitions.length > 0) {
            userPrompt += `\n## C# Entity Definitions\n`;
            userPrompt += `Here are the complete C# class definitions (including comments and attributes):\n\n`;
            apiContext.classDefinitions.forEach(classDef => {
                userPrompt += `### ${classDef.className}\n`;
                userPrompt += `\`\`\`csharp\n${classDef.definition}\n\`\`\`\n\n`;
            });
        }

        if (jsonTemplate) {
            userPrompt += `\n## Current JSON Template\n`;
            userPrompt += `\`\`\`json\n${jsonTemplate}\n\`\`\`\n`;
            userPrompt += `\nPlease improve the values in this JSON to be more realistic and contextually appropriate.\n`;
        } else if (apiContext.classProperties && apiContext.classProperties.length > 0) {
            userPrompt += `\nPlease generate a complete JSON object with realistic values based on the structure above.\n`;
        } else {
            userPrompt += `\nPlease generate a realistic JSON request body for this endpoint.\n`;
        }

        userPrompt += `\n## CRITICAL REQUIREMENTS\n`;
        userPrompt += `IMPORTANT: You MUST return ONLY ONE single valid JSON object.\n`;
        userPrompt += `- Do NOT add any explanations, comments, or text before or after the JSON\n`;
        userPrompt += `- Do NOT wrap the JSON in markdown code blocks (\`\`\`json or \`\`\`)\n`;
        userPrompt += `- Do NOT return multiple JSON objects or arrays of objects unless the API explicitly requires an array\n`;
        userPrompt += `- Do NOT invent extra fields that are not in the class definition\n`;
        userPrompt += `- Return EXACTLY ONE JSON object that matches the structure provided\n`;
        userPrompt += `- The response should start with { and end with }\n`;

        return { systemPrompt, userPrompt };
    }

    /**
     * Call AI API
     */
    private async callAI(systemPrompt: string, userPrompt: string, config: AIConfig): Promise<string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        // Add authorization header based on provider
        if (config.provider === 'openai') {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        } else if (config.provider === 'azure-openai') {
            headers['api-key'] = config.apiKey;
        } else {
            // Custom provider
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        const requestBody = {
            model: config.model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            max_tokens: config.maxTokens,
            temperature: 0.7
        };

        console.log('[AIService] Calling AI API:', config.endpoint);
        console.log('[AIService] System prompt:', systemPrompt);
        console.log('[AIService] User prompt:', userPrompt);

        try {
            const response = await axios.post(config.endpoint, requestBody, {
                headers: headers,
                timeout: 30000
            });

            console.log('[AIService] Full response:', response.data);

            // Extract content from response
            const content = response.data.choices?.[0]?.message?.content || '';

            // Clean up response - remove markdown code blocks if present
            let cleanedContent = content.trim();

            // Remove markdown code blocks (```json ... ``` or ``` ... ```)
            if (cleanedContent.startsWith('```json')) {
                cleanedContent = cleanedContent.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
            } else if (cleanedContent.startsWith('```')) {
                cleanedContent = cleanedContent.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            // Remove any leading/trailing text that's not JSON
            // Find the first { and last }
            const firstBrace = cleanedContent.indexOf('{');
            const lastBrace = cleanedContent.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanedContent = cleanedContent.substring(firstBrace, lastBrace + 1);
            }

            // Final cleanup - remove any trailing text after the closing brace
            cleanedContent = cleanedContent.trim();

            // Validate JSON
            try {
                const parsed = JSON.parse(cleanedContent);

                // Ensure it's a single object, not an array or multiple objects
                if (Array.isArray(parsed)) {
                    console.warn('[AIService] AI returned an array, taking first element');
                    return JSON.stringify(parsed[0] || {});
                }

                return cleanedContent;
            } catch (parseError) {
                console.error('[AIService] Invalid JSON from AI:', cleanedContent);
                console.error('[AIService] Original response:', content);
                throw new Error('AI returned invalid JSON. Please try again.');
            }

        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const message = error.response?.data?.error?.message || error.message;

                if (status === 401) {
                    throw new Error('Invalid API key. Please check your AI configuration.');
                } else if (status === 429) {
                    throw new Error('AI API rate limit exceeded. Please try again later.');
                } else if (status === 500) {
                    throw new Error('AI service error. Please try again later.');
                } else {
                    throw new Error(`AI API error: ${message}`);
                }
            }
            throw error;
        }
    }

    /**
     * Test AI configuration
     */
    public async testConfiguration(): Promise<boolean> {
        const config = this.getConfig();

        if (!config.enabled) {
            throw new Error('AI service is not enabled');
        }

        if (!config.apiKey) {
            throw new Error('AI API key is not configured');
        }

        try {
            const testSystemPrompt = 'You are a helpful AI assistant.';
            const testUserPrompt = 'Say "OK" if you can read this message.';
            await this.callAI(testSystemPrompt, testUserPrompt, config);
            return true;
        } catch (error) {
            console.error('[AIService] Configuration test failed:', error);
            throw error;
        }
    }
}
