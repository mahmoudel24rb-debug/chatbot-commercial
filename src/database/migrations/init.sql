-- Migration initiale: Creation des tables pour le chatbot IPTV
-- Executee automatiquement par Docker au premier lancement

-- Extension pour les UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- TABLE: leads
-- Stocke les leads provenant de Meta Ads
-- =============================================
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facebook_lead_id VARCHAR(255) UNIQUE,

    -- Informations personnelles
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20) NOT NULL,
    phone_normalized VARCHAR(20) NOT NULL,
    email VARCHAR(255),

    -- Source et tracking
    source VARCHAR(50) DEFAULT 'meta_ads',
    ad_id VARCHAR(255),
    ad_name VARCHAR(255),
    campaign_id VARCHAR(255),
    campaign_name VARCHAR(255),

    -- Statut et scoring
    status VARCHAR(50) DEFAULT 'new',
    score INTEGER DEFAULT 0,
    score_details JSONB DEFAULT '{}',

    -- Donnees additionnelles
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_contact_at TIMESTAMP WITH TIME ZONE,
    converted_at TIMESTAMP WITH TIME ZONE,

    -- Contraintes
    CONSTRAINT valid_status CHECK (status IN ('new', 'contacted', 'qualified', 'trial_setup', 'converted', 'lost')),
    CONSTRAINT valid_score CHECK (score >= 0 AND score <= 100)
);

-- Index pour les recherches frequentes
CREATE INDEX IF NOT EXISTS idx_leads_phone_normalized ON leads(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);

-- =============================================
-- TABLE: conversations
-- Stocke les sessions de conversation
-- =============================================
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

    -- Identifiants WhatsApp
    whatsapp_thread_id VARCHAR(255),
    whatsapp_phone VARCHAR(20),

    -- Etat de la conversation
    state VARCHAR(50) DEFAULT 'initial',
    previous_state VARCHAR(50),

    -- Contexte collecte pendant la conversation
    context JSONB DEFAULT '{}',

    -- Resume IA pour maintenir le contexte
    ai_summary TEXT,

    -- Statuts
    is_active BOOLEAN DEFAULT true,
    escalated_to_human BOOLEAN DEFAULT false,
    escalated_at TIMESTAMP WITH TIME ZONE,
    escalation_reason TEXT,

    -- Agent humain assigne (si escalade)
    assigned_agent_id UUID,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,

    -- Contraintes
    CONSTRAINT valid_conversation_state CHECK (state IN (
        'initial', 'greeting', 'qualification', 'tv_brand_select',
        'tv_setup_guide', 'trial_activation', 'support', 'closed'
    ))
);

-- Index
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_phone ON conversations(whatsapp_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state);
CREATE INDEX IF NOT EXISTS idx_conversations_is_active ON conversations(is_active) WHERE is_active = true;

-- =============================================
-- TABLE: messages
-- Stocke tous les messages de conversation
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

    -- Identifiant WhatsApp
    whatsapp_message_id VARCHAR(255),

    -- Direction et contenu
    direction VARCHAR(10) NOT NULL,
    content TEXT,
    message_type VARCHAR(20) DEFAULT 'text',

    -- Media
    media_url TEXT,
    media_mime_type VARCHAR(100),

    -- Statut de livraison
    status VARCHAR(20) DEFAULT 'sent',
    status_updated_at TIMESTAMP WITH TIME ZONE,

    -- Metadonnees IA
    ai_generated BOOLEAN DEFAULT false,
    ai_provider VARCHAR(20),
    tokens_used INTEGER,
    ai_latency_ms INTEGER,

    -- Intent detecte
    detected_intent VARCHAR(50),
    intent_confidence DECIMAL(4,3),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Contraintes
    CONSTRAINT valid_direction CHECK (direction IN ('inbound', 'outbound')),
    CONSTRAINT valid_message_type CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'template', 'interactive', 'button')),
    CONSTRAINT valid_message_status CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed'))
);

-- Index
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_message_id);

