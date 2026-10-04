import "dotenv/config"; // đọc file .env vào process.env
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Với "type": "module" không có sẵn __dirname, nên ta tự tạo
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Cho phép server đọc dữ liệu JSON gửi lên, giới hạn 10kb để tránh bị gửi dữ liệu quá lớn
app.use(express.json({ limit: "10kb" }));

// Phục vụ giao diện: mọi file trong thư mục public/ truy cập được từ trình duyệt
app.use(express.static(path.join(__dirname, "..", "public")));

// Endpoint kiểm tra server còn sống không
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Endpoint chat (bản giả lập, chưa gọi AI)
app.post("/api/chat", (req, res) => {
  const message = req.body?.message;

  // Luôn kiểm tra dữ liệu đầu vào, không tin bất cứ thứ gì từ phía người dùng
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Vui lòng nhập câu hỏi." });
  }
  if (message.length > 1000) {
    return res
      .status(400)
      .json({ error: "Câu hỏi quá dài (tối đa 1000 ký tự)." });
  }

  res.json({
    reply: `Stick (bản giả lập) đã nhận: "${message.trim()}"`,
    sources: [],
  });
});

app.listen(PORT, () => {
  console.log(`Stick đang chạy tại http://localhost:${PORT}`);
});
