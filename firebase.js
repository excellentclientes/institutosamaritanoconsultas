// firebase.js — camada de dados e autenticação do Atlas Consultas.
// Carregado no index.html com: <script type="module" src="firebase.js"></script>
// Usa os módulos via CDN (sem bundler). Se você migrar para Vite/Webpack, troque as URLs
// "https://www.gstatic.com/firebasejs/10.14.1/..." por "firebase/app", "firebase/auth" etc.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit,
  where, getDocs, getCountFromServer, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

// A apiKey do Firebase Web é identificadora (não é segredo). A proteção real está
// nas regras do Firestore (firestore.rules) e nas Cloud Functions.
const firebaseConfig = {
  apiKey: "AIzaSyAhvlNGgG_w31KMVynSN-9LJHg5rdByULs",
  authDomain: "institutosamaritanoconsultas.firebaseapp.com",
  projectId: "institutosamaritanoconsultas",
  storageBucket: "institutosamaritanoconsultas.firebasestorage.app",
  messagingSenderId: "828296421204",
  appId: "1:828296421204:web:9866975495fba8937d32c1"
};

// Único e-mail com acesso ao painel administrativo (conferido também em firestore.rules e nas Functions).
const ADMIN_EMAIL = "excellentservices.excel@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "pt-BR";
const db = getFirestore(app);
const fns = getFunctions(app, "southamerica-east1"); // mesma região usada no deploy das Functions

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const isAdminUser = (u) => !!u && u.emailVerified === true && (u.email || "").toLowerCase() === ADMIN_EMAIL;
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

async function loadProfile(user) {
  if (isAdminUser(user)) {
    return { email: user.email, nome: user.displayName || "Administrador", role: "admin", status: "ativo", codigo: "ADMIN", municipio: "—" };
  }
  const ref = doc(db, "users", user.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    // Primeiro acesso: cria o cadastro como licenciado pendente. O administrador aprova depois.
    await setDoc(ref, {
      email: user.email, nome: user.displayName || user.email.split("@")[0],
      codigo: "", municipio: "", role: "licenciado", status: "pendente", createdAt: serverTimestamp()
    });
    snap = await getDoc(ref);
  }
  return snap.data();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { emit("atlas:auth", { user: null, profile: null, isAdmin: false }); return; }
  try {
    const profile = await loadProfile(user);
    emit("atlas:auth", { user: { uid: user.uid, email: user.email }, profile, isAdmin: isAdminUser(user) });
  } catch (e) {
    console.error(e);
    emit("atlas:auth", { user: { uid: user.uid, email: user.email }, profile: null, isAdmin: false, error: e.message });
  }
});

const friendly = (e) => ({
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/user-not-found": "Conta não encontrada.",
  "auth/email-already-in-use": "Este e-mail já possui cadastro.",
  "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
  "auth/popup-closed-by-user": "Login com Google cancelado.",
  "auth/popup-blocked": "O navegador bloqueou a janela do Google. Libere pop-ups para este site.",
  "auth/network-request-failed": "Sem conexão. Verifique a internet.",
  "permission-denied": "Você não tem permissão para esta ação.",
  "functions/internal": "O servidor de consultas não respondeu. Verifique se as Cloud Functions foram publicadas (firebase deploy --only functions).",
  "functions/not-found": "A função de consulta não foi encontrada. Publique as Cloud Functions na região southamerica-east1.",
  "functions/unavailable": "A fonte de dados está indisponível no momento. Tente novamente.",
  "functions/failed-precondition": "A integração de API ainda não foi configurada no painel admin (aba API).",
  "functions/permission-denied": "Seu acesso ainda não foi liberado pelo administrador.",
  "functions/unauthenticated": "Faça login para consultar.",
  "functions/invalid-argument": "Valor inválido para esta consulta."
}[e.code] || e.message || "Erro inesperado.");

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return Timestamp.fromDate(d); };

window.Atlas = {
  ADMIN_EMAIL,
  friendly,

  // ----- autenticação -----
  async loginGoogle() {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, p);
  },
  async loginEmail(email, senha) { await signInWithEmailAndPassword(auth, email, senha); },
  async signupEmail(nome, email, senha) {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    if (nome) await updateProfile(cred.user, { displayName: nome });
    try { await sendEmailVerification(cred.user); } catch (_) {}
  },
  resetPassword: (email) => sendPasswordResetEmail(auth, email),
  logout: () => signOut(auth),

  // ----- consulta (passa pela Cloud Function; a chave do fornecedor nunca vem ao navegador) -----
  async consultar(tipo, valor) {
    const r = await httpsCallable(fns, "consultar")({ tipo, valor });
    return r.data;
  },

  // ----- licenciado: próprio histórico -----
  async meuHistorico(uid, n = 20) {
    const q = query(collection(db, "consultas"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(n));
    return rows(await getDocs(q));
  },

  // ----- administrador -----
  async adminStats() {
    const [ativos, hoje] = await Promise.all([
      getCountFromServer(query(collection(db, "users"), where("status", "==", "ativo"))),
      getCountFromServer(query(collection(db, "consultas"), where("createdAt", ">=", today0())))
    ]);
    const recentes = rows(await getDocs(query(collection(db, "consultas"), where("createdAt", ">=", today0()), orderBy("createdAt", "desc"), limit(500))));
    const porMun = {};
    recentes.forEach((c) => { const m = c.municipio || "Sem município"; porMun[m] = (porMun[m] || 0) + 1; });
    return { licenciadosAtivos: ativos.data().count, consultasHoje: hoje.data().count, municipios: Object.keys(porMun).length, porMunicipio: porMun };
  },
  async listUsers() { return rows(await getDocs(query(collection(db, "users"), limit(500)))); },
  async updateUser(uid, data) {
    const allowed = {};
    ["nome", "codigo", "municipio", "status"].forEach((k) => { if (k in data) allowed[k] = data[k]; });
    await updateDoc(doc(db, "users", uid), allowed);
  },
  async listConsultas(n = 100) { return rows(await getDocs(query(collection(db, "consultas"), orderBy("createdAt", "desc"), limit(n)))); },
  async getApiConfig() { const s = await getDoc(doc(db, "config", "api")); return s.exists() ? s.data() : null; },
  async saveApiConfig(cfg) { await setDoc(doc(db, "config", "api"), { ...cfg, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.email }, { merge: true }); }
};

emit("atlas:ready", {});
