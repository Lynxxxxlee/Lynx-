const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeItem,
  inferType,
  inferPlatform,
  itemToMarkdown,
  scoreItem,
  filterItems
} = require("../server");

test("infers common source types", () => {
  assert.equal(inferType("https://mp.weixin.qq.com/s/example"), "wechat");
  assert.equal(inferType("https://arxiv.org/abs/2401.00001"), "paper");
  assert.equal(inferType("https://zhihu.com/question/1"), "post");
  assert.equal(inferType("https://example.com/article"), "webpage");
});

test("infers source platform from URLs", () => {
  assert.equal(inferPlatform("https://mp.weixin.qq.com/s/example"), "微信公众号");
  assert.equal(inferPlatform("https://github.com/Lynxxxxlee/Lynx-"), "GitHub");
});

test("normalizes a project item", () => {
  const item = normalizeItem(
    {
      title: "远程 Mac 安全方案",
      type: "project",
      summary: "用于面试讲解的项目卡片",
      knowledge_category: "Agent",
      knowledge_subcategory: "Agent评测",
      tags: "安全, Mac",
      use_cases: "面试项目讲解",
      tech_stack: "MDM, VPN",
      result: "形成分层安全方案"
    },
    []
  );

  assert.equal(item.type, "project");
  assert.equal(item.knowledge_category, "Agent");
  assert.equal(item.knowledge_subcategory, "Agent评测");
  assert.deepEqual(item.tags, ["安全", "Mac"]);
  assert.deepEqual(item.type_details.tech_stack, ["MDM", "VPN"]);
});

test("rejects duplicate source URL", () => {
  const existing = [
    normalizeItem(
      {
        title: "已有文章",
        type: "wechat",
        source_url: "https://mp.weixin.qq.com/s/a"
      },
      []
    )
  ];

  assert.throws(
    () =>
      normalizeItem(
        {
          title: "重复文章",
          type: "wechat",
          source_url: "https://mp.weixin.qq.com/s/a"
        },
        existing
      ),
    /Duplicate source URL/
  );
});

test("scores matching use cases and tags", () => {
  const item = normalizeItem(
    {
      title: "JSSP 论文背景",
      type: "paper",
      summary: "调度问题研究",
      tags: "JSSP, 论文",
      use_cases: "毕业论文背景"
    },
    []
  );

  assert.ok(scoreItem(item, "JSSP 毕业论文") > 0);
});

test("filters items by query and type", () => {
  const items = [
    normalizeItem({ title: "公众号资料", type: "wechat", tags: "学习" }, []),
    normalizeItem({ title: "论文资料", type: "paper", tags: "学习" }, [])
  ];
  const params = new URLSearchParams("q=论文&type=paper");
  const result = filterItems(items, params);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "paper");
});

test("filters items by knowledge category and subcategory", () => {
  const items = [
    normalizeItem({ title: "Agent 评测资料", type: "wechat", knowledge_category: "Agent", knowledge_subcategory: "Agent评测" }, []),
    normalizeItem({ title: "LLM 科普资料", type: "wechat", knowledge_category: "LLM", knowledge_subcategory: "科普" }, [])
  ];
  const params = new URLSearchParams("category=Agent&subcategory=Agent%E8%AF%84%E6%B5%8B");
  const result = filterItems(items, params);
  assert.equal(result.length, 1);
  assert.equal(result[0].knowledge_subcategory, "Agent评测");
});

test("exports Obsidian markdown", () => {
  const item = normalizeItem(
    {
      title: "论文卡片",
      type: "paper",
      source_url: "https://arxiv.org/abs/2401.00001",
      tags: "JSSP",
      use_cases: "论文写作",
      summary: "摘要",
      key_points: ["观点一"]
    },
    []
  );
  const markdown = itemToMarkdown(item);
  assert.match(markdown, /kb_id:/);
  assert.match(markdown, /# 论文卡片/);
  assert.match(markdown, /论文写作/);
});
