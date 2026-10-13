const STORE_KEY = "stick.chats.v1";
const $ = (id) => document.getElementById(id);
const el = {
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  menuBtn: $("menu-btn"),
  newChat: $("new-chat"),
  clearAll: $("clear-all"),
  history: $("history"),
  scroll: $("scroll"),
  thread: $("thread"),
  welcome: $("welcome"),
  form: $("composer"),
  input: $("input"),
  send: $("send"),
};

// Tên hiển thị thân thiện cho file nguồn (sửa cho khớp tài liệu của bạn)
const FILE_LABELS = {
  "c/giao-trinh-c.txt": "Giáo trình C",
  "dsa/giao-trinh-dsa.txt": "Giáo trình DSA",
};
const fileLabel = (f) => FILE_LABELS[f] || f;

let chats = loadChats(); // [{ id, title, updated, messages: [{ role: "user" | "bot", text, sources? }] }]
let currentId = null; // null = cuộc trò chuyện mới (chưa lưu)
let busy = false;

/* ---------- Lưu trữ trong trình duyệt ---------- */
function loadChats() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function saveChats() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(chats.slice(0, 30)));
  } catch {
    /* bỏ qua */
  }
}
const currentChat = () => chats.find((c) => c.id === currentId);

/* ---------- Hiển thị Markdown (luôn dùng textContent, không dùng innerHTML) ---------- */

// Chữ trong dòng: **đậm**, `code`, và trích dẫn [1] (vẽ thành số nhỏ)
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<![\w\]])\[\d{1,2}\](?!\())/g;

function appendInline(parent, text) {
  text.split(INLINE_RE).forEach((part) => {
    if (!part) return;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      const b = document.createElement("strong");
      appendInline(b, part.slice(2, -2));
      parent.appendChild(b);
    } else if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      const c = document.createElement("code");
      c.textContent = part.slice(1, -1);
      parent.appendChild(c);
    } else if (/^\[\d{1,2}\]$/.test(part)) {
      const s = document.createElement("sup");
      s.className = "cite";
      s.textContent = part.slice(1, -1);
      parent.appendChild(s);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

// Bảng: | a | b |  rồi dòng | --- | --- |
const isRow = (t) => t.length > 2 && t.startsWith("|") && t.endsWith("|");
const isSep = (t) => isRow(t) && /^[\s|:-]+$/.test(t) && t.includes("-");
const cellsOf = (t) =>
  t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());

function renderTable(container, rows) {
  const wrap = document.createElement("div");
  wrap.className = "tbl";
  const table = document.createElement("table");

  const headRow = table.createTHead().insertRow();
  cellsOf(rows[0]).forEach((h) => {
    const th = document.createElement("th");
    appendInline(th, h);
    headRow.appendChild(th);
  });

  const body = table.createTBody();
  rows.slice(1).forEach((r) => {
    const tr = body.insertRow();
    cellsOf(r).forEach((c) => appendInline(tr.insertCell(), c));
  });

  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderText(container, text) {
  const lines = text.split("\n");
  let list = null,
    listType = null,
    quote = null;
  const reset = () => {
    list = null;
    listType = null;
    quote = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      reset();
      continue;
    }

    // Bảng
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1].trim())) {
      reset();
      const rows = [line];
      let j = i + 2;
      while (j < lines.length && isRow(lines[j].trim())) {
        rows.push(lines[j].trim());
        j++;
      }
      renderTable(container, rows);
      i = j - 1;
      continue;
    }

    // Tiêu đề (#, ##, ###...)
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      reset();
      const node = document.createElement(h[1].length <= 2 ? "h3" : "h4");
      appendInline(node, h[2]);
      container.appendChild(node);
      continue;
    }

    // Đường kẻ ngang
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      reset();
      container.appendChild(document.createElement("hr"));
      continue;
    }

    // Trích dẫn / lưu ý (dòng bắt đầu bằng >)
    const q = line.match(/^>\s?(.*)/);
    if (q) {
      list = null;
      listType = null;
      if (!quote) {
        quote = document.createElement("blockquote");
        container.appendChild(quote);
      }
      const p = document.createElement("p");
      appendInline(p, q[1]);
      quote.appendChild(p);
      continue;
    }
    quote = null;

    // Danh sách
    const ul = line.match(/^[-*•]\s+(.*)/);
    const ol = line.match(/^(\d+)[.)]\s+(.*)/);
    if (ul || ol) {
      const type = ul ? "UL" : "OL";
      if (!list || listType !== type) {
        list = document.createElement(type);
        listType = type;
        if (ol && Number(ol[1]) > 1) list.start = Number(ol[1]);
        container.appendChild(list);
      }
      const li = document.createElement("li");
      appendInline(li, ul ? ul[1] : ol[2]);
      list.appendChild(li);
      continue;
    }

    // Đoạn văn
    list = null;
    listType = null;
    const p = document.createElement("p");
    appendInline(p, line);
    container.appendChild(p);
  }
}

