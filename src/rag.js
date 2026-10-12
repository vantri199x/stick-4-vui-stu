import fs from "node:fs";
import path from "node:path";

const K1 = 1.5;          // độ bão hòa tần suất từ
const B = 0.75;          // mức chuẩn hóa theo độ dài đoạn
const MAX_CHUNK = 900;   // độ dài tối đa (ký tự) của một đoạn
export const MIN_SCORE = Number(process.env.RAG_MIN_SCORE) || 6;   // chỉnh trong .env, không cần sửa code

let chunks = [];
const df = new Map();    // document frequency: từ này xuất hiện trong bao nhiêu đoạn
let avgLen = 1;

// Từ phổ biến, bỏ qua khi tìm kiếm (đã bỏ dấu)
const STOP = new Set([
  "la", "va", "cua", "co", "cho", "khi", "nay", "the", "nao", "gi", "khong", "mot",
  "cac", "nhung", "duoc", "trong", "de", "voi", "ve", "hay", "thi", "ma", "can",
  "nhu", "tu", "den", "da", "se", "dang", "rat", "minh", "ban", "toi", "em",
  "giai", "thich", "vi", "du", "sao", "bao", "nhieu",
  "cach", "dung", "lam", "hom", "tai"
]);

// Bỏ dấu để người dùng gõ "con tro" vẫn khớp với "con trỏ"
export function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

// Tách từ, giữ cả từ đơn lẫn cặp từ liền kề ("con_tro", "danh_sach")
export function tokenize(text) {
  const words = norm(text)
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i++) tokens.push(words[i] + "_" + words[i + 1]);
  return tokens;
}

// Dòng "# include", "# define"... là code C, KHÔNG phải đầu mục
const PREPROC = /^#\s*(include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error)\b/;

function headingOf(line, isMd) {
  const t = line.trim();
  if (!t || PREPROC.test(t)) return null;
  if (isMd) {
    const m = t.match(/^#{1,3}\s+(.*)/);
    return m ? m[1].trim() : null;
  }
  // File .txt: nhận diện "Chương 1...", "Bài 2...", "1.2. Tên mục" (ngắn, không phải dòng code)
  if (t.length <= 80 && /^(chương|chuong|bài|bai|phần|phan|mục|muc)\s+\d+/i.test(t)) return t;
  if (t.length <= 80 && /^\d+(\.\d+)+[.)]?\s+\S/.test(t) && !/[;{}]$/.test(t)) return t;
  return null;
}

// Cắt một file thành các đoạn theo đầu mục, không cắt giữa khối code có rào ```
function splitIntoChunks(text, file, isMd) {
  const out = [];
  let heading = path.basename(file).replace(/\.[^.]+$/, "");
  let real = false;      // true khi đầu mục lấy từ nội dung thật, không phải tên file
  let buf = "";
  let inCode = false;

  const flush = () => {
    const t = buf.trim();
    if (t.length >= 30) out.push({ file, heading, real, text: t });
    buf = "";
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim().startsWith("```")) inCode = !inCode;
    const h = inCode ? null : headingOf(line, isMd);
    if (h) {
      flush();
      heading = h;
      real = true;
      continue;
    }
    buf += line + "\n";
    if (!inCode && line.trim() === "" && buf.length >= MAX_CHUNK) flush();
  }
  flush();

  // Đánh số phần cho các đoạn cùng đầu mục để phân biệt trong phần Nguồn
  const total = new Map();
  for (const c of out) total.set(c.heading, (total.get(c.heading) || 0) + 1);
  const seen = new Map();
  for (const c of out) {
    const i = (seen.get(c.heading) || 0) + 1;
    seen.set(c.heading, i);
    c.label = total.get(c.heading) > 1 ? `${c.heading} (phần ${i})` : c.heading;
  }
  return out;
}

function listFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else if (/\.(md|txt)$/i.test(entry.name)) result.push(full);
  }
  return result;
}

// Đọc toàn bộ tài liệu và dựng chỉ mục (gọi một lần lúc khởi động server)
export function loadDocs(docsDir) {
  chunks = [];
  df.clear();
  let files = [];
  try {
    files = listFiles(docsDir);
  } catch {
    console.warn("Không đọc được thư mục docs:", docsDir);
  }

  for (const f of files) {
    const rel = path.relative(docsDir, f).split(path.sep).join("/");
    const text = fs.readFileSync(f, "utf8");
    chunks.push(...splitIntoChunks(text, rel, /\.md$/i.test(f)));
  }

  let total = 0;
  for (const c of chunks) {
    // Đầu mục thật được tính 2 lần để ưu tiên; tên file thì không
    const tokens = tokenize((c.real ? c.heading + " " + c.heading + " " : "") + c.text);
    c.len = tokens.length || 1;
    c.tf = new Map();
    for (const t of tokens) c.tf.set(t, (c.tf.get(t) || 0) + 1);
    for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    total += c.len;
  }
  avgLen = chunks.length ? total / chunks.length : 1;
  return { files: files.length, chunks: chunks.length };
}

// Tìm k đoạn liên quan nhất với câu hỏi
export function search(query, k = 4, minScore = MIN_SCORE) {
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length || !chunks.length) return [];

  const N = chunks.length;
  const scored = [];
  for (const c of chunks) {
    let score = 0;
    for (const t of qTokens) {
      const f = c.tf.get(t);
      if (!f) continue;
      const n = df.get(t);
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * c.len) / avgLen));
    }
    if (score > 0) scored.push({ file: c.file, heading: c.label, text: c.text, score });
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((s) => s.score >= minScore && s.score >= top * 0.35).slice(0, k);
}