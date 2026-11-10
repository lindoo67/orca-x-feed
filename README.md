# X Feed — Orca 插件

在 Orca 侧边栏查看单条 X 推文和用户资料，并保存一个本地收藏列表。

## 能做什么

- 粘贴 `x.com` / `twitter.com` 链接、纯推文 ID，或 `@用户名`，回车查询
- 渲染推文正文、作者、图片、引用、统计数据（回复 / 转推 / 喜欢 / 浏览）
- 渲染用户资料卡：简介、所在地、加入时间、粉丝 / 关注数
- ☆ 收藏到本地列表（存在插件自己的 storage 里，重启不丢）
- 点击「在 X 打开」跳转浏览器（需要真实点击，Orca 会先问你）

## 不能做什么

**没有信息流、搜索和热门话题。** X 的时间线、`search` 与 `trends` 没有公开接口：

| 途径 | 状态 |
|---|---|
| `api.fxtwitter.com` 的 `/search`、`/trends` | 404，端点不存在 |
| `api.vxtwitter.com` | Cloudflare 盾，403 |
| nitter.net | 410 Gone |
| RSSHub `/twitter/user/…` | 路由已删除，302 → 404 |

唯一还能免费用的是 fxtwitter 的**单条解析**：`/{user}` 取资料、`/{user}/status/{id}` 取推文。
所以这个插件做的是「查」，不是「刷」。要真正的时间线只能走 X 官方 API，
而官方免费层每月只有极低的读取额度，时间线接口本身也不在免费层里。

## 技术要点

- **panel 没有网络**。Orca 的 panel frame 在会话层被断网，CSP 是 `img-src 'self' data:`，
  所以远程头像无法直接加载。worker 会把图片抓成 `data:` URL 再交给 panel 渲染。
- panel 通过 `orca.host.call('plugin.request', { name, input })` 调用 worker 的
  `orca.panels.handle(name, handler)`；worker 用 Node 22 的全局 `fetch`。
- 设置里的 `apiBase` 只在 worker 内读取，不从 panel 传入，避免被伪装的 panel 指到任意主机。

## 设置

| 键 | 说明 | 默认 |
|---|---|---|
| `apiBase` | 解析推文的后端，必须 https | `https://api.fxtwitter.com` |

## 许可

MIT
