# C# API 测试工具 for Visual Studio Code

[English](./README.md) | 中文文档

一个智能的 Visual Studio Code 扩展，可以直接从代码编辑器中自动检测和测试 C# Web API 端点，并支持 AI 驱动的智能 JSON 生成。

![Version](https://img.shields.io/badge/version-1.0.3-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.74.0+-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## ✨ 主要特性

### 🔍 自动 API 检测
- 智能识别 C# Web API 控制器和方法
- 解析 HTTP 方法特性（`[HttpGet]`、`[HttpPost]` 等）
- 从 `[Route]` 特性中提取路由模板
- 分析方法签名和参数来源

### 🚀 一键测试
- 直接从代码编辑器执行 API 调用
- CodeLens 集成，提供内联"测试 API"按钮
- 交互式测试面板，提供 Apifox 风格的 UI
- 支持同时测试多个端点

### 🎯 智能参数识别
- **路径参数**：路由中的 `{id}`
- **查询参数**：`[FromQuery]` 特性
- **请求体**：`[FromBody]` 特性，完整解析 C# 类
- **请求头**：`[FromHeader]` 特性
- **表单数据**：`[FromForm]` 特性，支持文件上传

### 🤖 AI 驱动的 JSON 生成
- 基于 C# 类定义生成真实的测试数据
- 理解属性名称、类型和 C# XML 注释
- 读取 C# 类特性以获取额外上下文
- 支持 OpenAI、Azure OpenAI 和自定义 AI 提供商
- 为每个 API 面板保留对话历史并支持"查看 AI"功能
- 一键恢复到原始模板

### 🌍 环境管理
- 支持多环境（开发、预发布、生产等）
- 每个环境具有自定义的基础 URL、基础路径和请求头
- 通过状态栏快速切换
- 每个环境独立配置请求头
- 工作区级别设置持久化

### 📝 高级功能
- **Body 编辑器**：功能完整的 JSON 编辑器，支持语法高亮、格式化和 AI 生成
- **表单数据支持**：支持 multipart 表单数据、文件上传和文本字段
- **值编辑器**：可展开的模态编辑器，用于编辑长请求头/查询参数值
- **响应查看器**：带语法高亮和可折叠结构的格式化 JSON 响应
- **请求历史**：查看 AI 对话历史并恢复原始 JSON 模板
- **智能选项卡选择**：自动打开最相关的选项卡（Form/Body/Query/Headers）
- **性能优化**：可配置的搜索策略（fast/balanced/thorough）用于类定义查找
- **参数持久化**：自动保存和恢复每个环境的测试参数（URL、请求头、查询参数、请求体、表单数据）
- **缓存管理**：清除缓存的参数和类定义，强制刷新 API 检测

## 📦 安装

### 从 VS Code 市场安装
1. 打开 VS Code
2. 按 `Ctrl+Shift+X`（Windows/Linux）或 `Cmd+Shift+X`（Mac）
3. 搜索"C# API Tester"
4. 点击安装

### 从 VSIX 文件安装
1. 下载 `.vsix` 文件
2. 打开 VS Code
3. 按 `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
4. 选择下载的文件

## 🚀 快速开始

### 1. 基本使用

打开一个 C# 控制器文件：

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public async Task<ActionResult<User>> GetUser(int id)
    {
        // 你的代码
    }

    [HttpPost]
    public async Task<ActionResult<User>> CreateUser([FromBody] CreateUserDto userDto)
    {
        // 你的代码
    }
}
```

你将在每个方法上方看到 **"🚀 测试 API"** 按钮。点击即可测试！

### 2. 环境设置

首次使用？设置你的环境：

1. 点击状态栏中的环境指示器
2. 选择"添加新环境"
3. 配置：
   - **名称**："开发环境"
   - **基础 URL**："http://localhost:5000"
   - **基础路径**："/api"（可选）
   - **请求头**：`{"Authorization": "Bearer token"}`

### 3. AI 配置（可选）

启用 AI 驱动的 JSON 生成：

1. 打开设置：`Ctrl+,` → 搜索"C# API Tester"
2. 配置 AI 设置：
   ```json
   {
     "csharpApiTester.ai.enabled": true,
     "csharpApiTester.ai.provider": "openai",
     "csharpApiTester.ai.apiKey": "sk-...",
     "csharpApiTester.ai.model": "gpt-3.5-turbo"
   }
   ```

## 📖 功能详解

### 表单数据和文件上传

支持 `[FromForm]` 参数：

```csharp
[HttpPost("upload")]
public async Task<IActionResult> UploadFile(
    [FromForm] IFormFile file,
    [FromForm] string title,
    [FromForm] string description)
{
    // 处理文件上传
}
```

扩展会自动：
- 在测试面板中创建 **Form** 选项卡
- 检测文件字段（`IFormFile`、`Stream`、`byte[]`）
- 支持文本字段和文件输入
- 发送 `multipart/form-data` 请求

### AI 智能生成

当测试具有复杂请求体的端点时：

1. 在 Body 选项卡中点击 **"🤖 AI 生成"** 按钮
2. AI 分析你的 C# 类定义，包括：
   - 属性名称和类型
   - XML 文档注释（`/// <summary>`）
   - 数据注解特性
   - 嵌套类结构
   ```csharp
   public class CreateUserDto
   {
       /// <summary>
       /// 用户全名
       /// </summary>
       [Required]
       [MaxLength(100)]
       public string Name { get; set; }

       /// <summary>
       /// 邮箱地址
       /// </summary>
       [EmailAddress]
       public string Email { get; set; }

       public int Age { get; set; }

       public AddressDto Address { get; set; }
   }
   ```
3. AI 生成符合所有约束的真实测试数据
4. 使用 **"💬 查看 AI"** 按钮查看 AI 对话和提示词
5. 使用 **"↺ 恢复"** 按钮恢复原始 JSON 模板
6. 每个 API 面板的对话历史都会被保留

### 选项卡优先级

测试面板智能选择默认选项卡：

- **Form 选项卡** → 如果存在 `[FromForm]` 参数
- **Body 选项卡** → 如果存在 `[FromBody]` 参数
- **Query 选项卡** → 如果存在 `[FromQuery]` 参数
- **Headers 选项卡** → 默认选项

### 参数持久化

扩展会自动为每个环境的每个 API 端点保存测试参数：

- **自动保存**：当你修改 URL、请求头、查询参数、请求体或表单数据时，参数会自动保存
- **自动恢复**：重新打开测试面板时，会自动恢复之前保存的参数
- **环境感知**：每个环境为同一端点维护独立的参数集
- **缓存数据**：包括 URL、HTTP 方法、请求头、查询参数、请求体和表单数据

要使用默认值重新开始，请从 CodeLens 按钮或命令面板使用 **"清除缓存并测试"** 命令。

## ⚙️ 配置

### 扩展设置

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `csharpApiTester.timeout` | 请求超时时间（毫秒） | 30000 |
| `csharpApiTester.enableApiDetection` | 启用自动 API 检测和 CodeLens | true |
| `csharpApiTester.searchStrategy` | 类定义搜索策略 | "balanced" |
| `csharpApiTester.searchFileLimit` | 最大搜索文件数（仅自定义策略） | 2000 |
| `csharpApiTester.ai.enabled` | 启用 AI 功能 | false |
| `csharpApiTester.ai.provider` | AI 提供商（openai/azure-openai/custom） | "openai" |
| `csharpApiTester.ai.apiKey` | AI API 密钥 | "" |
| `csharpApiTester.ai.endpoint` | AI API 端点 URL | OpenAI 默认值 |
| `csharpApiTester.ai.model` | AI 模型名称 | "gpt-3.5-turbo" |
| `csharpApiTester.ai.maxTokens` | 每次请求的最大 tokens | 1000 |
| `csharpApiTester.ai.timeout` | AI 请求超时时间（毫秒） | 60000 |
| `csharpApiTester.ai.systemPrompt` | AI 的系统提示词 | 默认提示词 |

### 搜索策略

根据项目大小选择搜索策略：

- **fast**：搜索最多 500 个 .cs 文件（适合小型项目）
- **balanced**：搜索最多 1000 个 .cs 文件（推荐用于大多数项目）
- **thorough**：搜索最多 2000 个 .cs 文件（适合大型 monorepo）
- **custom**：使用 `searchFileLimit` 设置指定确切限制

### AI 提供商配置

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

#### 自定义提供商
```json
{
  "csharpApiTester.ai.provider": "custom",
  "csharpApiTester.ai.apiKey": "your-key",
  "csharpApiTester.ai.endpoint": "https://your-api.com/v1/chat/completions"
}
```

## 🎯 高级用法

### 多环境配置

快速切换环境：

```json
// .vscode/settings.json
{
  "csharpApiTester.environments": [
    {
      "name": "开发环境",
      "baseUrl": "http://localhost:5000",
      "basePath": "/api",
      "headers": {
        "Authorization": "Bearer dev-token"
      }
    },
    {
      "name": "预发布环境",
      "baseUrl": "https://staging-api.example.com",
      "basePath": "",
      "headers": {
        "Authorization": "Bearer staging-token"
      }
    }
  ]
}
```

### 可展开值编辑器

对于长请求头值或查询参数：
- 点击输入框旁边的 **⤢** 图标
- 在大文本区域中编辑
- 保存更改回字段

## 🔧 命令

| 命令 | 描述 |
|------|------|
| `C#HttpRequest: Test API Endpoint` | 为选定端点打开测试面板 |
| `C#HttpRequest: Clear Cache And Test` | 清除缓存的参数和类定义，然后使用新数据测试端点 |
| `C#HttpRequest: Manage API Environments` | 打开环境管理对话框 |
| `C#HttpRequest: Switch Environment` | 在环境之间快速切换 |
| `C#HttpRequest: Configure API Base URL` | 为当前环境设置基础 URL |
| `C#HttpRequest: Toggle API Detection` | 启用/禁用自动 API 检测 |
| `C#HttpRequest: Test Debug` | 验证扩展激活 |
| `C#HttpRequest: Debug API Detection` | 在控制台中查看检测到的端点 |

## 📝 使用场景

此扩展非常适合：

- **后端开发者**：直接从控制器代码测试 API
- **API 开发**：开发过程中快速原型设计和测试
- **文档编写**：为 API 文档生成示例请求
- **测试**：无需离开编辑器即可快速手动测试
- **学习**：通过交互式测试理解 API 行为

## 💡 技巧与窍门

### CodeLens 可见性
- CodeLens 按钮会自动出现在 API 方法上方
- 使用 `C#HttpRequest: Toggle API Detection` 启用/禁用
- 如果 CodeLens 没有立即出现，请刷新文档

### AI 生成最佳实践
- 添加 XML 文档注释以便 AI 更好地理解
- 使用描述性属性名称（例如 `userEmail` 而不是 `e1`）
- 包含数据注解特性以生成真实数据
- 在发送请求前检查并编辑 AI 生成的值

### 性能优化
- 对于大型项目，使用"fast"搜索策略以提高性能
- 对于复杂 DTO 的更好准确性，使用"thorough"策略
- 自定义策略允许根据具体需求进行微调

### 参数管理
- 扩展会自动保存你的测试参数（请求头、请求体、查询参数等）
- 参数为每个环境单独保存
- 要重置为默认值，请从 CodeLens 按钮或命令面板使用 **"清除缓存并测试"** 命令
- 清除缓存还会刷新类定义，以确保准确的请求生成

## 🛠️ 故障排除

### CodeLens 不显示
1. 确保文件是带有 `[ApiController]` 或 `[Route]` 特性的 C# 控制器
2. 检查设置中是否启用了 API 检测
3. 尝试重新加载 VS Code 窗口（`Developer: Reload Window`）

### AI 生成失败
1. 验证 AI 是否已启用：`csharpApiTester.ai.enabled`
2. 检查 API 密钥是否正确配置
3. 先用简单端点测试配置
4. 查看控制台输出以获取详细错误信息

### 环境无法切换
1. 点击状态栏中的环境指示器
2. 从列表中选择所需环境
3. 验证工作区设置中的环境配置

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 仓库
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 打开 Pull Request

## 🐛 问题报告

发现 bug？请提交 issue，包含：
- VS Code 版本
- 扩展版本
- 重现步骤
- 期望行为 vs 实际行为

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- 使用 [VS Code Extension API](https://code.visualstudio.com/api) 构建
- HTTP 客户端由 [Axios](https://axios-http.com/) 驱动
- UI 灵感来自 [Apifox](https://apifox.com/)
- AI 集成支持 OpenAI 及兼容提供商

## 🔗 链接

- [GitHub 仓库](https://github.com/javaer996/csharp-api-tester)
- [VS Code 市场](https://marketplace.visualstudio.com/items?itemName=javaer996.csharp-api-tester)
- [问题报告](https://github.com/javaer996/csharp-api-tester/issues)
- [功能建议](https://github.com/javaer996/csharp-api-tester/issues/new?labels=enhancement)

---

**享受测试你的 C# APIs！🚀**

如果你觉得这个扩展有用，请考虑：
- ⭐ 为 [GitHub 仓库](https://github.com/javaer996/csharp-api-tester)加星
- 📝 在 [VS Code 市场](https://marketplace.visualstudio.com/items?itemName=javaer996.csharp-api-tester)留下评价
- 🐛 报告问题或提出功能建议
