// Vercel serverless function: POST /api/hemobot
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Palavras-chave para filtrar se está dentro do tema
const KEYWORDS = ["doação", "doar", "hemosul", "sangue", "hemoterapia"];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ answer: "Use POST." });
    }

    const { message = "" } = req.body || {};
    const userMessage = String(message).slice(0, 2000);
    const lower = userMessage.toLowerCase();

    // Trava 1: fora do tema
    const dentroDoTema = KEYWORDS.some(k => lower.includes(k));
    if (!dentroDoTema) {
      return res.json({
        answer: "Posso te ajudar apenas com informações sobre doação de sangue. Por favor, faça uma pergunta relacionada a esse tema."
      });
    }

    // Cria thread e envia mensagem do usuário
    const thread = await client.beta.threads.create();
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage
    });

    // Executa o assistente com seus documentos
    const run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
      tool_choice: "auto"
    });

    // Aguarda até terminar
    let status = await client.beta.threads.runs.retrieve(thread.id, run.id);
    while (status.status === "queued" || status.status === "in_progress") {
      await new Promise(r => setTimeout(r, 700));
      status = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Pega última resposta
    const msgs = await client.beta.threads.messages.list(thread.id);
    const last = msgs.data.find(m => m.role === "assistant");
    const raw = JSON.stringify(last || {});

    // Trava 2: se não usou arquivos (File Search) → triagem
    const usedFiles =
      raw.includes("file_") ||
      raw.includes("file_citation") ||
      raw.includes("annotations");

    if (!usedFiles) {
      return res.json({
        answer: "Essa é uma situação que deve ser avaliada pela equipe da triagem clínica. Por favor, procure uma unidade do Hemosul para orientações."
      });
    }

    const textPart = last?.content?.find(p => p.type === "text");
    const answer =
      textPart?.text?.value?.trim() || "Desculpe, não encontrei a informação.";
    return res.json({ answer });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ answer: "Erro ao processar sua mensagem." });
  }
}
