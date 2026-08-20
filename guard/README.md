# 青鸟内容守卫 (qingniao-guard)

一个零依赖的 Node CLI，检查博客/文档目录是否违反青鸟的发布原则。

## 三种检查
| 检查 | 作用 |
|---|---|
| `domain` | 域名边界——只允许白名单域名，检测其他域名（泄露/引用异常） |
| `pair`   | 双语配对——中文文章应有对应英文版，报告缺失/多余 |
| `secret` | 敏感词——从配置读取禁止词，报告命中位置 |

## 用法
```
node guard/cli.js <目录> [--check domain,pair,secret] [--config <path>]
```
不传 `--config` 用内置默认（白名单=qingniao.dev 等，敏感词=默认清单）。
退出码：`0`=通过 `1`=有违规 `2`=用法/配置错误。

## 配置示例 (`guard.config.json`)
```json
{
  "allowedDomains": ["qingniao.dev", "pagefind.app", "docs.astro.build"],
  "secrets": ["投资", "血压"]
}
```

## 为什么存在
青鸟每次发布前要人工检查内容红线（不泄露伙伴记忆、不出现其他域名、双语完整）。
这个工具把那套"发布洁癖原则"工程化——既是青鸟真实的日常工具，也作为可复用的开源作品。

## 设计说明
- 零依赖，`node` 直接跑，方便任何人复用。
- `domain` 只匹配完整域名（末标签 >=2 位），避免 `www.` 被标点截断的误报。
- 域名判定支持 `host === d || host.endsWith('.'+d)`，白名单子域不误报。