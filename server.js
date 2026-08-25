const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5188);
const DATA_FILE = process.env.KB_DATA_FILE || path.join(ROOT, "data", "knowledge-library.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const KB_PASSWORD = process.env.KB_PASSWORD || "";
const KB_API_TOKEN = process.env.KB_API_TOKEN || "";

const TYPES = new Set(["paper", "wechat", "post", "webpage", "project", "interview"]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeExcerpts(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return { text: item.trim(), note: "" };
        return {
          text: String(item?.text || "").trim(),
          note: String(item?.note || "").trim()
        };
      })
      .filter((item) => item.text);
  }
  return normalizeList(value).map((text) => ({ text, note: "" }));
}

function slugPart(text) {
  return String(text || "item")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "item";
}

function asciiSlug(text) {
  return String(text || "item")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "item";
}

function makeId(title) {
  return `item_${slugPart(title)}_${crypto.randomBytes(3).toString("hex")}`;
}

async function ensureDataFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ items: [] }, null, 2));
  }
}

async function loadLibrary() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { items: Array.isArray(parsed.items) ? parsed.items : [] };
}

async function saveLibrary(library) {
  await fs.writeFile(DATA_FILE, JSON.stringify(library, null, 2) + "\n");
}

function clientPassword(req) {
  return req.headers["x-kb-password"] || "";
}

function clientToken(req) {
  return req.headers["x-kb-api-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
}

function requirePassword(req, res) {
  if (!KB_PASSWORD) return true;
  if (clientPassword(req) === KB_PASSWORD) return true;
  sendJson(res, 401, { error: "Access password is required." });
  return false;
}

function requireRetrievalAuth(req, res) {
  if (KB_API_TOKEN && clientToken(req) === KB_API_TOKEN) return true;
  return requirePassword(req, res);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function inferType(input) {
  const text = String(input || "").toLowerCase();
  if (text.includes("mp.weixin.qq.com")) return "wechat";
  if (text.includes("arxiv.org") || text.includes("doi.org") || text.includes("scholar.google")) return "paper";
  if (text.includes("zhihu.com") || text.includes("x.com") || text.includes("twitter.com") || text.includes("reddit.com")) return "post";
  return "webpage";
}

function inferPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "mp.weixin.qq.com") return "微信公众号";
    if (host.includes("arxiv.org")) return "arXiv";
    if (host.includes("doi.org")) return "DOI";
    if (host.includes("zhihu.com")) return "知乎";
    if (host.includes("github.com")) return "GitHub";
    if (host.includes("x.com") || host.includes("twitter.com")) return "X";
    return host;
  } catch {
    return "";
  }
}

function normalizeItem(body, existing) {
  const now = new Date().toISOString();
  const title = String(body.title || "").trim();
  if (!title) {
    const error = new Error("Title is required.");
    error.status = 400;
    throw error;
  }

  const type = TYPES.has(body.type) ? body.type : inferType(body.source_url || body.raw_input || title);
  const sourceUrl = String(body.source_url || "").trim();
  const duplicate = sourceUrl
    ? existing.find((item) => item.source_url && item.source_url === sourceUrl)
    : null;

  if (duplicate && duplicate.id !== body.id) {
    const error = new Error("Duplicate source URL.");
    error.status = 409;
    error.existing = duplicate;
    throw error;
  }

  return {
    id: body.id || makeId(title),
    title,
    type,
    source_url: sourceUrl,
    source_platform: String(body.source_platform || inferPlatform(sourceUrl)).trim(),
    summary: String(body.summary || "").trim(),
    key_points: normalizeList(body.key_points),
    tags: normalizeList(body.tags),
    use_cases: normalizeList(body.use_cases),
    personal_note: String(body.personal_note || "").trim(),
    excerpts: normalizeExcerpts(body.excerpts),
    type_details: normalizeTypeDetails(type, body.type_details || body),
    visibility: "private",
    obsidian_sync: {
      enabled: Boolean(body.obsidian_sync?.enabled),
      path: String(body.obsidian_sync?.path || ""),
      last_synced_at: String(body.obsidian_sync?.last_synced_at || "")
    },
    created_at: body.created_at || now,
    updated_at: now
  };
}

function normalizeTypeDetails(type, details) {
  const fieldMap = {
    paper: ["authors", "year", "doi", "research_question", "method", "main_conclusion", "why_saved"],
    wechat: ["account", "author", "published_at"],
    post: ["author", "published_at"],
    webpage: ["author", "published_at"],
    project: ["background", "goal", "what_i_did", "tech_stack", "challenges", "result", "evidence_links", "answerable_questions"],
    interview: ["background", "goal", "what_i_did", "tech_stack", "challenges", "result", "evidence_links", "answerable_questions"]
  };
  const normalized = {};
  for (const field of fieldMap[type] || []) {
    if (["authors", "tech_stack", "evidence_links", "answerable_questions"].includes(field)) {
      normalized[field] = normalizeList(details[field]);
    } else {
      normalized[field] = String(details[field] || "").trim();
    }
  }
  return normalized;
}

function itemSearchText(item) {
  return [
    item.title,
    item.type,
    item.source_platform,
    item.summary,
    item.personal_note,
    ...(item.key_points || []),
    ...(item.tags || []),
    ...(item.use_cases || []),
    ...(item.excerpts || []).map((excerpt) => excerpt.text),
    ...Object.values(item.type_details || {}).flat()
  ].join(" ").toLowerCase();
}

