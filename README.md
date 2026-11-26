# ScanIA — Leitura e Digitalização de Notas Fiscais com IA

O **ScanIA** é um aplicativo mobile desenvolvido em **React Native (Expo)** e **Supabase**, projetado para automatizar a leitura, digitação e organização de cupons e notas fiscais de compras utilizando inteligência artificial multimodal (**Google Gemini API**).

O projeto adota boas práticas de engenharia de software, incluindo **Row-Level Security (RLS)** para isolamento de dados de usuários, buckets privados no Supabase Storage, processamento seguro via **Edge Functions (Deno)** e suíte completa de **testes automatizados com Jest**.

---

## 🛠️ Tecnologias Utilizadas

### **Frontend Mobile**
* **React Native & Expo**: Framework multiplataforma para iOS e Android.
* **TypeScript**: Tipagem estática rigorosa para utilitários, telas e serviços.
* **React Navigation / Expo Router**: Navegação por abas e pilhas.
* **Expo Camera & Image Picker**: Captura de foto e seleção de comprovantes na galeria.

### **Backend & Banco de Dados (Supabase)**
* **Supabase Auth**: Autenticação de usuários via JWT.
* **Supabase Database (PostgreSQL)**: Tabelas `receipts` e `receipt_items` com políticas de RLS ativas.
* **Supabase Storage**: Bucket privado `receipts` para armazenar as fotos enviadas.
* **Supabase Edge Functions**: Servidor serverless em **Deno** para processar requisições pesadas sem expor chaves de API no app.

### **Inteligência Artificial Multimodal**
* **Google Gemini API**: Modelo `gemini-3.8-flash` / `gemini-2.5-flash` para interpretação de OCR e estruturação automática de cupons em JSON.

### **Qualidade & Testes**
* **Jest & `jest-expo`**: 36 testes automatizados cobrindo formatação financeira, tratamento de datas brasileiras e higienização da resposta da IA.

---

## 📐 Arquitetura da Aplicação

```text
[ App Mobile (React Native) ]
           │
           ├─ 1. Autenticação (JWT) ──> Supabase Auth
           ├─ 2. Upload da Foto ──────> Supabase Storage (bucket privado 'receipts')
           ├─ 3. Cria Nota ('pending') ─> Supabase DB ('receipts')
           │
           └─ 4. Invocação HTTP ───────> Supabase Edge Function ('scan-receipt')
                                                      │
                                                      ├─ Baixa imagem do Storage
                                                      ├─ Valida token & RLS
                                                      ├─ Envia foto -> Google Gemini API
                                                      ├─ Recebe JSON estruturado
                                                      └─ Atualiza DB ('receipts' + 'receipt_items')
```

---

## 📋 Funcionalidades Principais

* 📸 **Captura e Seleção de Imagens**: Captura rápida via câmera integrada ou seleção de recibos existentes na galeria.
* 🤖 **OCR Inteligente e Estruturação**: Leitura automática de estabelecimento, data da compra, valor total, forma de pagamento, categoria e lista de itens individuais.
* 🛡️ **Revisão Humana (Human-in-the-Loop)**: Tela para o usuário conferir e ajustar qualquer dado extraído antes da confirmação final.
* 📊 **Resumos Mensais**: Visualização de gastos consolidados por mês e agrupamento por categorias (*Mercado, Alimentação, Transporte, Saúde, Moradia, Lazer, Compras, Serviços, Outros*).
* 🔒 **Segurança dos Dados**: Cada usuário acessa estritamente os seus próprios recibos e imagens através de políticas de RLS no PostgreSQL e no Storage.
* ⚡ **Modo Simulado (`MOCK_AI`)**: Opção de executar a Edge Function com respostas estáticas para desenvolvimento e testes sem consumo de cota de IA.

---

## 🚀 Como Executar o Projeto

### **1. Pré-requisitos**
* Node.js (v18+) e npm
* Conta no Supabase
* Chave de API no Google AI Studio

### **2. Clonar o Repositório e Instalar Dependências**
```bash
git clone <URL_DO_REPOSITORIO>
cd scania
npm install
```

### **3. Configurar Variáveis de Ambiente no App (`.env`)**
Crie um arquivo `.env` na raiz do projeto:
```env
EXPO_PUBLIC_SUPABASE_URL=seu_url_supabase
EXPO_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anonima
```

### **4. Configurar o Banco de Dados no Supabase**
No SQL Editor do Supabase, execute o script SQL do arquivo `schema-supabase.txt` para criar as tabelas `receipts` e `receipt_items`, os índices e as políticas de RLS.

### **5. Configurar Segredos e Publicar a Edge Function**
No terminal do projeto, configure os segredos do servidor Supabase:

```bash
# 1. Cadastrar a chave de API do Gemini
npx supabase secrets set GEMINI_API_KEY=sua_chave_gemini

# 2. Desativar o modo simulado
npx supabase secrets set MOCK_AI=false

# 3. Publicar a Edge Function
npx supabase functions deploy scan-receipt --use-api
```

### **6. Iniciar o Aplicativo**
```bash
npx expo start
```
Use o app Expo Go no seu smartphone ou um emulador (Android/iOS) para testar.

---

## 🧪 Testes Automatizados

O projeto conta com testes unitários cobrindo as funções utilitárias críticas:

```bash
# Executar a suíte de testes com Jest
npm test

# Verificar tipagem estática com TypeScript
npm run typecheck

# Verificar/aplicar a formatação de código
npm run format
```

**Resultado dos testes esperados:**
```text
PASS __tests__/parse.test.ts
PASS __tests__/summary.test.ts
PASS __tests__/date.test.ts
PASS __tests__/money.test.ts

Test Suites: 4 passed, 4 total
Tests:       36 passed, 36 total
```

---

## ⚡ Solução de Problemas Comuns (Troubleshooting)

| Problema | Causa | Solução |
| :--- | :--- | :--- |
| `Edge Function returned a non-2xx status code (404)` | A Edge Function ainda não foi enviada para o Supabase. | Execute `npx supabase functions deploy scan-receipt --use-api`. |
| `Falha ao processar a nota (HTTP 500)` | A chave `GEMINI_API_KEY` não foi definida nos segredos. | Execute `npx supabase secrets set GEMINI_API_KEY=...`. |
| `API do Gemini respondeu 404 / 503` | Modelo sobrecarregado ou atualizado pelo provedor. | A Edge Function `v6` possui *fallback* automático. Para forçar um modelo: `npx supabase secrets set GEMINI_MODEL=gemini-3.8-flash`. |
| `receipt_id é obrigatório (HTTP 400)` | Divergência de nome do parâmetro no payload JSON. | Certifique-se de usar a versão atualizada da Edge Function (`scan-receipt-gemini-v6.txt`). |

---

## 📄 Licença

Este projeto foi desenvolvido para fins didáticos e demonstrativos de portfólio profissional.
