# C# API 测试工具 for Visual Studio Code

English | [中文文档](./README.zh-CN.md)

一个智能的 Visual Studio Code 扩展，可以直接从代码编辑器中自动检测和测试 C# Web API 端点，并支持 AI 驱动的智能 JSON 生成。

![Version](https://img.shields.io/badge/version-0.1.0-blue)
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
- 理解属性名称和类型
- 读取 C# 注释和特性以获取上下文
- 支持 OpenAI、Azure OpenAI 和自定义 AI 提供商
- 为每个 API 面板保留对话历史

### 🌍 环境管理
- 支持多环境（开发、预发布、生产等）
- 每个环境具有自定义的基础 URL、基础路径和请求头
- 快速切换环境
- 全局请求头配置

### 📝 高级功能
- **Body 编辑器**：功能完整的 JSON 编辑器，支持格式化和 AI 生成
- **表单数据支持**：文件上传和表单字段测试
- **值编辑器**：长请求头/查询值的可展开编辑器
- **响应查看器**：带语法高亮的格式化 JSON
- **请求历史**：查看 AI 对话并恢复原始 JSON

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

1. 点击 **"🤖 AI 生成"** 按钮
2. AI 分析你的 C# 类定义：
   ```csharp
   public class CreateUserDto
   {
       /// <summary>
       /// 用户全名
       /// </summary>
       public string Name { get; set; }

       /// <summary>
       /// 邮箱地址
       /// </summary>
       public string Email { get; set; }

       public int Age { get; set; }
   }
   ```
3. 根据属性名称、类型和注释生成真实的测试数据
4. 使用 **"💬 查看 AI"** 按钮查看 AI 对话
5. 使用 **"↺ 恢复"** 按钮恢复原始模板

### 选项卡优先级

测试面板智能选择默认选项卡：

- **Form 选项卡** → 如果存在 `[FromForm]` 参数
- **Body 选项卡** → 如果存在 `[FromBody]` 参数
- **Query 选项卡** → 如果存在 `[FromQuery]` 参数
- **Headers 选项卡** → 默认选项

## ⚙️ 配置

### 扩展设置

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `csharpApiTester.timeout` | 请求超时时间（毫秒） | 30000 |
| `csharpApiTester.ai.enabled` | 启用 AI 功能 | false |
| `csharpApiTester.ai.provider` | AI 提供商 | "openai" |
| `csharpApiTester.ai.apiKey` | AI API 密钥 | "" |
| `csharpApiTester.ai.endpoint` | AI API 端点 | "https://api.openai.com/v1/chat/completions" |
| `csharpApiTester.ai.model` | AI 模型 | "gpt-3.5-turbo" |
| `csharpApiTester.ai.maxTokens` | 最大 tokens | 1000 |

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
| `C#HttpRequest: Test Debug` | 验证扩展激活 |
| `C#HttpRequest: Debug API Detection` | 在控制台中查看检测到的端点 |
| `C#HttpRequest: Manage Environments` | 打开环境管理 |

## 📝 示例

查看 `examples/` 文件夹中的综合示例：

- **UsersController**：带 DTO 的 CRUD 操作
- **ProductsController**：复杂查询和更新
- **UploadController**：文件上传和表单数据
  - 单文件上传
  - 多文件上传
  - 文件和元数据
  - 仅表单提交
  - 带选项的图片上传

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

- 使用 VS Code Extension API 构建
- 由 TypeScript 和 Axios 驱动

---

**享受测试你的 C# APIs！🚀**
