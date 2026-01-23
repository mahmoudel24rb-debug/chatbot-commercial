# Guide d'Installation Complet

Ce guide vous accompagne dans la configuration complete du chatbot commercial WhatsApp.

## Table des Matieres

1. [Prerequis](#prerequis)
2. [Installation Locale](#installation-locale)
3. [Configuration Meta Developer](#configuration-meta-developer)
4. [Configuration WhatsApp Business API](#configuration-whatsapp-business-api)
5. [Configuration des Cles IA](#configuration-des-cles-ia)
6. [Premier Test](#premier-test)
7. [Deploiement Production](#deploiement-production)

---

## Prerequis

### Logiciels Requis
- **Node.js** 18 ou superieur
- **Docker Desktop** (pour PostgreSQL et Redis)
- **Git**

### Comptes Requis
- Compte [Meta for Developers](https://developers.facebook.com)
- Compte [Anthropic](https://console.anthropic.com) pour Claude API
- (Optionnel) Compte [OpenAI](https://platform.openai.com) pour fallback

---

## Installation Locale

### 1. Cloner le Repository

```bash
git clone https://github.com/mahmoudel24rb-debug/chatbot-commercial.git
cd chatbot-commercial
```

### 2. Installer les Dependances

```bash
npm install
```

### 3. Configurer l'Environnement

```bash
cp .env.example .env
```

Ouvrez `.env` et remplissez les valeurs (voir sections suivantes).

### 4. Lancer les Services Docker

```bash
# Demarre PostgreSQL et Redis
npm run docker:up

# Verifier que les containers tournent
docker ps
```

### 5. Executer les Migrations

```bash
npm run db:migrate
```

### 6. Lancer le Serveur

```bash
npm run dev
```

Le serveur demarre sur `http://localhost:3000`

---

## Configuration Meta Developer

### Creer une App Meta

1. Allez sur [developers.facebook.com](https://developers.facebook.com)
2. Cliquez sur **Mes apps** > **Creer une app**
3. Selectionnez **Business** comme type d'app
4. Donnez un nom (ex: "Chatbot IPTV")
5. Selectionnez votre Business Manager

### Ajouter WhatsApp a l'App

1. Dans le tableau de bord de l'app, cliquez sur **Ajouter des produits**
2. Trouvez **WhatsApp** et cliquez sur **Configurer**
3. Suivez les instructions pour lier un numero de telephone

### Recuperer les Credentials

Dans les parametres de l'app, notez:
- **App ID** → `META_APP_ID`
- **App Secret** → `META_APP_SECRET`

---

## Configuration WhatsApp Business API

### Numero de Test (Developpement)

Meta fournit un numero de test gratuit pour le developpement:

1. Dans WhatsApp > **Demarrage rapide**
2. Notez le **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
3. Notez le **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
4. Generez un **Access Token** → `WHATSAPP_ACCESS_TOKEN`

### Configurer le Webhook

1. Dans WhatsApp > **Configuration**
2. Cliquez sur **Modifier** a cote de Webhook
3. URL de rappel: `https://votre-domaine.com/webhooks/whatsapp`
4. Token de verification: choisissez une chaine aleatoire → `WHATSAPP_VERIFY_TOKEN`
5. Abonnez-vous aux champs: `messages`, `message_status`

> **Note**: Pour le developpement local, utilisez [ngrok](https://ngrok.com) pour exposer votre localhost:
> ```bash
> ngrok http 3000
> ```

### Ajouter des Numeros de Test

1. Dans WhatsApp > **Demarrage rapide**
2. Ajoutez votre numero de telephone personnel comme destinataire de test
3. Verifiez avec le code recu par SMS

---

## Configuration des Cles IA

### Anthropic (Claude) - Recommande

1. Allez sur [console.anthropic.com](https://console.anthropic.com)
2. Creez un compte ou connectez-vous
3. Dans **API Keys**, creez une nouvelle cle
4. Copiez la cle → `ANTHROPIC_API_KEY`

### OpenAI (Fallback)

1. Allez sur [platform.openai.com](https://platform.openai.com)
2. Dans **API Keys**, creez une nouvelle cle
3. Copiez la cle → `OPENAI_API_KEY`

---

## Premier Test

### Verifier la Configuration

```bash
# Lancer le serveur
npm run dev

# Dans un autre terminal, tester l'API
curl http://localhost:3000/health
```

Reponse attendue: `{"status": "ok"}`

### Tester le Webhook WhatsApp

```bash
# Test de verification
curl "http://localhost:3000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=VOTRE_TOKEN&hub.challenge=test123"
```

Reponse attendue: `test123`

### Envoyer un Message Test

Depuis le tableau de bord Meta WhatsApp:
1. Allez dans **Demarrage rapide**
2. Utilisez le bouton **Envoyer un message** pour tester

---

## Deploiement Production

### Variables d'Environnement Production

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/chatbot_iptv
REDIS_URL=redis://host:6379
```

### Options de Deploiement

**Railway / Render / Heroku:**
- Connectez votre repo GitHub
- Configurez les variables d'environnement
- Le deploiement est automatique

**VPS (DigitalOcean, OVH, etc.):**
```bash
# Build
npm run build

# Lancer avec PM2
pm2 start dist/app.js --name chatbot
```

**Docker:**
```bash
docker build -t chatbot-iptv .
docker run -d -p 3000:3000 --env-file .env chatbot-iptv
```

---

## Depannage

### Le webhook ne recoit pas de messages
- Verifiez que l'URL est accessible publiquement
- Verifiez le token de verification
- Consultez les logs: `docker logs chatbot`

### Erreur de connexion a la base de donnees
- Verifiez que Docker est lance: `docker ps`
- Verifiez DATABASE_URL dans .env

### L'IA ne repond pas
- Verifiez votre cle API Anthropic/OpenAI
- Verifiez les quotas sur votre compte

---

## Support

Pour toute question, ouvrez une issue sur le repository GitHub.
