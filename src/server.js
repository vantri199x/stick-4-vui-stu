import "dotenv/config"; // đọc file .env vào process.env
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askStick } from "./ai.js";

// Với "type": "module" không có sẵn __dirname, nên ta tự tạo
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // Chuyển lịch sử sang định dạng của Gemini (vai "bot" -> "model"), chỉ giữ 12 tin gần nhất
  const turns = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-12)) {
      const text = typeof h?.text === "string" ? h.text.trim() : "";
      if (!text || (h.role !== "user" && h.role !== "bot")) continue;
      turns.push({
        role: h.role === "bot" ? "model" : "user",
        parts: [{ text: text.slice(0, 4000) }],
      });
    }
  }
  while (turns.length && turns[0].role === "model") turns.shift(); // lịch sử phải mở đầu bằng người dùng
  turns.push({ role: "user", parts: [{ text: message.trim() }] });

  try {
    const reply = await askStick(turns);
    res.json({ reply, sources: [] });
  } catch (err) {
    console.error("Lỗi gọi Gemini:", err?.status, err?.message);
    if (err?.status === 429) {
      return res
        .status(429)
        .json({
          error:
            "Stick đang quá tải hoặc hết hạn mức, thử lại sau ít phút nhé.",
        });
    }
    res
      .status(500)
      .json({ error: "Stick đang gặp sự cố, bạn thử lại sau nhé." });
  }
});

app.listen(PORT, () => {
  console.log(`Stick đang chạy tại http://localhost:${PORT}`);
});
