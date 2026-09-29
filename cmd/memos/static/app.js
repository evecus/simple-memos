(() => {
  const app = document.getElementById("app");

  const state = {
    status: null,
    user: null,
    memos: [],
    filter: { archived: false, tag: "", q: "" },
    pendingFiles: [],
    editingId: null,
    sidebarOpen: false,
    error: "",
  };

  const icons = {
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l1 7a4 4 0 0 1-4 4 4 4 0 0 1-4-4l1-7z"/><path d="M8 10h8"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
    paperclip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.5 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...opts,
      headers: {
        ...(opts.body && !(opts.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...opts.headers,
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function relativeTime(ts) {
    const d = new Date(ts * 1000);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function initial(name) {
    const s = (name || "?").trim();
    return (s[0] || "?").toUpperCase();
  }

  /** Lightweight markdown → HTML (tags become clickable chips). */
  function renderMarkdown(src) {
    let s = escapeHtml(src);
    // fenced code
    s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
    // inline code
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // bold / italic
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
    // links
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    s = s.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
    // hashtags
    s = s.replace(
      /(^|[\s([{])#([\w\u4e00-\u9fff\/.-]+)/g,
      (_, pre, tag) =>
        `${pre}<span class="md-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`
    );
    // simple lists
    s = s.replace(/(?:^|\n)((?:[-*] .+\n?)+)/g, (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((l) => l.replace(/^[-*]\s+/, ""))
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `\n<ul>${items}</ul>`;
    });
    // paragraphs
    s = s
      .split(/\n{2,}/)
      .map((p) => {
        p = p.replace(/\n/g, "<br/>");
        if (p.startsWith("<ul") || p.startsWith("<pre")) return p;
        return `<p>${p}</p>`;
      })
      .join("");
    return s;
  }

  function collectTags() {
    const map = new Map();
    for (const m of state.memos) {
      for (const t of m.tags || []) {
        map.set(t, (map.get(t) || 0) + 1);
      }
    }
    // also scan content for tags not in m.tags
    for (const m of state.memos) {
      const re = /(?:^|[\s([{])#([\w\u4e00-\u9fff\/.-]+)/g;
      let match;
      while ((match = re.exec(m.content || ""))) {
        const t = match[1];
        if (!map.has(t)) map.set(t, 0);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function filteredMemos() {
    let list = state.memos;
    if (state.filter.q) {
      const q = state.filter.q.toLowerCase();
      list = list.filter(
        (m) =>
          (m.content || "").toLowerCase().includes(q) ||
          (m.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }

  function render() {
    if (!state.status) {
      app.innerHTML = `<div class="empty">加载中…</div>`;
      return;
    }
    if (state.status.needs_setup) {
      renderSetup();
      return;
    }
    if (!state.user) {
      renderLogin();
      return;
    }
    renderHome();
  }

  function renderSetup() {
    app.innerHTML = `
      <div class="auth-page">
        <div class="auth-card">
          <div class="brand"><div class="logo">M</div><div>
            <h2 style="margin:0;font-size:1.15rem">初始化 Memos</h2>
          </div></div>
          <p class="hint">首次使用，创建唯一管理员账号。</p>
          <form id="setup-form">
            <label>用户名</label>
            <input name="username" required autocomplete="username" />
            <label>显示名称（可选）</label>
            <input name="display_name" autocomplete="nickname" />
            <label>密码（至少 4 位）</label>
            <input name="password" type="password" required minlength="4" autocomplete="new-password" />
            <div class="btn-row"><button class="btn" type="submit">完成设置并进入</button></div>
            <div class="error" id="err"></div>
          </form>
        </div>
      </div>`;
    document.getElementById("setup-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById("err");
      errEl.textContent = "";
      try {
        const data = await api("/api/setup", {
          method: "POST",
          body: JSON.stringify({
            username: fd.get("username"),
            password: fd.get("password"),
            display_name: fd.get("display_name"),
          }),
        });
        state.user = data.user;
        state.status.needs_setup = false;
        await loadMemos();
        render();
      } catch (err) {
        errEl.textContent = err.message;
      }
    };
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="auth-page">
        <div class="auth-card">
          <div class="brand"><div class="logo">M</div><div>
            <h2 style="margin:0;font-size:1.15rem">登录</h2>
          </div></div>
          <p class="hint">单用户本地日记 · Simple Memos</p>
          <form id="login-form">
            <label>用户名</label>
            <input name="username" required autocomplete="username" />
            <label>密码</label>
            <input name="password" type="password" required autocomplete="current-password" />
            <div class="btn-row"><button class="btn" type="submit">登录</button></div>
            <div class="error" id="err"></div>
          </form>
        </div>
      </div>`;
    document.getElementById("login-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById("err");
      errEl.textContent = "";
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: fd.get("username"),
            password: fd.get("password"),
          }),
        });
        state.user = data.user;
        await loadMemos();
        render();
      } catch (err) {
        errEl.textContent = err.message;
      }
    };
  }

  function renderHome() {
    const displayName = state.user.display_name || state.user.username;
    const tags = collectTags();
    const list = filteredMemos();

    app.innerHTML = `
      <div class="sidebar-backdrop ${state.sidebarOpen ? "open" : ""}" id="backdrop"></div>
      <div class="app-shell">
        <aside class="sidebar ${state.sidebarOpen ? "open" : ""}" id="sidebar">
          <div class="sidebar-inner">
            <div class="sidebar-brand">
              <div class="logo">M</div>
              <div class="name">Memos</div>
            </div>
            <nav class="sidebar-nav">
              <button class="nav-item ${!state.filter.archived ? "active" : ""}" data-view="active">
                ${icons.home}<span>Timeline</span>
              </button>
              <button class="nav-item ${state.filter.archived ? "active" : ""}" data-view="archived">
                ${icons.archive}<span>Archived</span>
              </button>
            </nav>
            <div class="sidebar-section">
              <div class="sidebar-section-label">Tags</div>
              ${
                tags.length
                  ? tags
                      .map(
                        ([t, c]) => `
                <button class="tag-row ${state.filter.tag === t ? "active" : ""}" data-tag="${escapeHtml(t)}">
                  <span class="tag-name">#${escapeHtml(t)}</span>
                  <span class="tag-count">${c || ""}</span>
                </button>`
                      )
                      .join("")
                  : `<div style="padding:8px 10px;color:var(--muted);font-size:13px">暂无标签</div>`
              }
            </div>
            <div class="sidebar-footer">
              <div class="user-chip">
                <div class="avatar">${escapeHtml(initial(displayName))}</div>
                <div class="meta"><div class="uname">${escapeHtml(displayName)}</div></div>
                <button class="logout" id="logout" title="退出">退出</button>
              </div>
            </div>
          </div>
        </aside>

        <div class="main">
          <div class="mobile-bar">
            <button class="menu-btn" id="menu-btn" aria-label="菜单">${icons.menu}</button>
            <div class="title">${state.filter.archived ? "Archived" : "Timeline"}</div>
          </div>
          <div class="main-inner">
            ${
              !state.filter.archived
                ? `
            <div class="composer">
              <textarea id="content" placeholder="写点什么… 支持 Markdown 与 #标签" rows="3"></textarea>
              <div class="pending" id="pending"></div>
              <div class="composer-toolbar">
                <input type="file" id="file" multiple hidden />
                <button type="button" class="btn icon" id="pick-file" title="添加附件">${icons.paperclip}</button>
                <span class="spacer"></span>
                <span class="error" id="c-err" style="margin:0;font-size:12.5px"></span>
                <button type="button" class="btn" id="submit">发布</button>
              </div>
            </div>`
                : ""
            }

            <div class="filter-bar">
              <div class="search-box">
                ${icons.search}
                <input id="search" type="search" placeholder="搜索…" value="${escapeHtml(state.filter.q)}" />
              </div>
              ${
                state.filter.tag
                  ? `<span class="filter-chip">#${escapeHtml(state.filter.tag)} <button type="button" data-clear-tag>×</button></span>`
                  : ""
              }
            </div>

            <div id="list"></div>
          </div>
        </div>
      </div>
    `;

    // sidebar / mobile
    const closeSidebar = () => {
      state.sidebarOpen = false;
      document.getElementById("sidebar")?.classList.remove("open");
      document.getElementById("backdrop")?.classList.remove("open");
    };
    document.getElementById("menu-btn")?.addEventListener("click", () => {
      state.sidebarOpen = true;
      document.getElementById("sidebar")?.classList.add("open");
      document.getElementById("backdrop")?.classList.add("open");
    });
    document.getElementById("backdrop")?.addEventListener("click", closeSidebar);

    document.getElementById("logout").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      state.memos = [];
      render();
    };

    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.onclick = async () => {
        state.filter.archived = btn.dataset.view === "archived";
        state.filter.tag = "";
        state.filter.q = "";
        closeSidebar();
        await loadMemos();
        render();
      };
    });

    document.querySelectorAll("[data-tag]").forEach((el) => {
      el.onclick = async () => {
        const t = el.dataset.tag;
        state.filter.tag = state.filter.tag === t ? "" : t;
        state.filter.archived = false;
        closeSidebar();
        await loadMemos();
        render();
      };
    });

    document.querySelector("[data-clear-tag]")?.addEventListener("click", async () => {
      state.filter.tag = "";
      await loadMemos();
      render();
    });

    const searchInput = document.getElementById("search");
    if (searchInput) {
      let timer;
      searchInput.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.filter.q = searchInput.value.trim();
          renderList();
        }, 150);
      };
    }

    if (!state.filter.archived) {
      const fileInput = document.getElementById("file");
      document.getElementById("pick-file").onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const errEl = document.getElementById("c-err");
        errEl.textContent = "";
        for (const f of fileInput.files) {
          try {
            const fd = new FormData();
            fd.append("file", f);
            const a = await api("/api/attachments", { method: "POST", body: fd });
            state.pendingFiles.push(a);
            renderPending();
          } catch (err) {
            errEl.textContent = err.message;
          }
        }
        fileInput.value = "";
      };

      const ta = document.getElementById("content");
      ta.addEventListener("input", () => {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 320) + "px";
      });

      document.getElementById("submit").onclick = async () => {
        const content = ta.value;
        const errEl = document.getElementById("c-err");
        errEl.textContent = "";
        try {
          await api("/api/memos", {
            method: "POST",
            body: JSON.stringify({
              content,
              attachment_ids: state.pendingFiles.map((x) => x.id),
            }),
          });
          state.pendingFiles = [];
          ta.value = "";
          ta.style.height = "";
          renderPending();
          await loadMemos();
          renderList();
        } catch (err) {
          errEl.textContent = err.message;
        }
      };

      renderPending();
    }

    renderList();
  }

  function renderPending() {
    const el = document.getElementById("pending");
    if (!el) return;
    el.innerHTML = state.pendingFiles
      .map(
        (f, i) =>
          `<span class="pending-item">${escapeHtml(f.filename)} <button type="button" data-rm="${i}">×</button></span>`
      )
      .join("");
    el.querySelectorAll("[data-rm]").forEach((btn) => {
      btn.onclick = () => {
        state.pendingFiles.splice(Number(btn.dataset.rm), 1);
        renderPending();
      };
    });
  }

  function renderList() {
    const list = document.getElementById("list");
    if (!list) return;
    const memos = filteredMemos();
    if (!memos.length) {
      list.innerHTML = `<div class="empty">还没有内容</div>`;
      return;
    }
    const displayName = state.user.display_name || state.user.username;

    list.innerHTML = memos
      .map((m) => {
        if (state.editingId === m.id) {
          return `
          <article class="memo ${m.pinned ? "pinned" : ""}" data-id="${m.id}">
            <div class="memo-header">
              <div class="avatar">${escapeHtml(initial(displayName))}</div>
              <div class="who">
                <span class="name">${escapeHtml(displayName)}</span>
                <span class="time">编辑中</span>
              </div>
            </div>
            <div class="memo-edit-area">
              <textarea id="edit-${m.id}">${escapeHtml(m.content)}</textarea>
              <div class="memo-edit-actions">
                <button class="btn secondary sm" data-act="cancel-edit">取消</button>
                <button class="btn sm" data-act="save-edit">保存</button>
              </div>
            </div>
          </article>`;
        }

        const tags = (m.tags || [])
          .map(
            (t) =>
              `<button class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
          )
          .join("");
        const atts = (m.attachments || [])
          .map((a) => {
            const isImg = (a.mime || "").startsWith("image/");
            if (isImg) {
              return `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${escapeHtml(a.filename)}" loading="lazy" /></a>`;
            }
            return `<a class="file" href="${a.url}" target="_blank" rel="noopener">📎 ${escapeHtml(a.filename)}</a>`;
          })
          .join("");

        return `
        <article class="memo ${m.pinned ? "pinned" : ""}" data-id="${m.id}">
          <div class="memo-header">
            <div class="avatar">${escapeHtml(initial(displayName))}</div>
            <div class="who">
              <span class="name">${escapeHtml(displayName)}</span>
              <span class="time">· ${relativeTime(m.created_at)}</span>
              ${m.pinned ? '<span class="pin-badge">置顶</span>' : ""}
            </div>
            <div class="memo-actions">
              <button title="${m.pinned ? "取消置顶" : "置顶"}" data-act="pin">${icons.pin}</button>
              <button title="${m.archived ? "取消归档" : "归档"}" data-act="archive">${icons.archive}</button>
              <button title="编辑" data-act="edit">${icons.edit}</button>
              <button class="danger" title="删除" data-act="del">${icons.trash}</button>
            </div>
          </div>
          <div class="memo-content">${renderMarkdown(m.content || "")}</div>
          ${tags ? `<div class="memo-tags">${tags}</div>` : ""}
          ${atts ? `<div class="memo-attachments">${atts}</div>` : ""}
        </article>`;
      })
      .join("");

    // tag clicks inside content / chips
    list.querySelectorAll("[data-tag]").forEach((el) => {
      el.onclick = async (e) => {
        e.preventDefault();
        state.filter.tag = el.dataset.tag;
        state.filter.archived = false;
        await loadMemos();
        render();
      };
    });

    list.querySelectorAll("article.memo").forEach((art) => {
      const id = art.dataset.id;
      art.querySelectorAll("[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          try {
            if (act === "del") {
              if (!confirm("删除这条日记？")) return;
              await api(`/api/memos/${id}`, { method: "DELETE" });
              state.editingId = null;
            } else if (act === "pin") {
              const m = state.memos.find((x) => x.id === id);
              await api(`/api/memos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ pinned: !m.pinned }),
              });
            } else if (act === "archive") {
              const m = state.memos.find((x) => x.id === id);
              await api(`/api/memos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ archived: !m.archived }),
              });
            } else if (act === "edit") {
              state.editingId = id;
              renderList();
              return;
            } else if (act === "cancel-edit") {
              state.editingId = null;
              renderList();
              return;
            } else if (act === "save-edit") {
              const ta = document.getElementById(`edit-${id}`);
              await api(`/api/memos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ content: ta.value }),
              });
              state.editingId = null;
            }
            await loadMemos();
            render();
          } catch (err) {
            alert(err.message);
          }
        };
      });
    });
  }

  async function loadMemos() {
    const q = new URLSearchParams();
    if (state.filter.archived) q.set("archived", "1");
    if (state.filter.tag) q.set("tag", state.filter.tag);
    q.set("limit", "200");
    const data = await api("/api/memos?" + q.toString());
    state.memos = data.memos || [];
  }

  async function boot() {
    try {
      state.status = await api("/api/status");
      if (!state.status.needs_setup && state.status.logged_in) {
        state.user = await api("/api/auth/me");
        await loadMemos();
      }
    } catch (err) {
      app.innerHTML = `<div class="empty error">${escapeHtml(err.message)}</div>`;
      return;
    }
    render();
  }

  boot();
})();