// Khối code có nút "Chép"
function renderCode(container, block) {
  const nl = block.indexOf("\n");
  const lang = nl === -1 ? "" : block.slice(0, nl).trim();
  const code = (nl === -1 ? block : block.slice(nl + 1)).replace(/\n$/, "");

  const wrap = document.createElement("div");
  wrap.className = "code";

  const bar = document.createElement("div");
  bar.className = "code__bar";
  const label = document.createElement("span");
  label.textContent = lang || "code";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "code__copy";
  copy.textContent = "Chép";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "Đã chép";
    } catch {
      copy.textContent = "Lỗi";
    }
    setTimeout(() => (copy.textContent = "Chép"), 1500);
  });
  bar.append(label, copy);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.appendChild(codeEl);

  wrap.append(bar, pre);
  container.appendChild(wrap);
}

// Câu trắc nghiệm bấm được. Trả về false nếu JSON hỏng (khi đó hiện như khối code)
function renderQuiz(container, raw) {
  let q;
  try {
    q = JSON.parse(raw.trim());
  } catch {
    return false;
  }
  const valid =
    q &&
    typeof q.question === "string" &&
    Array.isArray(q.options) &&
    q.options.length >= 2 &&
    q.options.length <= 5 &&
    q.options.every((o) => typeof o === "string") &&
    Number.isInteger(q.answer) &&
    q.answer >= 0 &&
    q.answer < q.options.length;
  if (!valid) return false;

  const box = document.createElement("div");
  box.className = "quiz";

  const qEl = document.createElement("p");
  qEl.className = "quiz__q";
  appendInline(qEl, q.question);
  box.appendChild(qEl);

  if (typeof q.code === "string" && q.code.trim()) {
    const pre = document.createElement("pre");
    pre.className = "quiz__code";
    pre.textContent = q.code;
    box.appendChild(pre);
  }

  const opts = document.createElement("div");
  opts.className = "quiz__opts";
  const fb = document.createElement("div");
  fb.className = "quiz__fb";
  fb.hidden = true;

  q.options.forEach((text, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quiz__opt";
    appendInline(btn, text);
    btn.addEventListener("click", () => {
      if (box.dataset.done) return;
      box.dataset.done = "1";
      const right = idx === q.answer;
      [...opts.children].forEach((b) => (b.disabled = true));
      opts.children[q.answer].classList.add("is-correct");
      if (!right) btn.classList.add("is-wrong");

      const verdict = document.createElement("strong");
      verdict.className = right ? "is-correct" : "is-wrong";
      verdict.textContent = right ? "Chính xác! " : "Chưa đúng nhé! ";
      fb.append(verdict);
      if (typeof q.explain === "string") appendInline(fb, q.explain);
      fb.hidden = false;
    });
    opts.appendChild(btn);
  });

  box.append(opts, fb);
  container.appendChild(box);
  return true;
}

function renderMarkdown(container, text) {
  text.split("```").forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const lang = (nl === -1 ? "" : part.slice(0, nl)).trim().toLowerCase();
      const body = nl === -1 ? part : part.slice(nl + 1);
      if (lang === "quiz" && renderQuiz(container, body)) return;
      renderCode(container, part);
    } else {
      renderText(container, part);
    }
  });
}

/* ---------- Thêm tin nhắn vào khung ---------- */
function scrollDown() {
  el.scroll.scrollTop = el.scroll.scrollHeight;
}

function renderSources(body, sources) {
  const box = document.createElement("div");
  box.className = "sources";

  const label = document.createElement("div");
  label.className = "sources__label";
  label.textContent = "Nguồn tham khảo";
  box.appendChild(label);

  const list = document.createElement("div");
  list.className = "sources__list";
  sources.forEach((s, i) => {
    const tag = document.createElement("span");
    tag.className = "source";
    const n = document.createElement("b");
    n.textContent = `[${s.n ?? i + 1}]`;
    tag.append(
      n,
      document.createTextNode(`${fileLabel(s.file)} · ${s.heading}`),
    );
    list.appendChild(tag);
  });
  box.appendChild(list);
  body.appendChild(box);
}

function appendMessage(role, text, kind, sources) {
  const row = document.createElement("div");
  row.className = `row row--${role}` + (kind ? ` row--${kind}` : "");
  if (role === "bot") {
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = "S";
    row.appendChild(av);
  }
  const body = document.createElement("div");
  body.className = "bubble";
  if (role === "bot" && kind !== "error") renderMarkdown(body, text);
  else body.textContent = text;

  if (sources && sources.length) renderSources(body, sources);

  row.appendChild(body);
  el.thread.appendChild(row);
  scrollDown();
  return row;
}

