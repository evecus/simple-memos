# Simple Memos

极简单用户本地日记：Markdown 文本 + 文件/图片附件。单二进制，数据在本地。

## 功能

- 首次启动交互式创建管理员账号（setup）
- 日记创建 / 编辑 / 删除 / 置顶 / 归档
- `#标签` 自动解析与筛选
- 图片与文件附件上传、引用、预览/下载
- 数据目录：默认在二进制同级的 `data/`，可用 `-d` 指定

**不做：** 多用户、AI、SSO、评论、分享、多数据库。

## 运行

```bash
go run ./cmd/memos
# 浏览器打开 http://127.0.0.1:5230
```

参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `-d` | `<可执行文件目录>/data` | 数据目录（含 `memos.db` 与 `attachments/`） |
| `-addr` | `127.0.0.1:5230` | 监听地址 |

```bash
./memos -d /path/to/data -addr 0.0.0.0:5230
```

## 构建

```bash
go build -o memos ./cmd/memos
```

跨平台（示例）：

```bash
GOOS=linux GOARCH=amd64 go build -o memos-linux-amd64 ./cmd/memos
GOOS=linux GOARCH=arm64 go build -o memos-linux-arm64 ./cmd/memos
```

GitHub Actions 在 tag / `main` 推送时会构建 linux amd64 / arm64 并上传 artifact。

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | `needs_setup` / `logged_in` |
| POST | `/api/setup` | 首次创建用户 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前用户 |
| GET/POST | `/api/memos` | 列表 / 创建 |
| GET/PATCH/DELETE | `/api/memos/{id}` | 读 / 改 / 删 |
| POST | `/api/attachments` | multipart 字段 `file` |
| GET | `/api/attachments/{id}/file` | 下载（需登录） |

## License

MIT
