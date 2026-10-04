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

let chats = loadChats(); // [{ id, title, updated, messages: [{ role: "user" | "bot", text }] }]
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

/* ---------- Hiển thị văn bản (luôn dùng textContent, không dùng innerHTML) ---------- */
function appendInline(parent, text) {
  // Tách **đậm** và `code`, giữ nguyên phần còn lại
  text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).forEach((part) => {
    if (!part) return;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      const b = document.createElement("strong");
      b.textContent = part.slice(2, -2);
      parent.appendChild(b);
    } else if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      const c = document.createElement("code");
      c.textContent = part.slice(1, -1);
      parent.appendChild(c);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function renderText(container, text) {
  let list = null,
    listType = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);

    if (ul || ol) {
      const type = ul ? "UL" : "OL";
      if (!list || listType !== type) {
        list = document.createElement(type);
        listType = type;
        container.appendChild(list);
      }
      const li = document.createElement("li");
      appendInline(li, (ul || ol)[1]);
      list.appendChild(li);
      continue;
    }

    list = null;
    listType = null;
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,6}\s+(.*)/);
    const node = document.createElement(heading ? "h4" : "p");
    appendInline(node, heading ? heading[1] : line.trim());
    container.appendChild(node);
  }
}

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

function renderMarkdown(container, text) {
  text.split("```").forEach((part, i) => {
    if (i % 2 === 1) renderCode(container, part);
    else renderText(container, part);
  });
}

/* ---------- Thêm tin nhắn vào khung ---------- */
function scrollDown() {
  el.scroll.scrollTop = el.scroll.scrollHeight;
}

function appendMessage(role, text, kind) {
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
  row.appendChild(body);
  el.thread.appendChild(row);
  scrollDown();
  return row;
}

function appendTyping() {
  const row = document.createElement("div");
  row.className = "row row--bot";
  row.innerHTML =
    '<div class="avatar">S</div><div class="bubble"><div class="typing"><i></i><i></i><i></i></div></div>'; // nội dung cố định do ta viết, không có dữ liệu người dùng
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
  if (!empty) chat.messages.forEach((m) => appendMessage(m.role, m.text));
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

  const history = chat.messages.slice(-12); // chỉ gửi các lượt đã trả lời thành công
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
        { role: "bot", text: data.reply },
      );
      chat.updated = Date.now();
      if (isNew) {
        chats.push(chat);
        currentId = chat.id;
      }
      saveChats();
      appendMessage("bot", data.reply);
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
