# Chatbot Commercial WhatsApp - IPTV

Chatbot IA pour la gestion automatisee des leads Meta Ads via WhatsApp Business API.

## Fonctionnalites

- Reception automatique des leads Meta Ads (Facebook/Instagram)
- Contact automatique via WhatsApp Business API
- Qualification intelligente des leads avec scoring
- Guide interactif pour l'installation sur Smart TV
- Activation d'essai gratuit automatisee
- Dashboard admin pour la gestion des leads et conversations
- IA conversationnelle (Claude + OpenAI fallback)

## Stack Technique

| Composant | Technologie |
|-----------|-------------|
| Backend | Node.js + TypeScript + Express |
| Base de donnees | PostgreSQL |
| Cache/Queue | Redis + Bull |
| WhatsApp | Meta Cloud API |
| IA | Claude (Anthropic) + OpenAI |
| Dashboard | React + Vite + TailwindCSS |

## Prerequis

- Node.js 18+
- Docker et Docker Compose
- Compte Meta Developer (pour WhatsApp Business API)
- Cle API Anthropic (Claude) et/ou OpenAI

## Installation Rapide

```bash
# 1. Cloner le repository
git clone https://github.com/mahmoudel24rb-debug/chatbot-commercial.git
cd chatbot-commercial

# 2. Installer les dependances
npm install

# 3. Configurer l'environnement
cp .env.example .env
# Editer .env avec vos cles API

# 4. Lancer les services Docker (PostgreSQL + Redis)
npm run docker:up

# 5. Executer les migrations
npm run db:migrate

# 6. Lancer en developpement
npm run dev
```

## Structure du Projet

```
chatbot-commercial/
├── src/
│   ├── api/           # Routes et webhooks
│   ├── config/        # Configuration
│   ├── database/      # Modeles et repositories
│   ├── services/      # Logique metier
│   ├── queue/         # Jobs asynchrones
│   ├── prompts/       # Prompts IA
│   └── utils/         # Utilitaires
├── dashboard/         # Frontend React
├── tests/             # Tests
└── docker-compose.yml
```

## Scripts Disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Lancer en mode developpement |
| `npm run build` | Compiler TypeScript |
| `npm start` | Lancer en production |
| `npm test` | Executer les tests |
| `npm run docker:up` | Demarrer PostgreSQL + Redis |
| `npm run db:migrate` | Executer les migrations |

## Configuration WhatsApp Business API

1. Creer une app sur [developers.facebook.com](https://developers.facebook.com)
2. Ajouter le produit "WhatsApp"
3. Configurer le webhook avec l'URL: `https://votre-domaine.com/webhooks/whatsapp`
4. Copier les credentials dans `.env`

Voir [SETUP.md](SETUP.md) pour le guide complet.

## Endpoints API

### Webhooks
- `POST /webhooks/meta/leads` - Reception des leads Meta Ads
- `POST /webhooks/whatsapp` - Messages WhatsApp entrants
- `GET /webhooks/whatsapp` - Verification webhook

### API REST
- `GET /api/leads` - Liste des leads
- `GET /api/leads/:id` - Detail d'un lead
- `GET /api/conversations/:id` - Historique conversation
- `GET /api/stats` - Statistiques

## Flow Conversationnel

```
Lead Meta Ads
     ↓
Message de bienvenue WhatsApp
     ↓
Qualification (besoins, budget)
     ↓
Identification type de TV
     ↓
Guide d'installation personnalise
     ↓
Activation essai gratuit
     ↓
Suivi et support
```

## Securite

- Validation des signatures webhook Meta
- Rate limiting sur tous les endpoints
- Chiffrement des donnees sensibles
- Variables d'environnement pour les secrets
- Sanitization des inputs utilisateur

## Licence

Prive - Usage personnel uniquement
