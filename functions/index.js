// Cloud Function "consultar": valida o usuário, chama o fornecedor de API e registra a operação.
// Deploy: firebase deploy --only functions
// Chave do fornecedor (nunca no navegador):  firebase functions:secrets:set PROVIDER_API_KEY
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const PROVIDER_API_KEY = defineSecret("PROVIDER_API_KEY");
const ADMIN_EMAIL = "excellentservices.excel@gmail.com";
const TIPOS = ["cpf", "cnpj", "cep", "placa", "telefone", "email", "nome"];

const digits = (s) => String(s).replace(/\D/g, "");

function cpfOk(c) {
  c = digits(c);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== +c[n]) return false;
  }
  return true;
}
function cnpjOk(c) {
  c = digits(c);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [12, 13]) {
    let s = 0, p = n - 7;
    for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; }
    if (((s % 11) < 2 ? 0 : 11 - (s % 11)) !== +c[n]) return false;
  }
  return true;
}
function validar(tipo, v) {
  const d = digits(v);
  if (tipo === "cpf") return cpfOk(v) ? d : null;
  if (tipo === "cnpj") return cnpjOk(v) ? d : null;
  if (tipo === "cep") return d.length === 8 ? d : null;
  if (tipo === "telefone") return d.length === 10 || d.length === 11 ? d : null;
  if (tipo === "placa") return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(String(v).toUpperCase().replace("-", "")) ? String(v).toUpperCase().replace("-", "") : null;
  if (tipo === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? String(v).toLowerCase() : null;
  if (tipo === "nome") return String(v).trim().length >= 3 ? String(v).trim() : null;
  return null;
}
function mascarar(tipo, v) {
  const d = digits(v);
  if (tipo === "cpf") return d.slice(0, 3) + ".***.***-" + d.slice(9);
  if (tipo === "cnpj") return d.slice(0, 2) + ".***.***/****-" + d.slice(12);
  if (tipo === "cep") return d.slice(0, 5) + "-•••";
  if (tipo === "placa") return String(v).slice(0, 3) + "•••";
  if (tipo === "telefone") return "(" + d.slice(0, 2) + ") 9****-" + d.slice(-4);
  if (tipo === "email") { const [u, dm] = String(v).split("@"); return u.slice(0, 2) + "***@" + dm; }
  return String(v).slice(0, 14) + (String(v).length > 14 ? "…" : "");
}

// >>> ADAPTADOR DO FORNECEDOR <<<
// Quando você escolher a API, converta a resposta dela para este formato padrão, que o site já sabe exibir:
// { status, fontes:[string], campos:[{label,value}], listas:[{titulo, itens:[{titulo, sub, valor, tag}]}] }
function normalizar(tipo, bruto) {
  const campos = Object.entries(bruto && typeof bruto === "object" ? bruto : { resultado: bruto })
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => ({ label: k, value: String(v ?? "—") }));
  return { status: "Concluída", fontes: ["Fornecedor de dados"], campos, listas: [] };
}

exports.consultar = onCall({ region: "southamerica-east1", secrets: [PROVIDER_API_KEY], timeoutSeconds: 30 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Faça login para consultar.");
  const { tipo, valor } = req.data || {};
  if (!TIPOS.includes(tipo)) throw new HttpsError("invalid-argument", "Tipo de consulta inválido.");
  const limpo = validar(tipo, valor || "");
  if (!limpo) throw new HttpsError("invalid-argument", "Valor inválido para " + tipo.toUpperCase() + ".");

  const email = (req.auth.token.email || "").toLowerCase();
  const isAdmin = email === ADMIN_EMAIL && req.auth.token.email_verified === true;
  let perfil = { codigo: "ADMIN", municipio: "—" };
  if (!isAdmin) {
    const s = await db.doc("users/" + req.auth.uid).get();
    if (!s.exists || s.data().status !== "ativo") throw new HttpsError("permission-denied", "Seu acesso ainda não foi liberado pelo administrador.");
    perfil = s.data();
  }

  const cfgSnap = await db.doc("config/api").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : null;
  const path = cfg && cfg.endpoints && cfg.endpoints[tipo];
  if (!cfg || !cfg.ativo || !cfg.baseUrl || !path) throw new HttpsError("failed-precondition", "A integração de API ainda não foi configurada para este tipo de consulta.");

  const url = cfg.baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "").replace("{valor}", encodeURIComponent(limpo));
  const registro = { uid: req.auth.uid, email, codigo: perfil.codigo || "", municipio: perfil.municipio || "", tipo, valorMascarado: mascarar(tipo, limpo), createdAt: admin.firestore.FieldValue.serverTimestamp() };
  const protocolo = "AT-" + Date.now().toString(36).toUpperCase();

  let resposta;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { headers: { [cfg.headerAuth || "Authorization"]: (cfg.prefixoAuth ?? "Bearer ") + PROVIDER_API_KEY.value(), Accept: "application/json" }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("HTTP " + r.status);
    resposta = await r.json();
  } catch (e) {
    await db.collection("consultas").add({ ...registro, protocolo, status: "Fonte indisponível" });
    throw new HttpsError("unavailable", "A fonte de dados está indisponível no momento. Tente novamente.");
  }

  await db.collection("consultas").add({ ...registro, protocolo, status: "Concluída" });
  return { protocolo, tipo, consultadoPor: perfil.codigo, municipio: perfil.municipio, ...normalizar(tipo, resposta) };
});
