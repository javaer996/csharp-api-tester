using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using WebApiDemo.Models;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace WebApiDemo.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class HealthController : ControllerBase
    {
        /// <summary>
        /// 获取健康天地文章列表
        /// </summary>
        /// <param name="req">查询参数</param>
        /// <returns>分页文章列表</returns>
        [HttpPost("page")]
        [Authorize(Policy = "MP_USER_NO_PHONE")]
        public async Task<PageResponse<HealthNewsSmallVM>> FindHealthNewsPage([FromBody] QueryHealthNewsPageRequest req)
        {
            // 模拟实现
            var response = new PageResponse<HealthNewsSmallVM>
            {
                Total = 100,
                PageIndex = req.PageIndex,
                PageSize = req.PageSize,
                Items = new List<HealthNewsSmallVM>()
            };
            return response;
        }

        /// <summary>
        /// 获取文章详情
        /// </summary>
        /// <param name="id">文章ID</param>
        /// <returns>文章详情</returns>
        [HttpGet("{id}")]
        public async Task<HealthNewsVM> GetHealthNews(int id)
        {
            return new HealthNewsVM
            {
                Id = id,
                Title = "示例文章",
                Content = "文章内容..."
            };
        }

        /// <summary>
        /// 创建健康文章
        /// </summary>
        /// <param name="dto">创建参数</param>
        /// <returns>创建结果</returns>
        [HttpPost]
        public async Task<ActionResult<HealthNewsVM>> CreateHealthNews([FromBody] CreateHealthNewsDto dto)
        {
            var news = new HealthNewsVM
            {
                Id = 1,
                Title = dto.Title,
                Content = dto.Content,
                CategoryId = dto.CategoryId
            };
            return CreatedAtAction(nameof(GetHealthNews), new { id = news.Id }, news);
        }
    }

    // 响应模型
    public class PageResponse<T>
    {
        public int Total { get; set; }
        public int PageIndex { get; set; }
        public int PageSize { get; set; }
        public List<T> Items { get; set; } = new List<T>();
    }

    public class HealthNewsSmallVM
    {
        public int Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public int CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public DateTime PublishDate { get; set; }
        public int ViewCount { get; set; }
    }

    public class HealthNewsVM
    {
        public int Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public int CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public DateTime PublishDate { get; set; }
        public DateTime CreatedAt { get; set; }
        public int ViewCount { get; set; }
        public bool IsPublished { get; set; }
    }

    public class CreateHealthNewsDto
    {
        public string Title { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public int CategoryId { get; set; }
        public bool IsPublished { get; set; }
    }
}
