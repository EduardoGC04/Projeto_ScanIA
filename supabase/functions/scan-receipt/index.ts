import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MOCK_RESPONSE = {
  establishment: 'Supermercado Exemplo',
  date: '2026-09-19',
  total: 87.4,
  category: 'Mercado',
  paymentMethod: 'Cartão de Crédito',
  items: [
    { description: 'Arroz 5kg', total: 24.9, quantity: 1, unitPrice: 24.9 },
    { description: 'Feijão 1kg', total: 8.5, quantity: 2, unitPrice: 4.25 },
    { description: 'Leite 1L', total: 14.7, quantity: 3, unitPrice: 4.9 },
    { description: 'Café 500g', total: 16.8, quantity: 1, unitPrice: 16.8 },
    { description: 'Detergente', total: 22.5, quantity: 5, unitPrice: 4.5 },
  ],
};

const CATEGORIES = [
  'Mercado',
  'Alimentação',
  'Transporte',
  'Saúde',
  'Moradia',
  'Lazer',
  'Compras',
  'Serviços',
  'Outros',
];

const PROMPT = `Você é um leitor especialista em cupons e notas fiscais brasileiras.
Analise a imagem da nota fiscal e extraia os dados estritamente no formato JSON definido abaixo.

Retorne SOMENTE o objeto JSON válido, sem qualquer texto adicional ou markdown.

Formato esperado:
{
  "establishment": "Nome do estabelecimento (string)",
  "date": "Data da compra em formato AAAA-MM-DD (string)",
  "total": 0.0,
  "category": "Uma das categorias: Mercado, Alimentação, Transporte, Saúde, Moradia, Lazer, Compras, Serviços, Outros",
  "paymentMethod": "Forma de pagamento (ex: Dinheiro, Pix, Cartão de Crédito, Cartão de Débito, VR, VA, Outro)",
  "items": [
    {
      "description": "Nome do item",
      "quantity": 1.0,
      "unitPrice": 0.0,
      "total": 0.0
    }
  ]
}`;

class ReceiptReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptReadError';
  }
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function normalizeReceipt(raw: any) {
  if (!raw || typeof raw !== 'object') throw new ReceiptReadError('Resposta da IA inválida');
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'Outros';
  const total = Number(raw.total) || 0;
  const items = Array.isArray(raw.items)
    ? raw.items.map((it: any) => ({
        description: String(it.description || 'Item sem nome'),
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || Number(it.total) || 0,
        total: Number(it.total) || 0,
      }))
    : [];

  return {
    establishment: String(raw.establishment || 'Estabelecimento Desconhecido'),
    date: String(raw.date || new Date().toISOString().split('T')[0]),
    total,
    category,
    paymentMethod: String(raw.paymentMethod || 'Outro'),
    items,
  };
}

async function callGemini(base64: string): Promise<unknown> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada nos segredos do Supabase.');

  // Lista de modelos ordenada por prioridade (com fallback automático se algum modelo for descontinuado pela API)
  const userModel = Deno.env.get('GEMINI_MODEL');
  const fallbackModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash-latest', 'gemini-flash'];
  const modelsToTry = userModel ? [userModel, ...fallbackModels.filter(m => m !== userModel)] : fallbackModels;

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: PROMPT },
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
          console.warn(`Modelo ${model} retornou 404. Tentando próximo modelo...`);
          lastError = new Error(`Modelo ${model} indisponível (404).`);
          continue;
        }
        throw new Error(`API do Gemini (${model}) respondeu ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new ReceiptReadError(`O Gemini (${model}) não retornou texto ao analisar a imagem.`);
      }

      return JSON.parse(textResponse);
    } catch (err: any) {
      if (err.message && err.message.includes('404')) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Nenhum modelo do Gemini respondeu com sucesso.');
}

async function readReceipt(bytes: Uint8Array): Promise<unknown> {
  const mockAi = Deno.env.get('MOCK_AI') === 'true';
  if (mockAi) {
    await new Promise((res) => setTimeout(res, 1200));
    return MOCK_RESPONSE;
  }
  return normalizeReceipt(await callGemini(toBase64(bytes)));
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Token de autorização não fornecido' }, 401, origin);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Sessão inválida ou expirada' }, 401, origin);
    }

    const body = await req.json();
    const receiptId = body.receipt_id || body.receiptId;
    if (!receiptId) {
      return jsonResponse({ error: 'receipt_id é obrigatório' }, 400, origin);
    }

    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .select('*')
      .eq('id', receiptId)
      .single();

    if (receiptError || !receipt) {
      return jsonResponse({ error: 'Nota fiscal não encontrada' }, 404, origin);
    }

    if (!receipt.image_path) {
      return jsonResponse({ error: 'Nota fiscal não possui imagem associada' }, 400, origin);
    }

    await supabase.from('receipts').update({ status: 'processing' }).eq('id', receiptId);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('receipts')
      .download(receipt.image_path);

    if (downloadError || !fileData) {
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return jsonResponse({ error: 'Erro ao baixar imagem do storage' }, 500, origin);
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return jsonResponse({ error: 'Imagem muito grande' }, 400, origin);
    }

    let parsed: any;
    try {
      parsed = await readReceipt(bytes);
    } catch (err: any) {
      console.error('scan-receipt:', err);
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return jsonResponse({ error: err.message || 'Falha ao processar nota com IA' }, 500, origin);
    }

    const { error: updateError } = await supabase
      .from('receipts')
      .update({
        merchant: parsed.establishment,
        purchase_date: parsed.date,
        total_amount: parsed.total,
        category: parsed.category,
        payment_method: parsed.paymentMethod,
        status: 'done',
      })
      .eq('id', receiptId);

    if (updateError) {
      return jsonResponse({ error: 'Erro ao atualizar nota no banco' }, 500, origin);
    }

    if (parsed.items && parsed.items.length > 0) {
      const itemsToInsert = parsed.items.map((item: any) => ({
        receipt_id: receiptId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_price: item.total,
      }));

      await supabase.from('receipt_items').delete().eq('receipt_id', receiptId);
      await supabase.from('receipt_items').insert(itemsToInsert);
    }

    return jsonResponse({ success: true, receipt: parsed }, 200, origin);
  } catch (err: any) {
    console.error('Unhandled error:', err);
    return jsonResponse({ error: 'Erro interno no servidor' }, 500);
  }
});
