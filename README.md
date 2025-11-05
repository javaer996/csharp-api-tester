# C# API Tester for Visual Studio Code

[中文文档](./README.zh-CN.md) | English

An intelligent Visual Studio Code extension that automatically detects and tests C# Web API endpoints directly from your code editor with AI-powered smart JSON generation.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
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
- Understands property names and types
- Reads C# comments and attributes for context
- Supports OpenAI, Azure OpenAI, and custom AI providers
- Preserves conversation history per API panel

### 🌍 Environment Management
- Multiple environment support (Development, Staging, Production, etc.)
- Each environment with custom base URL, base path, and headers
- Quick switching between environments
- Define headers per environment as needed

### 📝 Advanced Features
- **Body Editor**: Full-featured JSON editor with formatting and AI generation
- **Form Data Support**: File upload and form field testing
- **Value Editor**: Expandable editor for long header/query values
- **Response Viewer**: Formatted JSON with syntax highlighting
- **Request History**: View AI conversation and restore original JSON

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

1. Click **"🤖 AI Generate"** button
2. AI analyzes your C# class definition:
   ```csharp
   public class CreateUserDto
   {
       /// <summary>
       /// User's full name
       /// </summary>
       public string Name { get; set; }

       /// <summary>
       /// Email address
       /// </summary>
       public string Email { get; set; }

       public int Age { get; set; }
   }
   ```
3. Generates realistic test data based on property names, types, and comments
4. View the AI conversation with **"💬 View AI"** button
5. Restore original template with **"↺ Restore"** button

### Tab Priority

The test panel intelligently selects the default tab:

- **Form Tab** → If `[FromForm]` parameters exist
- **Body Tab** → If `[FromBody]` parameters exist
- **Query Tab** → If `[FromQuery]` parameters exist
- **Headers Tab** → Fallback

## ⚙️ Configuration

### Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `csharpApiTester.timeout` | Request timeout (ms) | 30000 |
| `csharpApiTester.ai.enabled` | Enable AI features | false |
| `csharpApiTester.ai.provider` | AI provider | "openai" |
| `csharpApiTester.ai.apiKey` | AI API key | "" |
| `csharpApiTester.ai.endpoint` | AI API endpoint | "https://api.openai.com/v1/chat/completions" |
| `csharpApiTester.ai.model` | AI model | "gpt-3.5-turbo" |
| `csharpApiTester.ai.maxTokens` | Max tokens | 1000 |

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
| `C#HttpRequest: Test Debug` | Verify extension activation |
| `C#HttpRequest: Debug API Detection` | View detected endpoints in console |
| `C#HttpRequest: Manage Environments` | Open environment management |

## 📝 Examples

Check the `examples/` folder for comprehensive examples:

- **UsersController**: CRUD operations with DTOs
- **ProductsController**: Complex queries and updates
- **UploadController**: File uploads and form data
  - Single file upload
  - Multiple files upload
  - File with metadata
  - Form-only submission
  - Image upload with options

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

- Built with VS Code Extension API
- Powered by TypeScript and Axios

---

**Enjoy testing your C# APIs! 🚀**