function appendTyping() {
  const row = document.createElement("div");
  row.className = "row row--bot";
  row.innerHTML =
    '<div class="avatar">S</div><div class="bubble"><div class="typing"><i></i><i></i><i></i></div></div>'; // chuỗi cố định do ta viết, không có dữ liệu người dùng
  el.thread.appendChild(row);
  scrollDown();
  return row;
}

/* ---------- Vẽ lại giao diện ---------- */
function renderHistory() {
  el.history.replaceChildren();
  [...chats]
    .sort((a, b) => b.updated - a.updated)
    .forEach((c) => {
      const row = document.createElement("div");
      row.className = "hist" + (c.id === currentId ? " hist--active" : "");

      const open = document.createElement("button");
      open.className = "hist__open";
      open.textContent = c.title;
      open.addEventListener("click", () => {
        currentId = c.id;
        renderAll();
        closeSidebar();
      });

      const del = document.createElement("button");
      del.className = "hist__del";
      del.textContent = "×";
      del.setAttribute("aria-label", "Xóa cuộc trò chuyện");
      del.addEventListener("click", () => {
        chats = chats.filter((x) => x.id !== c.id);
        if (currentId === c.id) currentId = null;
        saveChats();
        renderAll();
      });

      row.append(open, del);
      el.history.appendChild(row);
    });
}

function renderThread() {
  el.thread.replaceChildren();
  const chat = currentChat();
  const empty = !chat || chat.messages.length === 0;
  el.welcome.hidden = !empty;
  if (!empty)
    chat.messages.forEach((m) =>
      appendMessage(m.role, m.text, undefined, m.sources),
    );
  scrollDown();
}

function renderAll() {
  renderHistory();
  renderThread();
}

/* ---------- Gửi câu hỏi ---------- */
function autosize() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
  el.send.disabled = busy || !el.input.value.trim();
}

async function sendMessage(raw) {
  const text = raw.trim();
  if (!text || busy) return;
  busy = true;

  let chat = currentChat();
  const isNew = !chat;
  if (isNew)
    chat = {
      id: String(Date.now()),
      title: text.slice(0, 40),
      updated: Date.now(),
      messages: [],
    };

  const history = chat.messages
    .slice(-12)
    .map((m) => ({ role: m.role, text: m.text })); // chỉ gửi vai và chữ, không gửi nguồn
  el.welcome.hidden = true;
  appendMessage("user", text);
  el.input.value = "";
  autosize();
  const typing = appendTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* phản hồi không phải JSON */
    }
    typing.remove();

    if (!res.ok || !data.reply) {
      appendMessage(
        "bot",
        data.error || "Có lỗi xảy ra, thử lại nhé.",
        "error",
      );
      el.input.value = text; // trả câu hỏi về ô nhập để gửi lại
    } else {
      chat.messages.push(
        { role: "user", text },
        { role: "bot", text: data.reply, sources: data.sources },
      );
      chat.updated = Date.now();
      if (isNew) {
        chats.push(chat);
        currentId = chat.id;
      }
      saveChats();
      appendMessage("bot", data.reply, undefined, data.sources);
      renderHistory();
    }
  } catch (err) {
    console.error("Lỗi gọi /api/chat:", err);
    typing.remove();
    appendMessage(
      "bot",
      "Không kết nối được tới Stick. Kiểm tra server đang chạy chưa nhé.",
      "error",
    );
    el.input.value = text;
  } finally {
    busy = false;
    autosize();
    el.input.focus();
  }
}

/* ---------- Sự kiện ---------- */
el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(el.input.value);
});
el.input.addEventListener("input", autosize);
el.input.addEventListener("keydown", (e) => {
  // Enter = gửi, Shift+Enter = xuống dòng (bỏ qua khi đang gõ dở bằng bộ gõ)
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(el.input.value);
  }
});
document
  .querySelectorAll(".chip")
  .forEach((chip) =>
    chip.addEventListener("click", () => sendMessage(chip.textContent)),
  );

el.newChat.addEventListener("click", () => {
  currentId = null;
  renderAll();
  closeSidebar();
  el.input.focus();
});
el.clearAll.addEventListener("click", () => {
  if (
    !chats.length ||
    !confirm("Xóa toàn bộ lịch sử trò chuyện trên trình duyệt này?")
  )
    return;
  chats = [];
  currentId = null;
  saveChats();
  renderAll();
});

function openSidebar() {
  el.sidebar.classList.add("open");
  el.scrim.hidden = false;
}
function closeSidebar() {
  el.sidebar.classList.remove("open");
  el.scrim.hidden = true;
}
el.menuBtn.addEventListener("click", openSidebar);
el.scrim.addEventListener("click", closeSidebar);

/* ---------- Khởi động ---------- */
renderAll();
autosize();
el.input.focus();
