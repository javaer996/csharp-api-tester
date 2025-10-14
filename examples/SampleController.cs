using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace WebApiDemo.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class UsersController : ControllerBase
    {
        [HttpGet]
        public async Task<ActionResult<IEnumerable<User>>> GetUsers(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? search = null)
        {
            // Sample implementation
            return Ok(new List<User>());
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<User>> GetUser(int id)
        {
            // Sample implementation
            return Ok(new User { Id = id, Name = "Sample User" });
        }

        [HttpPost]
        public async Task<ActionResult<User>> CreateUser([FromBody] CreateUserDto userDto)
        {
            // Sample implementation
            var user = new User
            {
                Id = 1,
                Name = userDto.Name,
                Email = userDto.Email
            };
            return CreatedAtAction(nameof(GetUser), new { id = user.Id }, user);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateUser(int id, [FromBody] UpdateUserDto userDto)
        {
            // Sample implementation
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteUser(int id)
        {
            // Sample implementation
            return NoContent();
        }

        [HttpPost("{id}/activate")]
        public async Task<IActionResult> ActivateUser(int id, [FromQuery] bool sendEmail = true)
        {
            // Sample implementation
            return Ok();
        }
    }

    [ApiController]
    [Route("api/products")]
    public class ProductsController : ControllerBase
    {
        [HttpGet]
        public async Task<ActionResult<IEnumerable<Product>>> GetProducts(
            [FromQuery] string? category = null,
            [FromQuery] decimal? minPrice = null,
            [FromQuery] decimal? maxPrice = null)
        {
            // Sample implementation
            return Ok(new List<Product>());
        }

        [HttpPost]
        public async Task<ActionResult<Product>> CreateProduct([FromBody] CreateProductDto productDto)
        {
            // Sample implementation
            var product = new Product
            {
                Id = 1,
                Name = productDto.Name,
                Price = productDto.Price,
                Category = productDto.Category
            };
            return CreatedAtAction(nameof(GetProduct), new { id = product.Id }, product);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<Product>> GetProduct(int id)
        {
            // Sample implementation
            return Ok(new Product { Id = id, Name = "Sample Product", Price = 99.99m });
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateProduct(int id, [FromBody] UpdateProductDto productDto)
        {
            // Sample implementation
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteProduct(int id)
        {
            // Sample implementation
            return NoContent();
        }
    }

    [ApiController]
    [Route("api/upload")]
    public class UploadController : ControllerBase
    {
        /// <summary>
        /// 上传单个文件
        /// </summary>
        [HttpPost("single")]
        public async Task<IActionResult> UploadSingleFile([FromForm] IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest("No file uploaded");

            // Sample implementation
            return Ok(new
            {
                FileName = file.FileName,
                Size = file.Length,
                ContentType = file.ContentType
            });
        }

        /// <summary>
        /// 上传文件并带表单数据
        /// </summary>
        [HttpPost("with-data")]
        public async Task<IActionResult> UploadFileWithData(
            [FromForm] IFormFile file,
            [FromForm] string title,
            [FromForm] string description,
            [FromForm] string category)
        {
            if (file == null || file.Length == 0)
                return BadRequest("No file uploaded");

            // Sample implementation
            return Ok(new
            {
                FileName = file.FileName,
                Size = file.Length,
                Title = title,
                Description = description,
                Category = category
            });
        }

        /// <summary>
        /// 上传多个文件
        /// </summary>
        [HttpPost("multiple")]
        public async Task<IActionResult> UploadMultipleFiles([FromForm] List<IFormFile> files)
        {
            if (files == null || files.Count == 0)
                return BadRequest("No files uploaded");

            // Sample implementation
            var fileInfos = files.Select(f => new
            {
                FileName = f.FileName,
                Size = f.Length,
                ContentType = f.ContentType
            });

            return Ok(fileInfos);
        }

        /// <summary>
        /// 上传图片并生成缩略图
        /// </summary>
        [HttpPost("image")]
        public async Task<IActionResult> UploadImage(
            [FromForm] IFormFile image,
            [FromForm] int width = 800,
            [FromForm] int height = 600,
            [FromForm] bool generateThumbnail = true)
        {
            if (image == null || image.Length == 0)
                return BadRequest("No image uploaded");

            // Sample implementation
            return Ok(new
            {
                FileName = image.FileName,
                Size = image.Length,
                Width = width,
                Height = height,
                ThumbnailGenerated = generateThumbnail
            });
        }

        /// <summary>
        /// 提交表单数据(无文件)
        /// </summary>
        [HttpPost("form-only")]
        public async Task<IActionResult> SubmitFormData(
            [FromForm] string username,
            [FromForm] string email,
            [FromForm] string phone,
            [FromForm] int age,
            [FromForm] bool subscribe = false)
        {
            // Sample implementation
            return Ok(new
            {
                Username = username,
                Email = email,
                Phone = phone,
                Age = age,
                Subscribe = subscribe
            });
        }

        /// <summary>
        /// 上传用户头像
        /// </summary>
        [HttpPost("avatar/{userId}")]
        public async Task<IActionResult> UploadAvatar(
            int userId,
            [FromForm] IFormFile avatar,
            [FromForm] string displayName)
        {
            if (avatar == null || avatar.Length == 0)
                return BadRequest("No avatar uploaded");

            // Sample implementation
            return Ok(new
            {
                UserId = userId,
                DisplayName = displayName,
                AvatarFileName = avatar.FileName,
                AvatarSize = avatar.Length
            });
        }
    }

    // DTOs and Models
    public class User
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public bool IsActive { get; set; }
    }

    public class CreateUserDto
    {   
        // 姓名
        public string Name { get; set; } = string.Empty;
        // 邮箱
        public string Email { get; set; } = string.Empty;
        // 密码
        public string Password { get; set; } = string.Empty;
    }

    public class UpdateUserDto
    {
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
    }

    public class Product
    {
        // id
        public int Id { get; set; }
        // 商品名
        public string Name { get; set; } = string.Empty;
        // 类别
        public string Category { get; set; } = string.Empty;
        // 价格
        public decimal Price { get; set; }
        // 是否可用
        public bool IsAvailable { get; set; }
    }

    public class CreateProductDto
    {
        // 商品名
        public string Name { get; set; } = string.Empty;
        // 类别
        public string Category { get; set; } = string.Empty;
        // 价格
        public decimal Price { get; set; }
    }

    public class UpdateProductDto
    {
        public string Name { get; set; } = string.Empty;
        public string Category { get; set; } = string.Empty;
        public decimal Price { get; set; }
        public bool IsAvailable { get; set; }
    }
}