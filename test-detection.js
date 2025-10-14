const { ApiEndpointDetector } = require('./out/apiEndpointDetector');

// Create a mock VS Code document
const mockDocument = {
    getText: () => `
using Microsoft.AspNetCore.Mvc;

namespace WebApiDemo.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class UsersController : ControllerBase
    {
        [HttpGet("{id}")]
        public async Task<ActionResult<User>> GetUser(int id)
        {
            return Ok(new User { Id = id });
        }

        [HttpPost]
        public async Task<ActionResult<User>> CreateUser([FromBody] CreateUserDto userDto)
        {
            return CreatedAtAction(nameof(GetUser), new { id = 1 }, userDto);
        }
    }
}`,
    languageId: 'csharp',
    fileName: 'test.cs',
    uri: { path: '/test.cs' }
};

console.log('🧪 Testing C# API Detection...');

try {
    const detector = new ApiEndpointDetector();
    const endpoints = detector.detectApiEndpoints(mockDocument);

    console.log(`\n✅ Detection complete! Found ${endpoints.length} endpoints: `);

    endpoints.forEach((endpoint, index) => {
        console.log(`\n${index + 1}. ${endpoint.method} ${endpoint.route}`);
        console.log(`   Method: ${endpoint.methodName}`);
        console.log(`   Line: ${endpoint.line}`);
        console.log(`   Parameters: ${endpoint.parameters.length}`);
        console.log(`   Return type: ${endpoint.returnType}`);
    });

    if (endpoints.length === 0) {
        console.log('❌ No endpoints detected!');
    }

} catch (error) {
    console.error('❌ Detection failed:', error);
    console.error(error.stack);
}