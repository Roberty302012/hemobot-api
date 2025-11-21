// /api/hemobot.js — função serverless da API do Hemobot
import OpenAI from "openai";

const ORIGIN = "https://hemobot.com.br"; // ajuste se necessário

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_PROJECT ? { project: process.env.OPENAI_PROJECT } : {}),
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// CORS básico
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Evitar cache
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
      body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : req.body || {};
    } catch {
      body = {};
    }

    const userMessage = body?.message ?? body?.text ?? "";
    let threadId = body?.threadId || null;

    if (!userMessage) {
      return res.status(400).json({ answer: "Mensagem vazia." });
    }

    if (!ASSISTANT_ID) {
      return res.status(500).json({ answer: "Configuração ausente: ASSISTANT_ID." });
    }

    // Se não veio threadId, cria um novo thread (primeira interação)
    if (!threadId) {
      const thread = await client.beta.threads.create();
      threadId = thread.id;
    }

    // Envia a mensagem do usuário para o thread existente
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // Dispara o run do Assistente
    let run = await client.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });

    const start = Date.now();
    const TIMEOUT_MS = 25000;

    while (run.status !== "completed") {
      if (["failed", "cancelled", "expired"].includes(run.status)) break;
      if (Date.now() - start > TIMEOUT_MS) break;

      await new Promise((r) => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(threadId, run.id);
    }

    // Busca a última mensagem do assistente
    const messages = await client.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 10,
    });

    const last = messages?.data?.find((m) => m.role === "assistant");
    const textPart = last?.content?.find?.((p) => p.type === "text");

    const answer =
      textPart?.text?.value?.trim() ||
      "Desculpe, não encontrei a informação nos documentos.";

    // Devolve também o threadId para o front-end reaproveitar
    return res.status(200).json({ answer, threadId });

  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ answer: "Erro ao processar sua mensagem no servidor." });
  }
}
