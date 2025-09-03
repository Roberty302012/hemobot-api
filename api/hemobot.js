// Vercel serverless function: POST /api/hemobot
import OpenAI from "openai";

// --- inicialização do cliente (suporta OPENAI_PROJECT opcional) ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_PROJECT ? { project: process.env.OPENAI_PROJECT } : {}),
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// ---- utilitários de normalização/tema ----
const STEMS = ["doa", "hemosul", "sang", "hemoter"]; // doa(ção/ções/doar), sang(ue), hemoter(apia)
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, ""); // remove acentos

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ answer: "Use POST." });
    }

    // validações básicas
    if (!process.env.OPENAI_API_KEY || !ASSISTANT_ID) {
      return res.status(500).json({
        answer:
          "Configuração inválida: faltam variáveis OPENAI_API_KEY e/ou ASSISTANT_ID.",
      });
    }

    // extrai mensagem
    const { message = "" } = req.body || {};
    const userMessage = String(message).slice(0, 4000);
    const lower = norm(userMessage);

    // ---- TRAVA 1: fora do tema (robusta a plural/acentos) ----
    const dentroDoTema = STEMS.some((stem) => lower.includes(stem));
    if (!dentroDoTema) {
      return res.json({
        answer:
          "Posso te ajudar apenas com informações sobre doação de sangue. Por favor, faça uma pergunta relacionada a esse tema.",
      });
    }

    // ---- Assistants API: thread → message → run ----
    const thread = await client.beta.threads.create();

    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    const run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
      tool_choice: "auto", // permite File Search do seu assistente
    });

    // aguarda conclusão do run
    let status = await client.beta.threads.runs.retrieve(thread.id, run.id);
    while (status.status === "queued" || status.status === "in_progress") {
      await new Promise((r) => setTimeout(r, 700));
      status = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // coleta a última mensagem do assistente
    const msgs = await client.beta.threads.messages.list(thread.id);
    const last = msgs.data.find((m) => m.role === "assistant");

    // ---- TRAVA 2: sem evidência de uso de arquivos (retrieval) ----
    // Heurística: procura marcas de arquivos/citações/anotações no objeto retornado
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

    // extrai texto
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
