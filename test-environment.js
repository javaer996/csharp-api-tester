const { ApiRequestGenerator } = require('./out/apiRequestGenerator');
const { ApiEndpointDetector } = require('./out/apiEndpointDetector');

// Test environment-aware request generation
const mockDocument = {
    getText: () => `
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
}`,
    languageId: 'csharp',
    fileName: 'test.cs',
    uri: { path: '/test.cs' }
};

console.log('🌍 Testing Environment-Aware Request Generation...');

try {
    const detector = new ApiEndpointDetector();
    const requestGenerator = new ApiRequestGenerator();

    // Create mock endpoint
    const endpoint = {
        method: 'GET',
        route: '/api/users/123',
        parameters: [
            {
                name: 'id',
                type: 'int',
                source: 'path',
                required: true
            }
        ],
        returnType: 'User',
        line: 9,
        character: 0,
        methodName: 'GetUser',
        controllerName: 'Users'
    };

    // Test with environment
    const environment = {
        name: 'Development',
        baseUrl: 'http://localhost:5000',
        basePath: '/api',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer token123'
        },
        active: true
    };

    const result = requestGenerator.generateRequestForEnvironment(endpoint, environment);

    console.log('✅ Environment request generation result:');
    console.log('Method:', result.method);
    console.log('URL:', result.url);
    console.log('Headers:', result.headers);
    console.log('Route parsed:', result.url.replace(environment.baseUrl, ''));

} catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
}