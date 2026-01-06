# 灵感笔记（Supabase 数据库版）

这是一个纯前端的个人笔记网站：前端可部署到 GitHub Pages；后端数据库/登录/权限由 Supabase 提供。

## 功能

- 登录/注册（邮箱+密码）
- 笔记：新建/编辑/删除、标签、搜索、排序、置顶、图片（自动压缩）
- 权限：笔记可设为公开/私密
  - 公开：任何人可读（含未登录）
  - 写入：仅笔记所有者可写（由 Supabase RLS 策略保证）
- 显示昵称：点击右上角昵称可修改（存储在 Supabase Auth 用户 metadata）

## 本地运行

在项目目录执行：

```bash
python -m http.server 8000
```

然后访问：

- `http://localhost:8000/`

> 不建议直接双击用 `file://` 打开（ESM 模块与跨域限制可能导致脚本加载失败）。

## Supabase 配置（必须）

### 1) 创建项目

到 `https://supabase.com/` 创建一个 Project。

### 2) 创建数据表 + 权限策略（RLS）

在 Supabase Dashboard 打开 **SQL Editor**，执行：

- `supabase/schema.sql`

这会创建 `public.notes` 表，并开启/配置 RLS：
- 任何人可读取 `is_public = true` 的公开笔记
- 仅登录用户可读写自己的笔记

### 3) 开启邮箱密码登录

Supabase Dashboard → **Authentication** → **Providers** → 启用 **Email**。

如果你不想邮箱验证（测试阶段），可以在 **Authentication** → **Settings** 里关闭/调低相关限制（按你的业务需求设置）。

### 4) 填写前端配置

编辑：

- `scripts/config.js`

把下面两项替换成你的项目配置：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

位置：Supabase Dashboard → **Project Settings** → **API**。

### 5)（可选但推荐）配置站点 URL / Redirect

Supabase Dashboard → **Authentication** → **URL Configuration**：

- Site URL：填你的 GitHub Pages 网址
- Redirect URLs：添加
  - `http://localhost:8000`
  - `https://<你的用户名>.github.io/<仓库名>/`

## GitHub Pages 部署

1. 新建一个 **Public** 仓库，把本项目推送上去
2. 仓库 → **Settings** → **Pages**
   - Source：Deploy from a branch
   - Branch：`main` / Folder：`/ (root)`
3. 等待部署完成后访问：
   - `https://<你的用户名>.github.io/<仓库名>/`

## 数据在哪里

- 数据库：Supabase Postgres（表：`public.notes`）
- 登录与昵称：Supabase Auth（昵称在 `user.user_metadata.display_name`）

---

如果你希望“公开广场”显示作者昵称（而不是仅显示内容），我可以再加一个 `profiles` 表并做关联查询（同样用 RLS 保证安全）。
