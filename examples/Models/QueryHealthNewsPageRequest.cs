using System;

namespace WebApiDemo.Models
{
    /// <summary>
    /// 健康天地文章查询请求参数
    /// </summary>
    public class QueryHealthNewsPageRequest
    {
        /// <summary>
        /// 页码（从1开始）
        /// </summary>
        public int PageIndex { get; set; } = 1;

        /// <summary>
        /// 每页数量
        /// </summary>
        public int PageSize { get; set; } = 10;

        /// <summary>
        /// 搜索关键词
        /// </summary>
        public string? Keyword { get; set; }

        /// <summary>
        /// 分类ID
        /// </summary>
        public int? CategoryId { get; set; }

        /// <summary>
        /// 开始日期
        /// </summary>
        public DateTime? StartDate { get; set; }

        /// <summary>
        /// 结束日期
        /// </summary>
        public DateTime? EndDate { get; set; }

        /// <summary>
        /// 是否只显示已发布的
        /// </summary>
        public bool OnlyPublished { get; set; } = true;

        /// <summary>
        /// 排序字段
        /// </summary>
        public string? SortBy { get; set; }

        /// <summary>
        /// 排序方向（asc/desc）
        /// </summary>
        public string? SortOrder { get; set; }
    }
}
