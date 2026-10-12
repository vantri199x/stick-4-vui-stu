import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDocs, search, norm, MIN_SCORE } from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const info = loadDocs(path.join(__dirname, "..", "docs"));
console.log(`Đã nạp ${info.chunks} đoạn từ ${info.files} file | ngưỡng hiện tại: ${MIN_SCORE}\n`);

// has: từ/cụm (viết thường, KHÔNG dấu) mà đoạn tìm được PHẢI chứa. null = câu ngoài tài liệu, KHÔNG được có kết quả.
// >>> Sửa các "has" cho khớp với từ thật sự có trong giáo trình của bạn <<<
const TESTS = [
  { q: "Con trỏ khác mảng ở điểm nào?", has: "con tro" },
  { q: "Toán tử & và * dùng để làm gì?", has: "dia chi" },
  { q: "stack va queue khac nhau gi", has: "lifo" },
  { q: "LIFO nghĩa là gì?", has: "lifo" },
  { q: "Tháp Hà Nội cần bao nhiêu bước?", has: "ha noi" },
  // Thêm 5-10 câu hỏi nữa từ giáo trình của bạn ở đây

  // Câu ngoài tài liệu: không được có kết quả
  { q: "Hôm nay thời tiết thế nào?", has: null },
  { q: "Cách nấu phở bò", has: null },
  { q: "Stick là gì?", has: null }
];

let pass = 0;
const inScores = [];
const outScores = [];

for (const t of TESTS) {
  const raw = search(t.q, 4, 0);   // không lọc ngưỡng, để thấy điểm thật
  const kept = search(t.q);        // đúng như server đang dùng
  let ok, score;

  if (t.has === null) {
    ok = kept.length === 0;
    score = raw[0]?.score ?? 0;
    outScores.push(score);
  } else {
    const hit = (h) => norm(h.text).includes(t.has);
    ok = kept.some(hit);
    score = raw.find(hit)?.score ?? 0;
    inScores.push(score);
  }
  if (ok) pass++;

  console.log(`${ok ? "ĐẠT  " : "TRƯỢT"} | điểm ${score.toFixed(2)} | ${t.q}`);
  console.log(`        → ${kept.length ? kept.map((h) => `${h.file} › ${h.heading.slice(0, 40)}`).join(" ; ") : "(không có đoạn nào)"}`);
}

console.log(`\nKết quả: ${pass}/${TESTS.length} đạt`);
if (inScores.length && outScores.length) {
  const inMin = Math.min(...inScores);
  const outMax = Math.max(...outScores);
  console.log(`Câu TRONG tài liệu: điểm thấp nhất ${inMin.toFixed(2)} | Câu NGOÀI tài liệu: điểm cao nhất ${outMax.toFixed(2)}`);
  if (inMin > outMax) console.log(`→ Tách được. Gợi ý RAG_MIN_SCORE ≈ ${((inMin + outMax) / 2).toFixed(1)}`);
  else console.log("→ Hai nhóm còn chồng lấn: một ngưỡng chưa đủ, hãy dựa vào model và nguồn được trích dẫn (bước 3).");
}