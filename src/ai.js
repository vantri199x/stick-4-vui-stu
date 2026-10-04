import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const MOCK = process.env.AI_MOCK === "true";

if (!apiKey && !MOCK) {
  console.error("Thiếu GEMINI_API_KEY trong file .env (hoặc đặt AI_MOCK=true)");
  process.exit(1);
}

const ai = MOCK ? null : new GoogleGenAI({ apiKey });

const SYSTEM_PROMPT = `Bạn là Stick, trợ lý học tập cho sinh viên môn Lập trình C và Cấu trúc dữ liệu & giải thuật (DSA).

Quy tắc:
- Luôn trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu, giọng thân thiện.
- Giải thích khái niệm từng bước, có ví dụ. Code C đặt trong khối mã (\`\`\`c).
- Với bài tập, ưu tiên gợi ý hướng làm và giải thích tư duy, không chỉ đưa đáp án.
- Nếu câu hỏi nằm ngoài môn C và DSA, nhẹ nhàng nói rằng bạn chỉ hỗ trợ hai môn này.
- Nếu không chắc chắn, hãy nói thẳng là chưa chắc, đừng bịa.`;

export async function askStick(contents) {
  if (MOCK) {
    const last = Array.isArray(contents)
      ? contents.at(-1)?.parts?.[0]?.text
      : contents;
    return `[Chế độ giả lập] Bạn vừa hỏi: "${last}"\n\nĐây là câu trả lời mẫu để thử giao diện:\n\n- Ý thứ nhất, có **chữ đậm**\n- Ý thứ hai, có \`code inline\`\n\n\`\`\`c\nint x = 10;\nint *p = &x;\n\`\`\``;
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: SYSTEM_PROMPT },
  });
  return response.text;
}
