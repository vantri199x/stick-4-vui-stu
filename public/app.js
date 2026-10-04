// 1. Lấy các phần tử cần dùng
const fab = document.getElementById("chat-fab");
const chat = document.getElementById("chat");
const closeBtn = document.getElementById("chat-close");
const messages = document.getElementById("chat-messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send");

// 2. Mở / đóng khung chat
function openChat() {
  chat.hidden = false;
  fab.hidden = true;
  if (messages.children.length === 0) {
    addMessage("bot", "Chào bạn! Mình là Stick, trợ lý môn C và DSA. Bạn đang thắc mắc điều gì?");
  }
  input.focus();
}
function closeChat() {
  chat.hidden = true;
  fab.hidden = false;
}
fab.addEventListener("click", openChat);
closeBtn.addEventListener("click", closeChat);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chat.hidden) closeChat(); });

// 3. Hiển thị tin nhắn
// Tách văn bản theo cặp ``` để vẽ khối code; luôn dùng textContent (không dùng innerHTML)
function renderRich(el, text) {
  text.split("```").forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = part.replace(/^[a-zA-Z+#]*\n/, "").trim();   // bỏ tên ngôn ngữ như "c"
      pre.appendChild(code);
      el.appendChild(pre);
    } else if (part.trim()) {
      el.appendChild(document.createTextNode(part.trim()));
    }
  });
}

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + (role === "user" ? "msg--user" : "msg--bot") + (role === "error" ? " msg--error" : "");
  if (role === "bot") renderRich(el, text);
  else el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;     // tự cuộn xuống tin mới nhất
  return el;
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  input.disabled = busy;
}

// 4. Gửi câu hỏi tới backend
form.addEventListener("submit", async (e) => {
  e.preventDefault();                              // chặn trình duyệt tải lại trang
  const text = input.value.trim();
  if (!text) return;

  addMessage("user", text);
  input.value = "";
  setBusy(true);
  const typing = addMessage("bot", "Stick đang suy nghĩ...");
  typing.classList.add("msg--typing");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) addMessage("error", data.error || "Có lỗi xảy ra, thử lại nhé.");
    else addMessage("bot", data.reply);
  } catch (err) {
    typing.remove();
    addMessage("error", "Không kết nối được tới Stick. Kiểm tra server đang chạy chưa nhé.");
  } finally {
    setBusy(false);
    input.focus();
  }
});