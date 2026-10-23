# Atlas Consultas — estrutura Firebase

Arquivos: index.html (site + painel admin) · firebase.js (Auth + Firestore) · firestore.rules · functions/index.js (Cloud Function `consultar`) · firebase.json

## Passos no console do Firebase (projeto institutosamaritanoconsultas)
1. Authentication → Sign-in method: ativar **Google** e **E-mail/senha**. Em Settings → Authorized domains, adicionar seu domínio.
2. Firestore Database: criar (modo produção, região southamerica-east1).
3. Plano **Blaze** (necessário para Cloud Functions chamarem APIs externas).

## Deploy
    npm i -g firebase-tools && firebase login
    firebase deploy --only firestore          # regras + índice
    (cd functions && npm install)
    firebase functions:secrets:set PROVIDER_API_KEY
    firebase deploy --only functions,hosting

## Fluxo
- Admin: login Google com excellentservices.excel@gmail.com (e-mail verificado) → aparece "Painel admin" no menu.
- Outros: Google ou e-mail/senha → cadastro entra como **pendente**; o admin libera na aba Licenciados (código, município, status).
- Aba API: fornecedor, URL base, cabeçalho e caminho por tipo. Depois ajuste `normalizar()` em functions/index.js para o formato do fornecedor.
