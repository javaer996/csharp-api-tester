# C# API Tester for Visual Studio Code

An intelligent Visual Studio Code extension that automatically detects and tests C# Web API endpoints directly from your code editor.

## Features

- 🔍 **Automatic API Detection**: Intelligently recognizes C# Web API controllers and methods
- 🚀 **One-Click Testing**: Execute API calls directly from your code with a single click
- 📝 **Smart Parameter Recognition**: Automatically identifies HTTP methods, routes, and parameter types
- 🔗 **Parameter Analysis**: Distinguishes between path parameters, query parameters, request body, and headers
- 🎯 **Intelligent Request Generation**: Creates sample request data based on parameter types and naming conventions
- 🛠️ **Interactive Testing UI**: Built-in web interface for testing and viewing responses
- ⚙️ **Configurable Settings**: Customize base URLs, headers, and request timeouts

## How It Works

The extension analyzes your C# controller files to:

1. **Detect API Endpoints**: Scans for controller classes and HTTP method attributes
2. **Parse Parameters**: Identifies route parameters, query string parameters, and request body parameters
3. **Generate Requests**: Creates intelligent sample data based on parameter types
4. **Test APIs**: Executes HTTP requests and displays responses in an interactive panel

## Supported HTTP Methods

- GET
- POST
- PUT
- DELETE
- PATCH
- HEAD
- OPTIONS

## Usage

1. Open a C# controller file in VS Code
2. Look for the "🚀 Test API" button above each API method
3. Click the button to open the testing panel
4. Modify request parameters as needed
5. Click "Test API" to execute the request
6. View the response, status code, and response headers

## Configuration

Configure the extension by:

- **Command Palette**: `Ctrl+Shift+P` → "C# API Tester: Configure API Base URL"
- **Settings**: Access via VS Code settings (`csharpApiTester`)

### Available Settings

- `csharpApiTester.baseUrl`: Default base URL for API testing (default: "http://localhost:5000")
- `csharpApiTester.defaultHeaders`: Default headers to include in requests
- `csharpApiTester.timeout`: Request timeout in milliseconds (default: 30000)

## Example

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
    public async Task<ActionResult<User>> CreateUser([FromBody] CreateUserDto user)
    {
        // Your code here
    }
}
```

The extension will automatically:
- Detect the GET `/api/users/{id}` endpoint
- Detect the POST `/api/users` endpoint
- Generate appropriate sample data for testing
- Display execution buttons above each method

## Requirements

- Visual Studio Code 1.74.0 or higher
- C# extension for syntax highlighting

## Installation

1. Install the extension from the VS Code marketplace
2. Open a C# controller file
3. Start testing your APIs!

## Development

To contribute or modify the extension:

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to compile the TypeScript code
4. Press `F5` to open a new Extension Development Host window

## License

MIT License - see LICENSE file for details.