# Lynx Personal Knowledge Base

一个私有个人知识库原型，用来从手机或电脑快速保存资料卡片，并给 Codex 提供可检索的结构化结果。

## 启动

```bash
npm start
```

默认打开：

```text
http://localhost:5188
```

如需在同一 Wi-Fi 下用手机访问，启动后查看电脑局域网 IP，再打开：

```text
http://你的电脑IP:5188
```

## 可选保护

本地开发默认不强制口令。部署或局域网长期使用时建议设置：

```bash
KB_PASSWORD=你的访问口令 KB_API_TOKEN=你的Codex检索令牌 npm start
```

网页保存时使用 `KB_PASSWORD`。Codex 检索接口可使用 `KB_API_TOKEN`。

## 第一版功能

- 保存链接或文本为知识卡片
- 按类型区分论文、公众号、帖子、网页、项目、面试材料
- 搜索、筛选、查看详情
- 生成摘要、关键观点、标签、适用场景的手动编辑卡片
- 检测重复来源链接
- 给 Codex 使用的检索接口
- 导出单条卡片为 Obsidian Markdown

## API

```text
GET /api/items
POST /api/items
POST /api/preview
POST /api/retrieve
GET /api/items/:id/obsidian
```

开发数据保存在：

```text
data/knowledge-library.json
```

后续可以把 `server.js` 中的数据读写层替换为云数据库。
