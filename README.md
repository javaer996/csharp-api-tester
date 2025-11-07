# C# API Tester for Visual Studio Code

[中文文档](./README.zh-CN.md) | English

An intelligent Visual Studio Code extension that automatically detects and tests C# Web API endpoints directly from your code editor with AI-powered smart JSON generation.

![Version](https://img.shields.io/badge/version-1.0.3-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.74.0+-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## ✨ Key Features

### 🔍 Automatic API Detection
- Intelligently recognizes C# Web API controllers and methods
- Parses HTTP method attributes (`[HttpGet]`, `[HttpPost]`, etc.)
- Extracts route templates from `[Route]` attributes
- Analyzes method signatures and parameter sources

### 🚀 One-Click Testing
- Execute API calls directly from your code editor
- CodeLens integration with inline "Test API" buttons
- Interactive testing panel with Apifox-style UI
- Multiple endpoints can be tested simultaneously

### 🎯 Smart Parameter Recognition
- **Path Parameters**: `{id}` in routes
- **Query Parameters**: `[FromQuery]` attributes
- **Request Body**: `[FromBody]` attributes with full C# class parsing
- **Headers**: `[FromHeader]` attributes
- **Form Data**: `[FromForm]` attributes with file upload support

### 🤖 AI-Powered JSON Generation
- Generates realistic test data based on C# class definitions
- Understands property names, types, and C# XML comments
- Reads C# class attributes for additional context
- Supports OpenAI, Azure OpenAI, and custom AI providers
- Preserves conversation history per API panel with "View AI" feature
- One-click restore to original template

### 🌍 Environment Management
- Multiple environment support (Development, Staging, Production, etc.)
- Each environment with custom base URL, base path, and headers
- Quick switching via status bar
- Per-environment header configuration
- Workspace-level settings persistence

### 📝 Advanced Features
- **Body Editor**: Full-featured JSON editor with syntax highlighting, formatting, and AI generation
- **Form Data Support**: Multipart form data with file upload and text fields
- **Value Editor**: Expandable modal editor for long header/query parameter values
- **Response Viewer**: Formatted JSON response with syntax highlighting and collapsible structure
- **Request History**: View AI conversation history and restore original JSON templates
- **Smart Tab Selection**: Automatically opens the most relevant tab (Form/Body/Query/Headers)
- **Performance Optimization**: Configurable search strategy (fast/balanced/thorough) for class definition lookup
- **Parameter Persistence**: Automatically saves and restores test parameters per environment (URL, headers, query params, body, form data)
- **Cache Management**: Clear cached parameters and class definitions to force fresh API detection

## 📦 Installation

### From VS Code Marketplace
1. Open VS Code
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (Mac)
3. Search for "C# API Tester"
4. Click Install

### From VSIX File
1. Download the `.vsix` file
2. Open VS Code
3. Press `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
4. Select the downloaded file

## 🚀 Quick Start

### 1. Basic Usage

Open a C# controller file:

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public async Task<ActionResult<User>> GetUser(int id)
    {
        // Your code here
    }

    [HttpPost]
    public async Task<ActionResult<User>> CreateUser([FromBody] CreateUserDto userDto)
    {
        // Your code here
    }
}
```

You'll see **"🚀 Test API"** buttons above each method. Click to test!

### 2. Environment Setup

First time using? Set up your environment:

1. Click the environment indicator in the status bar
2. Choose "Add New Environment"
3. Configure:
   - **Name**: "Development"
   - **Base URL**: "http://localhost:5000"
   - **Base Path**: "/api" (optional)
   - **Headers**: `{"Authorization": "Bearer token"}`

### 3. AI Configuration (Optional)

Enable AI-powered JSON generation:

1. Open Settings: `Ctrl+,` → Search "C# API Tester"
2. Configure AI settings:
   ```json
   {
     "csharpApiTester.ai.enabled": true,
     "csharpApiTester.ai.provider": "openai",
     "csharpApiTester.ai.apiKey": "sk-...",
     "csharpApiTester.ai.model": "gpt-3.5-turbo"
   }
   ```

## 📖 Feature Details

### Form Data & File Upload

Support for `[FromForm]` parameters:

```csharp
[HttpPost("upload")]
public async Task<IActionResult> UploadFile(
    [FromForm] IFormFile file,
    [FromForm] string title,
    [FromForm] string description)
{
    // Handle file upload
}
```

The extension automatically:
- Creates a **Form** tab in the test panel
- Detects file fields (`IFormFile`, `Stream`, `byte[]`)
- Supports text fields and file inputs
- Sends `multipart/form-data` requests

### AI Smart Generation

When testing endpoints with complex request bodies:

1. Click **"🤖 AI Generate"** button in the Body tab
2. AI analyzes your C# class definition including:
   - Property names and types
   - XML documentation comments (`/// <summary>`)
   - Data annotation attributes
   - Nested class structures
   ```csharp
   public class CreateUserDto
   {
       /// <summary>
       /// User's full name
       /// </summary>
       [Required]
       [MaxLength(100)]
       public string Name { get; set; }

       /// <summary>
       /// Email address
       /// </summary>
       [EmailAddress]
       public string Email { get; set; }

       public int Age { get; set; }

       public AddressDto Address { get; set; }
   }
   ```
3. AI generates realistic test data respecting all constraints
4. View the AI conversation and prompt with **"💬 View AI"** button
5. Restore original JSON template with **"↺ Restore"** button
6. All conversation history is preserved per API panel

### Tab Priority

The test panel intelligently selects the default tab:

- **Form Tab** → If `[FromForm]` parameters exist
- **Body Tab** → If `[FromBody]` parameters exist
- **Query Tab** → If `[FromQuery]` parameters exist
- **Headers Tab** → Fallback

### Parameter Persistence

The extension automatically saves your test parameters for each API endpoint per environment:

- **Auto-save**: Parameters are saved when you modify URL, headers, query params, body, or form data
- **Auto-restore**: Previously saved parameters are restored when you reopen the test panel
- **Environment-aware**: Each environment maintains separate parameter sets for the same endpoint
- **Cached Data**: Includes URL, HTTP method, headers, query parameters, request body, and form data

To start fresh with default values, use the **"Clear Cache And Test"** command from CodeLens or command palette.

## ⚙️ Configuration

### Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `csharpApiTester.timeout` | Request timeout (ms) | 30000 |
| `csharpApiTester.enableApiDetection` | Enable automatic API detection and CodeLens | true |
| `csharpApiTester.searchStrategy` | Class definition search strategy | "balanced" |
| `csharpApiTester.searchFileLimit` | Max files to search (custom strategy only) | 2000 |
| `csharpApiTester.ai.enabled` | Enable AI features | false |
| `csharpApiTester.ai.provider` | AI provider (openai/azure-openai/custom) | "openai" |
| `csharpApiTester.ai.apiKey` | AI API key | "" |
| `csharpApiTester.ai.endpoint` | AI API endpoint URL | OpenAI default |
| `csharpApiTester.ai.model` | AI model name | "gpt-3.5-turbo" |
| `csharpApiTester.ai.maxTokens` | Max tokens per request | 1000 |
| `csharpApiTester.ai.timeout` | AI request timeout (ms) | 60000 |
| `csharpApiTester.ai.systemPrompt` | System prompt for AI | Default prompt |

### Search Strategy

Choose a search strategy based on your project size:

- **fast**: Searches up to 500 .cs files (best for small projects)
- **balanced**: Searches up to 1000 .cs files (recommended for most projects)
- **thorough**: Searches up to 2000 .cs files (for large monorepos)
- **custom**: Use `searchFileLimit` setting to specify exact limit

### AI Providers

#### OpenAI
```json
{
  "csharpApiTester.ai.provider": "openai",
  "csharpApiTester.ai.apiKey": "sk-...",
  "csharpApiTester.ai.endpoint": "https://api.openai.com/v1/chat/completions",
  "csharpApiTester.ai.model": "gpt-3.5-turbo"
}
```

#### Azure OpenAI
```json
{
  "csharpApiTester.ai.provider": "azure-openai",
  "csharpApiTester.ai.apiKey": "your-azure-key",
  "csharpApiTester.ai.endpoint": "https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2024-02-15-preview",
  "csharpApiTester.ai.model": "gpt-35-turbo"
}
```

#### Custom Provider
```json
{
  "csharpApiTester.ai.provider": "custom",
  "csharpApiTester.ai.apiKey": "your-key",
  "csharpApiTester.ai.endpoint": "https://your-api.com/v1/chat/completions"
}
```

## 🎯 Advanced Usage

### Multiple Environments

Switch between environments quickly:

```json
// .vscode/settings.json
{
  "csharpApiTester.environments": [
    {
      "name": "Development",
      "baseUrl": "http://localhost:5000",
      "basePath": "/api",
      "headers": {
        "Authorization": "Bearer dev-token"
      }
    },
    {
      "name": "Staging",
      "baseUrl": "https://staging-api.example.com",
      "basePath": "",
      "headers": {
        "Authorization": "Bearer staging-token"
      }
    }
  ]
}
```

### Expandable Value Editor

For long header values or query parameters:
- Click the **⤢** icon next to the input field
- Edit in a large textarea
- Save changes back to the field

## 🔧 Commands

| Command | Description |
|---------|-------------|
| `C#HttpRequest: Test API Endpoint` | Open test panel for selected endpoint |
| `C#HttpRequest: Clear Cache And Test` | Clear cached parameters and class definitions, then test endpoint with fresh data |
| `C#HttpRequest: Manage API Environments` | Open environment management dialog |
| `C#HttpRequest: Switch Environment` | Quick switch between environments |
| `C#HttpRequest: Configure API Base URL` | Set base URL for current environment |
| `C#HttpRequest: Toggle API Detection` | Enable/disable automatic API detection |
| `C#HttpRequest: Test Debug` | Verify extension activation |
| `C#HttpRequest: Debug API Detection` | View detected endpoints in console |

## 📝 Use Cases

This extension is perfect for:

- **Backend Developers**: Test APIs directly from controller code
- **API Development**: Rapid prototyping and testing during development
- **Documentation**: Generate sample requests for API documentation
- **Testing**: Quick manual testing without leaving your editor
- **Learning**: Understand API behavior through interactive testing

## 💡 Tips & Tricks

### CodeLens Visibility
- CodeLens buttons appear automatically above API methods
- Use `C#HttpRequest: Toggle API Detection` to enable/disable
- Refresh the document if CodeLens doesn't appear immediately

### AI Generation Best Practices
- Add XML documentation comments for better AI understanding
- Use descriptive property names (e.g., `userEmail` instead of `e1`)
- Include data annotation attributes for realistic data generation
- Review and edit AI-generated values before sending requests

### Performance Optimization
- For large projects, use "fast" search strategy to improve performance
- For better accuracy with complex DTOs, use "thorough" strategy
- Custom strategy allows fine-tuning based on your specific needs

### Parameter Management
- The extension automatically saves your test parameters (headers, body, query params, etc.)
- Parameters are saved separately for each environment
- To reset to default values, use **"Clear Cache And Test"** command from CodeLens button or command palette
- Cache clearing also refreshes class definitions for accurate request generation

## 🛠️ Troubleshooting

### CodeLens Not Showing
1. Ensure the file is a C# controller with `[ApiController]` or `[Route]` attributes
2. Check that API detection is enabled in settings
3. Try reloading the VS Code window (`Developer: Reload Window`)

### AI Generation Failing
1. Verify AI is enabled: `csharpApiTester.ai.enabled`
2. Check API key is correctly configured
3. Test configuration with a simple endpoint first
4. Check console output for detailed error messages

### Environment Not Switching
1. Click the environment indicator in status bar
2. Select desired environment from the list
3. Verify environment settings in workspace settings

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 🐛 Bug Reports

Found a bug? Please open an issue with:
- VS Code version
- Extension version
- Steps to reproduce
- Expected vs actual behavior

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [VS Code Extension API](https://code.visualstudio.com/api)
- HTTP client powered by [Axios](https://axios-http.com/)
- UI inspired by [Apifox](https://apifox.com/)
- AI integration with OpenAI and compatible providers

## 🔗 Links

- [GitHub Repository](https://github.com/javaer996/csharp-api-tester)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=javaer996.csharp-api-tester)
- [Report Issues](https://github.com/javaer996/csharp-api-tester/issues)
- [Feature Requests](https://github.com/javaer996/csharp-api-tester/issues/new?labels=enhancement)

---

**Enjoy testing your C# APIs! 🚀**

If you find this extension helpful, please consider:
- ⭐ Starring the [GitHub repository](https://github.com/javaer996/csharp-api-tester)
- 📝 Leaving a review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=javaer996.csharp-api-tester)
- 🐛 Reporting issues or suggesting features
