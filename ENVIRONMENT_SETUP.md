# 🌍 Environment Management Guide

## Quick Setup

Your extension now includes full environment management capabilities. Here's how to use them:

### 🚀 From API Test Panel (Direct Access)

1. **Click the Environment Button** in the panel header
   - Look for "🌍 Development" or your current environment name
   - Displayed prominently in the top-right of the test panel
   - Shows current environment details in tooltip (base URL, path, headers count)

2. **Environment Actions Available**:
   - **Manage Environments**: Opens complete environment management
   - **Switch Environment**: Quick selection of available environments
   - **Edit Current Environment**: Modify current environment settings
   - **View All Environments**: Browse all configured environments

### ⚙️ From Command Palette

1. **Press `Ctrl+Shift+P`** (or `Cmd+Shift+P` on Mac)
2. **Search for environment commands**:
   - `C# API Tester: Manage API Environments` → Complete environment setup
   - `C# API Tester: Switch Environment` → Quick environment switching
   - `C# API Tester: Test API Detection` → Debug API detection

### 📊 Default Environments

The extension comes with pre-configured environments:

**Development Environment**:
```json
{
  "name": "Development",
  "baseUrl": "http://localhost:5000",
  "basePath": "/api",
  "headers": { "Content-Type": "application/json" },
  "active": true
}
```

**Staging Environment**:
```json
{
  "name": "Staging",
  "baseUrl": "https://staging.example.com",
  "basePath": "/api",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer your-token"
  }
}
```

## Environment Configuration

### Add New Environment
1. Click environment button → "Manage All Environments"
2. Select "Add New Environment"
3. Fill in details:
   - **Name**: `Production`, `Local`, `QA`
   - **Base URL**: Complete domain (`http://localhost:5000` or `https://api.example.com`)
   - **Base Path**: API prefix (`/api`, `/v1`, or empty string)
   - **Headers**: JSON format for headers like authentication

### Environment Settings Examples

#### .NET Core API
```json
{
  "baseUrl": "http://localhost:5000",
  "basePath": "/api",
  "headers": { "Content-Type": "application/json" }
}
Result: http://localhost:5000/api/users/123
```

#### External API
```json
{
  "baseUrl": "https://api.example.com",
  "basePath": "/v1",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
Result: https://api.example.com/v1/users/123
```

#### Root API
```json
{
  "baseUrl": "http://localhost:8080",
  "basePath": "",
  "headers": { "Content-Type": "application/json" }
}
Result: http://localhost:8080/users/123
```

### Quick Environment Switching

1. **Status Bar**: Shows current environment (`$(server-environment) API: Development`)
   - Click status bar → Quick switcher
   - Shows environment details when hovering

2. **Keyboard Shortcuts**: Add custom keybindings
   ```json
   {
     "key": "ctrl+shift+e",
     "command": "csharpApiTester.switchEnvironment"
   }
   ```


## Environment Features

### 🔄 Smart URL Construction
- Combines: `baseUrl + basePath + controller_route + method_route`
- Automatically handles trailing slashes
- Removes duplicate `api/` prefixes

### 🎯 Header Management
- Per-environment headers
- JSON validation for header input
- Auto-merges with default request headers

### 💾 Persistence
- All environments saved in VS Code settings
- Current environment automatically remembered
- Survives VS Code restarts

### 🎨 Visual Indicators
- Current environment shown in status bar
- Environment details in tooltips
- Real-time UI updates when switching

## Troubleshooting

### Environment Not Showing
1. Check VS Code settings → `csharpApiTester.environments`
2. Ensure at least one environment exists
3. Reset to defaults if needed: `Manage → Add New Environment`

### URL Not Working
1. Verify `basePath` doesn't duplicate controller route
2. Check for trailing slashes in configuration
3. Test with `[Route("api/[controller]")]` patterns

### Authentication Issues
1. Format headers correctly as JSON
2. Ensure token/bearer format is correct
3. Test headers in isolation first

### Can't Switch Environments
1. Use Command Palette as backup: `Switch Environment`
2. Check for VS Code permissions issues
3. Restart VS Code if environment panel stuck

## Advanced Usage

### Multi-Project Setup
```json
[
  {
    "name": "User API",
    "baseUrl": "http://localhost:5001",
    "basePath": "/api",
    "headers": { "Authorization": "Bearer user-api-token" }
  },
  {
    "name": "Order API",
    "baseUrl": "http://localhost:5002",
    "basePath": "/api",
    "headers": { "Authorization": "Bearer order-api-token" }
  }
]
```

### Environment Variables
```json
{
  "headers": {
    "x-api-key": "${process.env.API_KEY}",
    "Authorization": "Bearer ${process.env.BEARER_TOKEN}"
  }
}
```

Now you have full environment control directly from the API Test Panel! 🚀