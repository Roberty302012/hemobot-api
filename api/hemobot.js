// /api/hemobot.js — Vercel serverless function (Drop-in replacement)
import OpenAI from "openai";

const ORIGIN = "https://hemobot.com.br";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_PROJECT ? { project: process.env.OPENAI_PROJECT } : {}),
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Normalização simples
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[!.,;:?]/g, "");

// Saudações aceitas
const SAUDACOES = new Set(["bom dia", "boa tarde", "boa noite"]);
const isGreeting = (msg) => SAUDACOES.has(norm(msg));

// CORS básico
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// No-cache
function setNoCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export default async function handler(req, res) {
  try {
    setCors(res);
    setNoCache(res);

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ answer: "Método não permitido." });
    }

    // Tenta ler o corpo como JSON de forma segura
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    } catch {
      body = {};
    }

    const userMessage = body?.message ?? body?.text ?? "";

    // PRIORIDADE MÁXIMA: saudações simples
    if (isGreeting(userMessage)) {
      return res.status(200).json({
        answer:
          "Bom dia! 👋 Eu sou o Zé Sanguinho, do Hemosul. Estou aqui para te ajudar com suas dúvidas sobre doação de sangue.",
      });
    }

    if (!ASSISTANT_ID) {
      return res.status(500).json({ answer: "Configuração ausente: ASSISTANT_ID." });
    }

    // Cria thread, envia mensagem do usuário e dispara o run do Assistente
    const thread = await client.beta.threads.create();
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage || "",
    });

    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    // Polling simples até completar (timeout defensivo ~25s)
    const start = Date.now();
    const TIMEOUT_MS = 25000;

    while (run.status !== "completed") {
      if (["failed", "cancelled", "expired"].includes(run.status)) break;
      if (Date.now() - start > TIMEOUT_MS) break;

      await new Promise((r) => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Busca a última mensagem do assistente
    const messages = await client.beta.threads.messages.list(thread.id, { order: "desc", limit: 10 });
    const last = messages?.data?.find((m) => m.role === "assistant");

    const textPart = last?.content?.find?.((p) => p.type === "text");
    const answer =
      textPart?.text?.value?.trim() ||
      "Desculpe, não encontrei a informação nos documentos.";

    return res.status(200).json({ answer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ answer: "Erro ao processar sua mensagem no servidor." });
  }
}