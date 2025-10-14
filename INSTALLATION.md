# Installation Guide

## Development Installation

1. **Clone or Download the Extension**
   ```bash
   git clone <repository-url>
   cd csharp-api-tester
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Compile the Extension**
   ```bash
   npm run compile
   ```

4. **Open in VS Code**
   Open the folder in VS Code

5. **Run the Extension**
   - Press `F5` to open a new Extension Development Host window
   - Or use the VS Code Run and Debug panel

## Packaged Installation

1. **Create VSIX Package**
   ```bash
   npm install -g vsce
   vsce package
   ```

2. **Install VSIX**
   - Open VS Code
   - Go to Extensions view (`Ctrl+Shift+X`)
   - Click "..." menu → "Install from VSIX..."
   - Select the generated `.vsix` file

## Marketplace Installation (Future)

Once published to VS Code Marketplace:
1. Open VS Code
2. Go to Extensions view (`Ctrl+Shift+X`)
3. Search for "C# API Tester"
4. Click Install

## Usage Instructions

1. **Open a C# Controller File**
   - Open any file containing ASP.NET Core Web API controllers
   - The extension activates automatically for `.cs` files

2. **Look for Test Buttons**
   - Above each API method, you'll see 🚀 **Test API** buttons
   - Additional information is displayed showing HTTP method, parameters, and return type

3. **Click to Test**
   - Click the "Test API" button to open the testing panel
   - Modify request parameters as needed
   - Click "Test API" in the panel to execute the request

4. **Configure Settings**
   - Use Command Palette (`Ctrl+Shift+P`): "C# API Tester: Configure API Base URL"
   - Or access Settings → Extensions → C# API Tester

## Example Controller

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public async Task<ActionResult<User>> GetUser(int id)
    {
        // This method will have a "Test API" button above it!
        return Ok(new User { Id = id });
    }

    [HttpPost]
    public async Task<ActionResult<User>> CreateUser([FromBody] CreateUserDto userDto)
    {
        // This method will also have a "Test API" button!
        return CreatedAtAction(nameof(GetUser), new { id = 1 }, userDto);
    }
}
```

## Troubleshooting

### Extension Not Activating
- Ensure you're opening a `.cs` file
- Check that the file contains controller classes with HTTP method attributes

### API Test Fails
- Verify your API base URL is correct
- Check that your API server is running
- Review the error message in the test panel

### Compilation Issues
- Make sure you have Node.js and npm installed
- Run `npm install` to install dependencies
- Check for TypeScript compilation errors

### VS Code Version
- Requires VS Code 1.74.0 or higher
- Update VS Code if you have compatibility issues