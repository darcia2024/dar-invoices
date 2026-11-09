// Reads screenshots of receipts / transfer proofs / e-wallet history with a vision model on
// OpenRouter and returns the spending transactions it finds. Images are only forwarded to the
// API, never stored. Set OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL) on Vercel.
const { hasValidSession, requestWorkspace } = require("./_session");
const { getWorkspace } = require("./_workspaces");
const { demoScan, pause } = require("./_demo-ai");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const MAX_IMAGES = 5;
const MAX_IMAGE_BASE64 = 1_400_000; // ~1 MB per image after the browser downscales it
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          image_index: { type: "integer", description: "0-based index of the screenshot this came from" },
          date: { type: "string", description: "YYYY-MM-DD, or empty string if no date is visible" },
          amount: { type: "integer", description: "Amount in whole rupiah, no decimals" },
          merchant: { type: "string", description: "Store, recipient, or app name" },
          description: { type: "string", description: "Short Indonesian description of what was bought or paid" },
          pos_id: { type: "string", description: "id of the best matching budget item, or empty string" },
          is_expense: { type: "boolean", description: "false for money coming in, top-ups between own accounts, or refunds" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["image_index", "date", "amount", "merchant", "description", "pos_id", "is_expense", "confidence"],
        additionalProperties: false,
      },
    },
    notes: { type: "string", description: "Anything unreadable or ambiguous, in Indonesian; empty if none" },
  },
  required: ["transactions", "notes"],
  additionalProperties: false,
};

function buildPrompt(posOptions, today) {
  const posList = posOptions.length
    ? posOptions.map((p) => `- id "${p.id}": ${p.name} (${p.category})`).join("\n")
    : "(no budget items this month)";
  return `These are screenshots from someone in Indonesia tracking daily spending: shop receipts, bank transfer proofs, m-banking or e-wallet (GoPay, DANA, etc.) history, or online order summaries.

Extract every spending transaction you can read.
- One shop receipt or order summary is one transaction: use the final amount actually paid (after discounts, including tax and fees), and summarize the items in "description".
- A transaction-history screenshot can hold several transactions: list each outgoing one separately.
- Amounts are whole rupiah. "Rp 1.250.000" is 1250000. If a receipt is in another currency (for example EGP / LE), still return the number as written and say so in "description".
- Dates: return YYYY-MM-DD. Today is ${today}; if the year is missing, use the most recent date that is not in the future. Empty string if no date is visible.
- Set is_expense to false for incoming money, refunds, or moving money between the person's own accounts, but still list them.
- pos_id: pick the budget item below that this spending most likely belongs to, or "" if none fits. Use only ids from this list.
- Do not invent transactions. If a screenshot has no readable transaction, return nothing for it and mention it in "notes".

Budget items this month:
${posList}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const wsSlug = requestWorkspace(req);
    if (!hasValidSession(req, wsSlug)) return res.status(401).json({ error: "Unauthorized" });
    const workspace = wsSlug ? getWorkspace(wsSlug) : null;
    const aiOff = Boolean(workspace && workspace.ai === false);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey && !aiOff) {
      return res.status(503).json({ error: "OPENROUTER_API_KEY belum diatur di Vercel. Scan struk belum bisa dipakai." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length === 0) return res.status(400).json({ error: "Tidak ada gambar yang dikirim." });
    if (images.length > MAX_IMAGES) return res.status(400).json({ error: `Maksimal ${MAX_IMAGES} gambar per sekali scan.` });
    for (const img of images) {
      if (!img || typeof img.data !== "string" || !MEDIA_TYPES.has(img.mediaType)) {
        return res.status(400).json({ error: "Format gambar tidak didukung." });
      }
      if (img.data.length > MAX_IMAGE_BASE64) return res.status(413).json({ error: "Gambar terlalu besar." });
    }

    const posOptions = (Array.isArray(body.posOptions) ? body.posOptions : [])
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .slice(0, 60)
      .map((p) => ({ id: p.id.slice(0, 80), name: p.name.slice(0, 80), category: String(p.category || "").slice(0, 40) }));
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);

    // AI switched off for this account (public demo): sample results, no OpenRouter call.
    if (aiOff) {
      await pause(1500 + Math.random() * 1000);
      return res.status(200).json(demoScan({ images, posOptions, today }));
    }

    const content = [];
    images.forEach((img, i) => {
      content.push({ type: "text", text: `Screenshot ${i}:` });
      content.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } });
    });
    content.push({ type: "text", text: buildPrompt(posOptions, today) });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    let apiResponse;
    try {
      apiResponse = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://temantiket.com",
          "X-Title": "DAR Invoices",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
          max_tokens: 4000,
          messages: [{ role: "user", content }],
          response_format: { type: "json_schema", json_schema: { name: "receipt_transactions", strict: true, schema: RESULT_SCHEMA } },
          provider: { require_parameters: true },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      const status = apiResponse.status;
      console.error("OpenRouter error:", status, data && data.error);
      if (status === 401 || status === 403) return res.status(503).json({ error: "API key OpenRouter ditolak. Cek OPENROUTER_API_KEY di Vercel." });
      if (status === 402) return res.status(503).json({ error: "Saldo OpenRouter habis. Isi kredit dulu di openrouter.ai." });
      if (status === 429) return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi sebentar." });
      return res.status(502).json({ error: "Gagal membaca struk. Coba lagi." });
    }

    const choice = data.choices && data.choices[0];
    if (!choice || !choice.message) return res.status(502).json({ error: "Gagal membaca struk. Coba lagi." });
    if (choice.finish_reason === "length") {
      return res.status(422).json({ error: "Terlalu banyak transaksi sekaligus. Coba scan lebih sedikit gambar." });
    }
    const raw = typeof choice.message.content === "string"
      ? choice.message.content
      : (choice.message.content || []).map((part) => part.text || "").join("");
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (e) {
      console.error("Unparseable model output:", raw.slice(0, 500));
      return res.status(502).json({ error: "Hasil bacaan tidak terbaca. Coba lagi." });
    }
    const validPos = new Set(posOptions.map((p) => p.id));
    const transactions = (parsed.transactions || [])
      .filter((t) => Number.isFinite(t.amount) && t.amount > 0)
      .map((t) => ({
        imageIndex: Math.max(0, Math.min(images.length - 1, Number(t.image_index) || 0)),
        date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : "",
        amount: Math.round(t.amount),
        merchant: String(t.merchant || "").slice(0, 80),
        description: String(t.description || "").slice(0, 160),
        posId: validPos.has(t.pos_id) ? t.pos_id : "",
        isExpense: t.is_expense !== false,
        confidence: ["high", "medium", "low"].includes(t.confidence) ? t.confidence : "medium",
      }));

    return res.status(200).json({ transactions, notes: String(parsed.notes || "").slice(0, 400) });
  } catch (error) {
    if (error && error.name === "AbortError") return res.status(504).json({ error: "Waktu baca struk habis. Coba lagi dengan gambar lebih sedikit." });
    console.error("scan-receipt failed:", error);
    return res.status(502).json({ error: "Gagal membaca struk. Coba lagi." });
  }
};
