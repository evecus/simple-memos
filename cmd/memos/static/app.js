(() => {
  const app = document.getElementById("app");

  const state = {
    status: null,
    user: null,
    memos: [],
    filter: { archived: false, tag: "" },
    pendingFiles: [],
    editingId: null,
    error: "",
    loading: false,
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

  function fmtTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;");
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
      <div class="card auth-card">
        <h2>初始化 Simple Memos</h2>
        <p class="hint">首次使用，创建唯一管理员账号。</p>
        <form id="setup-form">
          <label>用户名</label>
          <input name="username" required autocomplete="username" />
          <label>显示名称（可选）</label>
          <input name="display_name" autocomplete="nickname" />
          <label>密码（至少 4 位）</label>
          <input name="password" type="password" required minlength="4" autocomplete="new-password" />
          <div class="btn-row">
            <button type="submit">完成设置并进入</button>
          </div>
          <div class="error" id="err"></div>
        </form>
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
      <div class="card auth-card">
        <h2>登录</h2>
        <p class="hint">单用户本地日记</p>
        <form id="login-form">
          <label>用户名</label>
          <input name="username" required autocomplete="username" />
          <label>密码</label>
          <input name="password" type="password" required autocomplete="current-password" />
          <div class="btn-row">
            <button type="submit">登录</button>
          </div>
          <div class="error" id="err"></div>
        </form>
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
    const tagFilter = state.filter.tag
      ? `<span class="tag" data-clear-tag>#${escapeHtml(state.filter.tag)} ×</span>`
      : "";
    app.innerHTML = `
      <header class="app-header">
        <h1>Simple Memos</h1>
        <div class="user">
          <span>${escapeHtml(state.user.display_name || state.user.username)}</span>
          <button class="ghost" id="logout">退出</button>
        </div>
      </header>

      <div class="card composer">
        <textarea id="content" placeholder="写点什么… 支持 #标签"></textarea>
        <div class="pending" id="pending"></div>
        <div class="tools">
          <input type="file" id="file" multiple hidden />
          <button type="button" class="secondary" id="pick-file">添加文件</button>
          <button type="button" id="submit">发布</button>
          <span class="error" id="c-err"></span>
        </div>
      </div>

      <div class="toolbar">
        <button class="secondary ${!state.filter.archived ? "active" : ""}" data-view="active">日记</button>
        <button class="secondary ${state.filter.archived ? "active" : ""}" data-view="archived">归档</button>
        ${tagFilter}
      </div>

      <div id="list"></div>
    `;

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
        await loadMemos();
        render();
      };
    });
    const clearTag = document.querySelector("[data-clear-tag]");
    if (clearTag) {
      clearTag.onclick = async () => {
        state.filter.tag = "";
        await loadMemos();
        render();
      };
    }

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

    document.getElementById("submit").onclick = async () => {
      const content = document.getElementById("content").value;
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
        document.getElementById("content").value = "";
        renderPending();
        await loadMemos();
        renderList();
      } catch (err) {
        errEl.textContent = err.message;
      }
    };

    renderPending();
    renderList();
  }

  function renderPending() {
    const el = document.getElementById("pending");
    if (!el) return;
    el.innerHTML = state.pendingFiles
      .map(
        (f, i) =>
          `<span class="pending-item">${escapeHtml(f.filename)} <button type="button" class="ghost" data-rm="${i}">×</button></span>`
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
    if (!state.memos.length) {
      list.innerHTML = `<div class="empty">还没有内容</div>`;
      return;
    }
    list.innerHTML = state.memos
      .map((m) => {
        const tags = (m.tags || [])
          .map((t) => `<span class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`)
          .join("");
        const atts = (m.attachments || [])
          .map((a) => {
            const isImg = (a.mime || "").startsWith("image/");
            if (isImg) {
              return `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${escapeHtml(a.filename)}" /></a>`;
            }
            return `<a class="file" href="${a.url}" target="_blank" rel="noopener">${escapeHtml(a.filename)}</a>`;
          })
          .join("");
        return `
        <article class="card memo ${m.pinned ? "pinned" : ""}" data-id="${m.id}">
          <div class="meta">
            <span>${fmtTime(m.created_at)}${m.pinned ? '<span class="pin-badge">置顶</span>' : ""}</span>
            <div class="actions">
              <button class="ghost" data-act="pin">${m.pinned ? "取消置顶" : "置顶"}</button>
              <button class="ghost" data-act="archive">${m.archived ? "取消归档" : "归档"}</button>
              <button class="ghost" data-act="edit">编辑</button>
              <button class="ghost" data-act="del">删除</button>
            </div>
          </div>
          <div class="content">${escapeHtml(m.content)}</div>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
          ${atts ? `<div class="attachments">${atts}</div>` : ""}
        </article>`;
      })
      .join("");

    list.querySelectorAll("[data-tag]").forEach((el) => {
      el.onclick = async () => {
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
              const m = state.memos.find((x) => x.id === id);
              const next = prompt("编辑内容", m.content);
              if (next === null) return;
              await api(`/api/memos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ content: next }),
              });
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
    q.set("limit", "100");
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