-- =============================================
-- TABLE: tv_brands
-- Reference des marques TV et instructions
-- =============================================
CREATE TABLE IF NOT EXISTS tv_brands (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,

    -- Instructions d'installation
    setup_instructions TEXT,
    setup_steps JSONB DEFAULT '[]',

    -- Medias tutoriels
    video_tutorial_url TEXT,
    image_urls JSONB DEFAULT '[]',

    -- Metadonnees
    app_store_url TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inserer les marques TV par defaut
INSERT INTO tv_brands (name, slug, setup_instructions) VALUES
    ('Samsung Smart TV', 'samsung', 'Ouvrez le Samsung Apps Store, recherchez notre application et installez-la.'),
    ('LG Smart TV', 'lg', 'Accedez au LG Content Store, trouvez notre app et cliquez sur Installer.'),
    ('Android TV', 'android-tv', 'Ouvrez le Google Play Store sur votre TV, recherchez notre app et installez.'),
    ('Apple TV', 'apple-tv', 'Allez dans l''App Store sur votre Apple TV et telechargez notre application.'),
    ('Amazon Fire TV', 'fire-tv', 'Dans le menu principal, allez dans Apps, puis recherchez et installez notre app.'),
    ('Chromecast', 'chromecast', 'Installez notre app sur votre telephone, puis castez vers votre Chromecast.'),
    ('Box Android', 'box-android', 'Telechargez l''APK depuis notre site et installez-le sur votre box.'),
    ('Autre', 'other', 'Contactez-nous pour des instructions personnalisees.')
ON CONFLICT (slug) DO NOTHING;

-- =============================================
-- TABLE: message_templates
-- Templates WhatsApp pre-approuves
-- =============================================
CREATE TABLE IF NOT EXISTS message_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    language VARCHAR(10) DEFAULT 'fr',

    -- Contenu
    header_text TEXT,
    body_text TEXT NOT NULL,
    footer_text TEXT,

    -- Boutons
    buttons JSONB DEFAULT '[]',

    -- Variables (placeholders)
    variables JSONB DEFAULT '[]',

    -- Statut Meta
    meta_template_id VARCHAR(255),
    meta_status VARCHAR(20) DEFAULT 'pending',

    -- Utilisation
    category VARCHAR(50) DEFAULT 'utility',
    is_active BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inserer les templates par defaut
INSERT INTO message_templates (name, body_text, category) VALUES
    ('welcome', 'Bonjour {{1}} ! Merci pour votre interet. Je suis votre assistant virtuel et je vais vous aider a decouvrir nos offres IPTV.', 'marketing'),
    ('qualification', 'Pour mieux vous conseiller, pourriez-vous me dire quel type de television vous utilisez ?', 'utility'),
    ('trial_activation', 'Excellent ! Voici votre code d''essai gratuit : {{1}}. Il est valable {{2}} jours.', 'utility'),
    ('setup_complete', 'Parfait, l''installation semble terminee ! Profitez bien de votre essai gratuit.', 'utility')
ON CONFLICT (name) DO NOTHING;

-- =============================================
-- TABLE: lead_events
-- Historique des evenements sur les leads
-- =============================================
CREATE TABLE IF NOT EXISTS lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

    -- Type d'evenement
    event_type VARCHAR(50) NOT NULL,

    -- Donnees de l'evenement
    data JSONB DEFAULT '{}',

    -- Auteur (system, ai, agent_id)
    actor_type VARCHAR(20) DEFAULT 'system',
    actor_id VARCHAR(255),

    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id ON lead_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_type ON lead_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lead_events_created_at ON lead_events(created_at DESC);

-- =============================================
-- FONCTIONS UTILITAIRES
-- =============================================

-- Fonction pour mettre a jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at
DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tv_brands_updated_at ON tv_brands;
CREATE TRIGGER update_tv_brands_updated_at
    BEFORE UPDATE ON tv_brands
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_message_templates_updated_at ON message_templates;
CREATE TRIGGER update_message_templates_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VUES UTILES
-- =============================================

-- Vue des leads avec statistiques de conversation
CREATE OR REPLACE VIEW lead_summary AS
SELECT
    l.id,
    l.first_name,
    l.last_name,
    l.phone_normalized,
    l.status,
    l.score,
    l.source,
    l.created_at,
    l.last_contact_at,
    COUNT(DISTINCT c.id) as conversation_count,
    COUNT(DISTINCT m.id) as message_count,
    MAX(m.created_at) as last_message_at
FROM leads l
LEFT JOIN conversations c ON c.lead_id = l.id
LEFT JOIN messages m ON m.conversation_id = c.id
GROUP BY l.id;

-- Vue des statistiques globales
CREATE OR REPLACE VIEW global_stats AS
SELECT
    (SELECT COUNT(*) FROM leads) as total_leads,
    (SELECT COUNT(*) FROM leads WHERE status = 'converted') as converted_leads,
    (SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '24 hours') as leads_today,
    (SELECT COUNT(*) FROM conversations WHERE is_active = true) as active_conversations,
    (SELECT COUNT(*) FROM messages) as total_messages,
    (SELECT COUNT(*) FROM messages WHERE ai_generated = true) as ai_messages;