function filterItems(items, params) {
  const q = String(params.get("q") || "").trim().toLowerCase();
  const type = String(params.get("type") || "").trim();
  const tag = String(params.get("tag") || "").trim().toLowerCase();
  const useCase = String(params.get("use_case") || "").trim().toLowerCase();

  return items.filter((item) => {
    if (type && item.type !== type) return false;
    if (tag && !(item.tags || []).some((value) => value.toLowerCase().includes(tag))) return false;
    if (useCase && !(item.use_cases || []).some((value) => value.toLowerCase().includes(useCase))) return false;
    if (q && !itemSearchText(item).includes(q)) return false;
    return true;
  });
}

function scoreItem(item, query) {
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) return 0;
  const text = itemSearchText(item);
  let score = 0;
  for (const word of words) {
    if (item.title.toLowerCase().includes(word)) score += 5;
    if ((item.use_cases || []).join(" ").toLowerCase().includes(word)) score += 4;
    if ((item.tags || []).join(" ").toLowerCase().includes(word)) score += 3;
    if (text.includes(word)) score += 1;
  }
  return score;
}

function compactForRetrieval(item, score) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    score,
    summary: item.summary,
    key_points: item.key_points || [],
    use_cases: item.use_cases || [],
    tags: item.tags || [],
    source_url: item.source_url,
    source_platform: item.source_platform,
    excerpts: (item.excerpts || []).slice(0, 3).map((excerpt) => excerpt.text),
    personal_note: item.personal_note
  };
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function itemToMarkdown(item) {
  const frontmatter = [
    "---",
    `kb_id: ${item.id}`,
    `type: ${item.type}`,
    `source_url: ${JSON.stringify(item.source_url || "")}`,
    `source_platform: ${JSON.stringify(item.source_platform || "")}`,
    "tags:",
    ...(item.tags || []).map((tag) => `  - ${tag}`),
    "use_cases:",
    ...(item.use_cases || []).map((useCase) => `  - ${useCase}`),
    "---"
  ].join("\n");

  const keyPoints = (item.key_points || []).map((point) => `- ${point}`).join("\n") || "- ";
  const excerpts = (item.excerpts || []).map((excerpt) => `> ${excerpt.text}${excerpt.note ? `\n>\n> Note: ${excerpt.note}` : ""}`).join("\n\n") || "> ";

  return `${frontmatter}

# ${item.title}

## Summary

${escapeMarkdown(item.summary)}

## Key Points

${keyPoints}

## Excerpts

${excerpts}

## Personal Note

${escapeMarkdown(item.personal_note)}

## Source

${item.source_url || ""}
`;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pickMeta(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return htmlToText(match[1]);
  }
  return "";
}

async function previewUrl(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 MicroMessenger KnowledgeBase/0.1"
    }
  });
  const html = await response.text();
  const title = pickMeta(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ]);
  const summary = pickMeta(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
  ]);
  const text = htmlToText(html).slice(0, 1200);
  return {
    title: title || url,
    type: inferType(url),
    source_url: url,
    source_platform: inferPlatform(url),
    summary: summary || text.slice(0, 240),
    excerpts: text ? [{ text: text.slice(0, 500), note: "Auto extracted preview" }] : []
  };
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, auth_required: Boolean(KB_PASSWORD) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/items") {
    if (!requirePassword(req, res)) return;
    const library = await loadLibrary();
    sendJson(res, 200, { items: filterItems(library.items, url.searchParams) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/items") {
    if (!requirePassword(req, res)) return;
    const body = await readBody(req);
    const library = await loadLibrary();
    try {
      const item = normalizeItem(body, library.items);
      library.items.unshift(item);
      await saveLibrary(library);
      sendJson(res, 201, { item });
    } catch (error) {
      if (error.status === 409) {
        sendJson(res, 409, { error: error.message, existing: error.existing });
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/preview") {
    if (!requirePassword(req, res)) return;
    const body = await readBody(req);
    const input = String(body.input || body.url || "").trim();
    if (!input) {
      sendJson(res, 400, { error: "Input is required." });
      return;
    }
    if (/^https?:\/\//i.test(input)) {
      try {
        sendJson(res, 200, { preview: await previewUrl(input) });
      } catch (error) {
        sendJson(res, 200, {
          preview: {
            title: input,
            type: inferType(input),
            source_url: input,
            source_platform: inferPlatform(input),
            summary: "",
            excerpts: []
          },
          warning: "Could not fetch source. You can still save manually."
        });
      }
      return;
    }
    sendJson(res, 200, {
      preview: {
        title: input.slice(0, 60),
        type: "webpage",
        source_url: "",
        source_platform: "manual",
        summary: input.slice(0, 240),
        excerpts: [{ text: input.slice(0, 500), note: "Manual text" }]
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/retrieve") {
    if (!requireRetrievalAuth(req, res)) return;
    const body = await readBody(req);
    const query = String(body.query || "").trim();
    const limit = Math.min(Number(body.limit || 5), 10);
    const library = await loadLibrary();
    const results = library.items
      .map((item) => ({ item, score: scoreItem(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => compactForRetrieval(entry.item, entry.score));
    sendJson(res, 200, { query, results });
    return;
  }

  const obsidianMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/obsidian$/);
  if (req.method === "GET" && obsidianMatch) {
    if (!requirePassword(req, res)) return;
    const library = await loadLibrary();
    const itemId = decodeURIComponent(obsidianMatch[1]);
    const item = library.items.find((entry) => entry.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: "Item not found." });
      return;
    }
    const filename = `${asciiSlug(item.id)}.md`;
    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    });
    res.end(itemToMarkdown(item));
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Unexpected server error." });
  }
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Lynx personal KB is running at http://localhost:${PORT}`);
  });
}

module.exports = {
  normalizeItem,
  inferType,
  inferPlatform,
  itemToMarkdown,
  scoreItem,
  filterItems
};
