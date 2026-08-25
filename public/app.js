const state = {
  items: [],
  selectedItemId: "",
  password: localStorage.getItem("kb_password") || "",
  token: localStorage.getItem("kb_api_token") || ""
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  settingsButton: $("#settingsButton"),
  settingsPanel: $("#settingsPanel"),
  passwordInput: $("#passwordInput"),
  tokenInput: $("#tokenInput"),
  saveSettingsButton: $("#saveSettingsButton"),
  tabs: $$(".tab"),
  views: {
    capture: $("#captureView"),
    library: $("#libraryView"),
    retrieve: $("#retrieveView")
  },
  captureInput: $("#captureInput"),
  previewButton: $("#previewButton"),
  clearCaptureButton: $("#clearCaptureButton"),
  itemForm: $("#itemForm"),
  titleInput: $("#titleInput"),
  typeInput: $("#typeInput"),
  sourceUrlInput: $("#sourceUrlInput"),
  sourcePlatformInput: $("#sourcePlatformInput"),
  summaryInput: $("#summaryInput"),
  keyPointsInput: $("#keyPointsInput"),
  excerptsInput: $("#excerptsInput"),
  tagsInput: $("#tagsInput"),
  useCasesInput: $("#useCasesInput"),
  personalNoteInput: $("#personalNoteInput"),
  authorInput: $("#authorInput"),
  dateInput: $("#dateInput"),
  methodInput: $("#methodInput"),
  resultInput: $("#resultInput"),
  captureStatus: $("#captureStatus"),
  searchInput: $("#searchInput"),
  filterTypeInput: $("#filterTypeInput"),
  itemGrid: $("#itemGrid"),
  emptyState: $("#emptyState"),
  detailPanel: $("#detailPanel"),
  libraryCount: $("#libraryCount"),
  retrieveQueryInput: $("#retrieveQueryInput"),
  retrieveButton: $("#retrieveButton"),
  retrieveOutput: $("#retrieveOutput")
};

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-KB-Password": state.password,
    "X-KB-API-Token": state.token,
    ...extra
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function lines(value) {
  return String(value || "")
    .split(/\n|[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setStatus(message, isError = false) {
  elements.captureStatus.textContent = message;
  elements.captureStatus.classList.toggle("error", isError);
}

function typeLabel(type) {
  return {
    paper: "论文",
    wechat: "公众号",
    post: "帖子",
    webpage: "网页",
    project: "项目",
    interview: "面试"
  }[type] || type;
}

function showView(name) {
  Object.entries(elements.views).forEach(([key, view]) => {
    view.classList.toggle("hidden", key !== name);
  });
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  if (name === "library") loadItems();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: headers(options.headers || {})
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || "Request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function fillForm(preview) {
  elements.titleInput.value = preview.title || "";
  elements.typeInput.value = preview.type || "webpage";
  elements.sourceUrlInput.value = preview.source_url || "";
  elements.sourcePlatformInput.value = preview.source_platform || "";
  elements.summaryInput.value = preview.summary || "";
  elements.excerptsInput.value = (preview.excerpts || []).map((excerpt) => excerpt.text || excerpt).join("\n");
}

function buildTypeDetails(type) {
  if (type === "paper") {
    return {
      authors: lines(elements.authorInput.value),
      year: elements.dateInput.value.trim(),
      method: elements.methodInput.value.trim(),
      main_conclusion: elements.resultInput.value.trim()
    };
  }
  if (type === "project" || type === "interview") {
    return {
      tech_stack: lines(elements.methodInput.value),
      result: elements.resultInput.value.trim(),
      answerable_questions: lines(elements.useCasesInput.value)
    };
  }
  return {
    author: elements.authorInput.value.trim(),
    published_at: elements.dateInput.value.trim()
  };
}

function buildItemPayload() {
  const type = elements.typeInput.value;
  return {
    title: elements.titleInput.value.trim(),
    type,
    source_url: elements.sourceUrlInput.value.trim(),
    source_platform: elements.sourcePlatformInput.value.trim(),
    summary: elements.summaryInput.value.trim(),
    key_points: lines(elements.keyPointsInput.value),
    tags: lines(elements.tagsInput.value),
    use_cases: lines(elements.useCasesInput.value),
    personal_note: elements.personalNoteInput.value.trim(),
    excerpts: lines(elements.excerptsInput.value),
    type_details: buildTypeDetails(type)
  };
}

async function previewCapture() {
  const input = elements.captureInput.value.trim();
  if (!input) {
    setStatus("请先粘贴链接或文本。", true);
    return;
  }
  setStatus("正在读取...");
  try {
    const result = await api("/api/preview", {
      method: "POST",
      body: JSON.stringify({ input })
    });
    fillForm(result.preview);
    setStatus(result.warning || "已预填，可以继续编辑后保存。");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveItem(event) {
  event.preventDefault();
  setStatus("正在保存...");
  try {
    const result = await api("/api/items", {
      method: "POST",
      body: JSON.stringify(buildItemPayload())
    });
    state.selectedItemId = result.item.id;
    elements.itemForm.reset();
    elements.captureInput.value = "";
    setStatus("已保存。");
    await loadItems();
  } catch (error) {
    if (error.status === 409 && error.payload?.existing) {
      setStatus(`这个来源已保存：${error.payload.existing.title}`, true);
    } else {
      setStatus(error.message, true);
    }
  }
}

async function loadItems() {
  const params = new URLSearchParams();
  if (elements.searchInput.value.trim()) params.set("q", elements.searchInput.value.trim());
  if (elements.filterTypeInput.value) params.set("type", elements.filterTypeInput.value);
  try {
    const result = await api(`/api/items?${params}`);
    state.items = result.items;
    if (!state.selectedItemId && state.items[0]) state.selectedItemId = state.items[0].id;
    renderLibrary();
  } catch (error) {
    elements.itemGrid.innerHTML = "";
    elements.emptyState.classList.remove("hidden");
    elements.emptyState.textContent = error.message;
  }
}

function renderLibrary() {
  elements.libraryCount.textContent = `${state.items.length} 条资料`;
  elements.itemGrid.replaceChildren();
  elements.emptyState.classList.toggle("hidden", state.items.length > 0);

  state.items.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `item-card ${item.id === state.selectedItemId ? "active" : ""}`;
    card.innerHTML = `
      <div class="meta-row">
        <span class="pill type">${escapeHtml(typeLabel(item.type))}</span>
        <span class="pill">${escapeHtml(item.source_platform || "manual")}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary || "暂无摘要")}</p>
      <div class="tag-row">
        ${(item.tags || []).slice(0, 5).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
    card.addEventListener("click", () => {
      state.selectedItemId = item.id;
      renderLibrary();
    });
    elements.itemGrid.append(card);
  });

  renderDetail();
}

function renderList(title, values) {
  const list = (values || []).filter(Boolean);
  if (!list.length) return "";
  return `
    <div class="detail-section">
      <h4>${escapeHtml(title)}</h4>
      <ul class="detail-list">${list.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderDetail() {
  const item = state.items.find((entry) => entry.id === state.selectedItemId);
  if (!item) {
    elements.detailPanel.innerHTML = '<div class="empty-detail">选择一张卡片查看详情。</div>';
    return;
  }

  const excerpts = (item.excerpts || []).map((excerpt) => excerpt.text);
  elements.detailPanel.innerHTML = `
    <div class="detail-hero">
      <div class="meta-row">
        <span class="pill type">${escapeHtml(typeLabel(item.type))}</span>
        <span class="pill">${escapeHtml(item.source_platform || "manual")}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="detail-summary">${escapeHtml(item.summary || "暂无摘要")}</p>
      <div class="detail-actions">
        ${item.source_url ? `<a class="source-link" href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">打开来源</a>` : ""}
        <a class="secondary-button" href="/api/items/${encodeURIComponent(item.id)}/obsidian" target="_blank" rel="noreferrer">导出 Obsidian Markdown</a>
      </div>
    </div>
    <div class="detail-content-grid">
      ${renderList("关键观点", item.key_points)}
      ${renderList("适用场景", item.use_cases)}
    </div>
    ${renderList("关键片段", excerpts)}
    ${item.personal_note ? `<div class="detail-section"><h4>我的备注</h4><p>${escapeHtml(item.personal_note)}</p></div>` : ""}
  `;
}

async function retrieveForCodex() {
  const query = elements.retrieveQueryInput.value.trim();
  if (!query) {
    elements.retrieveOutput.textContent = "请输入任务描述。";
    return;
  }
  elements.retrieveOutput.textContent = "检索中...";
  try {
    const result = await api("/api/retrieve", {
      method: "POST",
      body: JSON.stringify({ query, limit: 5 })
    });
    elements.retrieveOutput.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    elements.retrieveOutput.textContent = error.message;
  }
}

function bindEvents() {
  elements.passwordInput.value = state.password;
  elements.tokenInput.value = state.token;
  elements.settingsButton.addEventListener("click", () => {
    elements.settingsPanel.classList.toggle("hidden");
  });
  elements.saveSettingsButton.addEventListener("click", () => {
    state.password = elements.passwordInput.value;
    state.token = elements.tokenInput.value;
    localStorage.setItem("kb_password", state.password);
    localStorage.setItem("kb_api_token", state.token);
    elements.settingsPanel.classList.add("hidden");
  });
  elements.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  elements.previewButton.addEventListener("click", previewCapture);
  elements.clearCaptureButton.addEventListener("click", () => {
    elements.captureInput.value = "";
    elements.itemForm.reset();
    setStatus("");
  });
  elements.itemForm.addEventListener("submit", saveItem);
  elements.searchInput.addEventListener("input", loadItems);
  elements.filterTypeInput.addEventListener("change", loadItems);
  elements.retrieveButton.addEventListener("click", retrieveForCodex);
}

bindEvents();
loadItems();
