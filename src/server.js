import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askStick } from "./ai.js";
import { loadDocs, search } from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loaded = loadDocs(path.join(__dirname, "..", "docs"));
console.log(`Đã nạp ${loaded.chunks} đoạn tài liệu từ ${loaded.files} file.`);
if (loaded.chunks === 0)
  console.warn("Chưa có tài liệu nào trong thư mục docs/.");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN) || 8;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 300;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 25000;

// Khi chạy sau một máy chủ trung gian (lúc triển khai), đặt TRUST_PROXY=1 để lấy đúng IP người dùng
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);

// Tiêu đề bảo mật HTTP
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Chạy http://localhost thì tắt, để trình duyệt không ép tải file qua https
        "upgrade-insecure-requests": IS_PROD ? [] : null,
      },
    },
  }),
);

app.use(express.json({ limit: "100kb" }));

// Chỉ thư mục public/ được phép truy cập từ trình duyệt (docs/, src/, .env nằm ngoài)
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/* ---------- Giới hạn ---------- */

// 1) Theo từng người (IP): tối đa RATE_PER_MIN câu mỗi phút
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_PER_MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) =>
    res
      .status(429)
      .json({ error: "Bạn hỏi hơi nhanh rồi, đợi một chút rồi thử lại nhé." }),
});

// 2) Toàn hệ thống: tối đa DAILY_LIMIT lượt gọi AI mỗi ngày (tính theo giờ UTC, lưu trong bộ nhớ)
let dayKey = "";
let dayCount = 0;
function takeDailySlot() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= DAILY_LIMIT) return false;
  dayCount++;
  return true;
}

// 3) Thời gian chờ cho lệnh gọi AI
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("AI timeout"), { status: 504 })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Thử lại một lần nếu model đang bận (503); các lỗi khác báo ngay
async function askSafely(turns, hits) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(askStick(turns, hits), AI_TIMEOUT_MS);
    } catch (err) {
      if (attempt >= 2 || err?.status !== 503) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/* ---------- API chat ---------- */

app.post("/api/chat", chatLimiter, async (req, res) => {
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
  let prevUser = "";
  if (Array.isArray(history)) {
    for (const h of history.slice(-12)) {
      const text = typeof h?.text === "string" ? h.text.trim() : "";
      if (!text || (h.role !== "user" && h.role !== "bot")) continue;
      if (h.role === "user") prevUser = text.slice(0, 1000);
      turns.push({
        role: h.role === "bot" ? "model" : "user",
        parts: [{ text: text.slice(0, 4000) }],
      });
    }
  }
  while (turns.length && turns[0].role === "model") turns.shift();
  turns.push({ role: "user", parts: [{ text: message.trim() }] });

  // Tìm tài liệu. Ghép cả câu hỏi trước để câu nối tiếp vẫn tìm đúng chủ đề
  const hits = search(prevUser + " " + message);

  if (!takeDailySlot()) {
    return res
      .status(429)
      .json({
        error:
          "Stick đã hết lượt hỏi trong hôm nay, bạn quay lại vào ngày mai nhé.",
      });
  }

  try {
    const reply = await askSafely(turns, hits);

    // Chỉ trả về những nguồn mà câu trả lời thật sự trích dẫn bằng [1], [2]...
    const noCode = reply.replace(/```[\s\S]*?```/g, ""); // bỏ khối code, tránh nhầm với a[1]
    const cited = [
      ...new Set(
        [...noCode.matchAll(/(?<![\w\]])\[(\d{1,2})\](?!\()/g)].map((m) =>
          Number(m[1]),
        ),
      ),
    ]
      .filter((n) => n >= 1 && n <= hits.length)
      .sort((a, b) => a - b);
    const sources = cited.map((n) => ({
      n,
      file: hits[n - 1].file,
      heading: hits[n - 1].heading,
    }));

    res.json({ reply, sources });
  } catch (err) {
    // Lỗi thật chỉ ghi ở server (không ghi nội dung câu hỏi), người dùng chỉ thấy câu thân thiện
    console.error("Lỗi gọi Gemini:", err?.status, err?.message);

    if (err?.status === 429) {
      return res
        .status(429)
        .json({
          error:
            "Stick đang quá tải hoặc hết hạn mức, thử lại sau ít phút nhé.",
        });
    }
    if (err?.status === 504) {
      return res
        .status(504)
        .json({ error: "Stick trả lời quá lâu, bạn thử lại nhé." });
    }
    if (err?.status === 503) {
      return res
        .status(503)
        .json({ error: "Mô hình AI đang bận, bạn thử lại sau ít phút nhé." });
    }
    res
      .status(500)
      .json({ error: "Stick đang gặp sự cố, bạn thử lại sau nhé." });
  }
});

/* ---------- Xử lý lỗi chung ---------- */

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Không tìm thấy." });
});

app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large")
    return res.status(413).json({ error: "Dữ liệu gửi lên quá lớn." });
  if (err?.type === "entity.parse.failed")
    return res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ." });
  console.error("Lỗi không mong đợi:", err?.message);
  res.status(500).json({ error: "Có lỗi xảy ra, thử lại nhé." });
});

app.listen(PORT, () => {
  console.log(`Stick đang chạy tại http://localhost:${PORT}`);
});
