// /api/hemobot.js — Vercel serverless function
import OpenAI from "openai";

const ORIGIN = "https://hemobot.com.br";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_PROJECT ? { project: process.env.OPENAI_PROJECT } : {}),
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

const STEMS = ["doa", "hemosul", "sang", "hemoter"];
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export default async function handler(req, res) {
  // === CORS + debug header (sempre, antes de qualquer return) ===
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Debug-CORS", "on"); // <-- debug

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ answer: "Use POST." });
    }

    if (!process.env.OPENAI_API_KEY || !ASSISTANT_ID) {
      return res.status(500).json({
        answer:
          "Configuração inválida: faltam variáveis OPENAI_API_KEY e/ou ASSISTANT_ID.",
      });
    }

    const { message = "" } = req.body || {};
    const userMessage = String(message).slice(0, 4000);
    const lower = norm(userMessage);

    const dentroDoTema = STEMS.some((stem) => lower.includes(stem));
    if (!dentroDoTema) {
      return res.json({
        answer:
          "Posso te ajudar apenas com informações sobre doação de sangue. Por favor, faça uma pergunta relacionada a esse tema.",
      });
    }

    const thread = await client.beta.threads.create();
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });
    const run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
      tool_choice: "auto",
    });

    let status = await client.beta.threads.runs.retrieve(thread.id, run.id);
    while (status.status === "queued" || status.status === "in_progress") {
      await new Promise((r) => setTimeout(r, 700));
      status = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    const msgs = await client.beta.threads.messages.list(thread.id);
    const last = msgs.data.find((m) => m.role === "assistant");

    const raw = JSON.stringify(last || {});
    const usedFiles =
      raw.includes("file_citation") ||
      raw.includes("file_") ||
      raw.includes("annotations");

    if (!usedFiles) {
      return res.json({
        answer:
          "Essa é uma situação que deve ser avaliada pela equipe da triagem clínica. Por favor, procure uma unidade do Hemosul para orientações.",
      });
    }

    const textPart = last?.content?.find((p) => p.type === "text");
    const answer =
      textPart?.text?.value?.trim() ||
      "Desculpe, não encontrei a informação nos documentos.";

    return res.json({ answer });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ answer: "Erro ao processar sua mensagem no servidor." });
  }
}
