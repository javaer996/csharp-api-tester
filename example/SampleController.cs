using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Threading.Tasks;

[ApiController]
[Route("api/[controller]")]
public class SampleController : ControllerBase
{
    // Simple GET endpoint
    [HttpGet]
    public ActionResult<IEnumerable<string>> GetAll()
    {
        return Ok(new[] { "value1", "value2" });
    }

    // GET with ID parameter
    [HttpGet("{id}")]
    public ActionResult<string> GetById(int id)
    {
        return Ok($"Value for ID: {id}");
    }

    // GET with query parameters
    [HttpGet("search")]
    public ActionResult<string> Search([FromQuery] string query, [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        return Ok($"Search results for '{query}' - Page {page}, Size {pageSize}");
    }

    // POST endpoint with body
    [HttpPost]
    public ActionResult<string> Create([FromBody] CreateRequest request)
    {
        return Ok($"Created: {request.Name}");
    }

    // PUT endpoint
    [HttpPut("{id}")]
    public ActionResult<string> Update(int id, [FromBody] UpdateRequest request)
    {
        return Ok($"Updated ID {id}: {request.Name}");
    }

    // DELETE endpoint
    [HttpDelete("{id}")]
    public ActionResult Delete(int id)
    {
        return Ok($"Deleted ID: {id}");
    }

    // Complex endpoint with multiple parameters
    [HttpPost("complex/{categoryId}")]
    public ActionResult<string> ComplexEndpoint(
        int categoryId,
        [FromQuery] string filter,
        [FromHeader(Name = "Authorization")] string authHeader,
        [FromBody] ComplexRequest request)
    {
        return Ok($"Complex operation completed");
    }

    // Form data endpoint - Upload single file
    [HttpPost("upload")]
    public ActionResult<string> UploadFile([FromForm] IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest("No file uploaded");

        return Ok($"File uploaded: {file.FileName}, Size: {file.Length} bytes");
    }

    // Form data endpoint - Upload with metadata
    [HttpPost("upload-with-data")]
    public ActionResult<string> UploadWithData(
        [FromForm] IFormFile file,
        [FromForm] string title,
        [FromForm] string description)
    {
        if (file == null || file.Length == 0)
            return BadRequest("No file uploaded");

        return Ok($"File: {file.FileName}, Title: {title}, Description: {description}");
    }

    // Form data endpoint - Multiple form fields (no file)
    [HttpPost("submit-form")]
    public ActionResult<string> SubmitForm(
        [FromForm] string username,
        [FromForm] string email,
        [FromForm] int age,
        [FromForm] bool subscribe = false)
    {
        return Ok($"Form submitted - Username: {username}, Email: {email}, Age: {age}, Subscribe: {subscribe}");
    }

    // Form data endpoint - Multiple files
    [HttpPost("upload-multiple")]
    public ActionResult<string> UploadMultiple([FromForm] List<IFormFile> files)
    {
        if (files == null || files.Count == 0)
            return BadRequest("No files uploaded");

        return Ok($"Uploaded {files.Count} files");
    }
}

public class CreateRequest
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
}

public class UpdateRequest
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
}

public class ComplexRequest
{
    public string Title { get; set; } = "";
    public List<string> Tags { get; set; } = new List<string>();
    public DateTime CreatedDate { get; set; }
}