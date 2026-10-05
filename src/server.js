import "dotenv/config"; // đọc file .env vào process.env
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askStick } from "./ai.js";
import { loadDocs, search } from "./rag.js";

// Với "type": "module" không có sẵn __dirname, nên ta tự tạo
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loaded = loadDocs(path.join(__dirname, "..", "docs"));
console.log(`Đã nạp ${loaded.chunks} đoạn tài liệu từ ${loaded.files} file.`);
if (loaded.chunks === 0)
  console.warn("Chưa có tài liệu nào trong thư mục docs/.");

const app = express();
const PORT = process.env.PORT || 3000;

// Cho phép server đọc dữ liệu JSON gửi lên, giới hạn 10kb để tránh bị gửi dữ liệu quá lớn
app.use(express.json({ limit: "100kb" }));

// Phục vụ giao diện: mọi file trong thư mục public/ truy cập được từ trình duyệt
app.use(express.static(path.join(__dirname, "..", "public")));

// Endpoint kiểm tra server còn sống không
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Endpoint chat (bản giả lập, chưa gọi AI)
app.post("/api/chat", async (req, res) => {
  const { message, history } = req.body ?? {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Vui lòng nhập câu hỏi." });
  }
  if (message.length > 1000) {
    return res
      .status(400)
      .json({ error: "Câu hỏi quá dài (tối đa 1000 ký tự)." });
  }

  const turns = [];
  let prevUser = "";
  if (Array.isArray(history)) {
    for (const h of history.slice(-12)) {
      const text = typeof h?.text === "string" ? h.text.trim() : "";
      if (!text || (h.role !== "user" && h.role !== "bot")) continue;
      if (h.role === "user") prevUser = text;
      turns.push({
        role: h.role === "bot" ? "model" : "user",
        parts: [{ text: text.slice(0, 4000) }],
      });
    }
  }
  while (turns.length && turns[0].role === "model") turns.shift();
  turns.push({ role: "user", parts: [{ text: message.trim() }] });

  // Tìm tài liệu. Ghép cả câu hỏi trước để câu nối tiếp ("cho ví dụ đi") vẫn tìm đúng chủ đề
  const hits = search(prevUser + " " + message);

  try {
    const reply = await askStick(turns, hits);   // luôn gọi AI, kể cả khi hits rỗng
    res.json({ reply, sources: hits.map((h) => ({ file: h.file, heading: h.heading })) });
  } catch (err) {
    console.error("Lỗi gọi Gemini:", err?.status, err?.message);
    if (err?.status === 429) {
      return res.status(429).json({ error: "Stick đang quá tải hoặc hết hạn mức, thử lại sau ít phút nhé." });
    }
    res.status(500).json({ error: "Stick đang gặp sự cố, bạn thử lại sau nhé." });
  }
});

app.listen(PORT, () => {
  console.log(`Stick đang chạy tại http://localhost:${PORT}`);
});
