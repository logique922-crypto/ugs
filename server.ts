import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import mysql from 'mysql2/promise';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

let wss: WebSocketServer | null = null;
const wsClients = new Set<WebSocket>();

function broadcastWs(data: any) {
  const message = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error("Erreur d'envoi WebSocket:", err);
      }
    }
  }
}

// En-têtes de sécurité HTTP intégrés (équivalent Helmet sans dépendance externe pour compatibilité cPanel / Passenger)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

app.use(compression());
app.use(cors());

// Rate limiter sécurisé compatible reverse-proxy (cPanel, Nginx, Cloudflare, Passenger)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // limite de requêtes par IP
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.',
  validate: {
    xForwardedForHeader: false,
    trustProxy: false
  }
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// MYSQL DATABASE CONNECTION POOL & INIT
// ==========================================
let pool: mysql.Pool | null = null;

function getDbPool(): mysql.Pool {
  if (!pool) {
    const host = process.env.MYSQL_HOST || "localhost";
    const port = Number(process.env.MYSQL_PORT) || 3306;
    const user = process.env.MYSQL_USER || "root";
    const password = process.env.MYSQL_PASSWORD || "";
    const database = process.env.MYSQL_DATABASE || "ugs_db";

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 40,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      idleTimeout: 60000
    });
  }
  return pool;
}

// DEFAULT SEED DATA
const DEFAULT_PROJETS = [
  { 
    id: '1', 
    nom: 'SOCIETE UNIVERS GSM DE SUD', 
    entrepriseNom: 'SOCIETE UNIVERS GSM DE SUD',
    codeBoutique: 'DEPOT-CENTRAL', 
    adresse: '112, OMAR IBN KHATAB ZRIG, GABES S3', 
    ville: 'Gabès', 
    gouvernorat: 'Gabès', 
    telephone: '+216 75 655 555', 
    email: 'contact@univers-gsm.tn', 
    statut: 'Active', 
    description: 'SOCIETE UNIVERS GSM DE SUD — Siège & Dépôt Central Distribution', 
    dateCreation: '2023-01-15', 
    responsable: 'Direction Générale UGS',
    matriculeFiscal: '1532846 G/A/M/000',
    rib: '04 705 012 0051487155 82',
    banque: 'Attijari Bank',
    logoUrl: '/logo.png'
  },
  { 
    id: '2', 
    nom: 'Boutique Scolaire Plus', 
    entrepriseNom: 'SOCIETE UNIVERS GSM DE SUD',
    codeBoutique: 'SCOL-001', 
    adresse: '112, OMAR IBN KHATAB ZRIG, GABES S3', 
    ville: 'Gabès', 
    gouvernorat: 'Gabès', 
    telephone: '+216 75 655 555', 
    email: 'scolaire@univers-gsm.tn', 
    statut: 'Active', 
    description: 'Point de vente spécialisé distribution Scolaire & Fournitures', 
    dateCreation: '2023-06-20', 
    responsable: 'Sami Ben Ali',
    matriculeFiscal: '1532846 G/A/M/000',
    rib: '04 705 012 0051487155 82',
    banque: 'Attijari Bank',
    logoUrl: '/logo.png'
  },
  { 
    id: '3', 
    nom: 'Boutique Gabès', 
    entrepriseNom: 'SOCIETE UNIVERS GSM DE SUD',
    codeBoutique: 'GB-SUD-001', 
    adresse: '112, OMAR IBN KHATAB ZRIG, GABES S3', 
    ville: 'Gabès', 
    gouvernorat: 'Gabès', 
    telephone: '+216 75 655 555', 
    email: 'gabes@univers-gsm.tn', 
    statut: 'Active', 
    description: 'Succursale commerciale de distribution Sud', 
    dateCreation: '2022-11-05', 
    responsable: 'Fatma Zahra',
    matriculeFiscal: '1532846 G/A/M/000',
    rib: '04 705 012 0051487155 82',
    banque: 'Attijari Bank',
    logoUrl: '/logo.png'
  }
];

const DEFAULT_USERS = [
  { 
    id: 'demo-super-admin', 
    nom: 'Direction Générale UGS', 
    prenom: 'Super Admin',
    email: 'superadmin@erp-management.com', 
    telephone: '+216 75 655 555',
    motDePasse: 'demo123', 
    role: 'super_admin', 
    statut: 'Actif', 
    projetId: '1',
    dateCreation: '2023-01-15'
  },
  { 
    id: 'demo-admin', 
    nom: 'Mohamed Ali (Dépôt Central)', 
    prenom: 'Mohamed Ali',
    email: 'admin@erp-management.com', 
    telephone: '+216 75 655 556',
    motDePasse: 'demo123', 
    role: 'admin', 
    statut: 'Actif', 
    projetId: '1',
    dateCreation: '2023-01-20'
  },
  { 
    id: 'demo-comptable', 
    nom: 'Khadija Mansour', 
    prenom: 'Khadija',
    email: 'comptable@erp-management.com', 
    telephone: '+216 75 655 557',
    motDePasse: 'demo123', 
    role: 'comptable', 
    statut: 'Actif', 
    projetId: '1',
    dateCreation: '2023-03-10'
  },
  { 
    id: 'demo-caissier', 
    nom: 'Anis Ben Salah', 
    prenom: 'Anis',
    email: 'caissier@erp-management.com', 
    telephone: '+216 75 655 558',
    motDePasse: 'demo123', 
    role: 'caissier', 
    statut: 'Actif', 
    projetId: '2',
    dateCreation: '2023-05-12'
  }
];

// Initialize Database Schemas and Seed Defaults
async function initDatabaseAndSeed() {
  const host = process.env.MYSQL_HOST || "localhost";
  const port = Number(process.env.MYSQL_PORT) || 3306;
  const user = process.env.MYSQL_USER || "root";
  const password = process.env.MYSQL_PASSWORD || "";
  const database = process.env.MYSQL_DATABASE || "ugs_db";

  console.log(`⌛ [MySQL] Connexion & initialisation de la base de données (${database}@${host}:${port})...`);
  
  try {
    const rootConn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 5000
    });
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await rootConn.end();
  } catch (err: any) {
    console.warn(`⚠️ [MySQL] Impossible de vérifier/créer la base "${database}" : ${err.message}`);
  }

  const db = getDbPool();

  try {
    // Projets / Boutiques Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS projets (
        id VARCHAR(50) PRIMARY KEY,
        nom VARCHAR(150) NOT NULL,
        entrepriseNom VARCHAR(150) NOT NULL DEFAULT 'SOCIETE UNIVERS GSM DE SUD',
        codeBoutique VARCHAR(50) NOT NULL UNIQUE,
        adresse TEXT,
        ville VARCHAR(100),
        gouvernorat VARCHAR(100),
        telephone VARCHAR(30),
        email VARCHAR(150),
        statut VARCHAR(50) DEFAULT 'Active',
        description TEXT,
        dateCreation DATE,
        responsable VARCHAR(100),
        matriculeFiscal VARCHAR(50),
        rib VARCHAR(50),
        banque VARCHAR(100),
        logoUrl VARCHAR(255)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Utilisateurs Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS utilisateurs (
        id VARCHAR(50) PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        telephone VARCHAR(30),
        motDePasse VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'agent',
        statut VARCHAR(50) NOT NULL DEFAULT 'Actif',
        projetId VARCHAR(50),
        dateCreation DATETIME DEFAULT CURRENT_TIMESTAMP,
        derniereConnexion DATETIME
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Articles Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id VARCHAR(50) PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        codeBarre VARCHAR(100),
        designation VARCHAR(255) NOT NULL,
        categorie VARCHAR(100),
        typeArticle VARCHAR(50) DEFAULT 'Produit',
        prixAchatHT DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        prixVenteHT DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        tva DECIMAL(5, 2) NOT NULL DEFAULT 19.00,
        margePourcentage DECIMAL(5, 2) DEFAULT 0.00,
        stockGlobal INT NOT NULL DEFAULT 0,
        stockSecurite INT NOT NULL DEFAULT 5,
        unite VARCHAR(20) DEFAULT 'Pièce',
        dateCreation DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Article Stocks Table (Multi-Boutique linking)
    await db.query(`
      CREATE TABLE IF NOT EXISTS article_stocks (
        articleId VARCHAR(50) NOT NULL,
        projetId VARCHAR(50) NOT NULL,
        quantite INT NOT NULL DEFAULT 0,
        PRIMARY KEY (articleId, projetId),
        FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Clients Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id VARCHAR(50) PRIMARY KEY,
        code VARCHAR(50) UNIQUE,
        nom VARCHAR(150) NOT NULL,
        email VARCHAR(150),
        telephone VARCHAR(30),
        adresse TEXT,
        matriculeFiscal VARCHAR(50),
        soldeCredit DECIMAL(12, 3) DEFAULT 0.000,
        plafondCredit DECIMAL(12, 3) DEFAULT 1000.000,
        projetId VARCHAR(50),
        dateCreation DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Fournisseurs Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS fournisseurs (
        id VARCHAR(50) PRIMARY KEY,
        code VARCHAR(50) UNIQUE,
        nom VARCHAR(150) NOT NULL,
        email VARCHAR(150),
        telephone VARCHAR(30),
        adresse TEXT,
        matriculeFiscal VARCHAR(50),
        soldeDette DECIMAL(12, 3) DEFAULT 0.000,
        projetId VARCHAR(50) DEFAULT '1',
        typeTier VARCHAR(50) DEFAULT 'Entreprise',
        statut VARCHAR(50) DEFAULT 'Actif',
        categorie VARCHAR(100) DEFAULT 'Grossiste',
        ville VARCHAR(100) DEFAULT 'Tunis',
        codePostal VARCHAR(20),
        pays VARCHAR(50) DEFAULT 'Tunisie',
        siteWeb VARCHAR(255),
        contactNom VARCHAR(150),
        contactPoste VARCHAR(100),
        contactTel VARCHAR(50),
        contactEmail VARCHAR(150),
        delaiPaiement INT DEFAULT 30,
        plafondCredit DECIMAL(12, 3) DEFAULT 30000.000,
        modeReglementPrefere VARCHAR(50) DEFAULT 'Virement',
        rib VARCHAR(50),
        banque VARCHAR(100) DEFAULT 'BIAT',
        notes TEXT,
        evaluationQualite INT DEFAULT 5,
        data JSON,
        dateCreation DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ventes Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ventes (
        id VARCHAR(50) PRIMARY KEY,
        numero VARCHAR(50) NOT NULL UNIQUE,
        clientId VARCHAR(50),
        clientNom VARCHAR(150),
        projetId VARCHAR(50) NOT NULL DEFAULT '1',
        sessionId VARCHAR(50) NULL,
        caissierId VARCHAR(50),
        auteurNom VARCHAR(150),
        dateVente DATETIME DEFAULT CURRENT_TIMESTAMP,
        dateEcheance VARCHAR(50),
        totalHT DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        totalTVA DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        totalTTC DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        montantPaye DECIMAL(12, 3) DEFAULT 0.000,
        modePaiement VARCHAR(50) NOT NULL DEFAULT 'Espèces',
        statut VARCHAR(50) NOT NULL DEFAULT 'Payé',
        notes TEXT,
        data JSON
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Vente Lignes Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS vente_lignes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        venteId VARCHAR(50) NOT NULL,
        articleId VARCHAR(50) NOT NULL,
        designation VARCHAR(255) NOT NULL,
        quantite INT NOT NULL,
        prixUnitaireHT DECIMAL(12, 3) NOT NULL,
        tauxTVA DECIMAL(5, 2) NOT NULL,
        totalTTC DECIMAL(12, 3) NOT NULL,
        FOREIGN KEY (venteId) REFERENCES ventes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Achats Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS achats (
        id VARCHAR(50) PRIMARY KEY,
        numero VARCHAR(50) NOT NULL,
        projetId VARCHAR(50) NOT NULL DEFAULT '1',
        fournisseurId VARCHAR(50),
        fournisseurNom VARCHAR(150),
        dateAchat DATETIME DEFAULT CURRENT_TIMESTAMP,
        dateEcheance VARCHAR(50),
        totalHT DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        totalTTC DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        montantRegle DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        montantPaye DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        statut VARCHAR(50) NOT NULL DEFAULT 'Commandé',
        modePaiement VARCHAR(50) DEFAULT 'Virement',
        notes TEXT,
        data JSON,
        INDEX idx_achat_projet (projetId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Reglements Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS reglements (
        id VARCHAR(50) PRIMARY KEY,
        projetId VARCHAR(50) DEFAULT '1',
        sessionId VARCHAR(50) NULL,
        caissierId VARCHAR(50) NULL,
        numeroPiece VARCHAR(100),
        type VARCHAR(50) NOT NULL,
        tierId VARCHAR(50),
        tierNom VARCHAR(150),
        tierType VARCHAR(50),
        documentRef VARCHAR(100),
        dateReglement DATETIME DEFAULT CURRENT_TIMESTAMP,
        montant DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        modePaiement VARCHAR(50) NOT NULL DEFAULT 'Espèces',
        banque VARCHAR(100),
        referencePaiement VARCHAR(100),
        notes TEXT,
        statut VARCHAR(50) DEFAULT 'Validé',
        data JSON
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Logistique (BL, BA, BS) Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS documents_logistiques (
        id VARCHAR(50) PRIMARY KEY,
        typeDoc ENUM('BL', 'BA', 'BS') NOT NULL,
        numero VARCHAR(100) NOT NULL,
        projetId VARCHAR(50) DEFAULT '1',
        dateDoc DATETIME DEFAULT CURRENT_TIMESTAMP,
        statut VARCHAR(50) DEFAULT 'Validé',
        data JSON NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Mouvements Stock Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS mouvements_stock (
        id VARCHAR(50) PRIMARY KEY,
        dateMouvement DATETIME DEFAULT CURRENT_TIMESTAMP,
        articleId VARCHAR(50) NOT NULL,
        projetId VARCHAR(50) NOT NULL,
        typeMouvement ENUM('Entrée', 'Sortie', 'Ajustement', 'Transfert') NOT NULL,
        quantite INT NOT NULL,
        quantiteAvant INT NOT NULL,
        quantiteApres INT NOT NULL,
        motif VARCHAR(255),
        auteurId VARCHAR(50),
        FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Notifications Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(50) PRIMARY KEY,
        type VARCHAR(20) NOT NULL DEFAULT 'info',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        tab VARCHAR(50),
        categorie VARCHAR(50) NOT NULL DEFAULT 'Système',
        priorite VARCHAR(20) NOT NULL DEFAULT 'Moyenne',
        destinataireRole VARCHAR(50) DEFAULT 'tous',
        destinataireProjetId VARCHAR(50) DEFAULT 'tous',
        auteur VARCHAR(100),
        isLu BOOLEAN DEFAULT FALSE,
        dateCreation DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Categories Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        nom VARCHAR(150) NOT NULL UNIQUE,
        statut VARCHAR(20) NOT NULL DEFAULT 'Actif',
        dateCreation DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Sessions de Caisse Table (Persistance POS)
    await db.query(`
      CREATE TABLE IF NOT EXISTS sessions_caisse (
        id VARCHAR(50) PRIMARY KEY,
        projetId VARCHAR(50) NOT NULL DEFAULT '1',
        utilisateurId VARCHAR(50) NOT NULL,
        utilisateurNom VARCHAR(150),
        dateOuverture DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        dateFermeture DATETIME NULL,
        soldeInitial DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
        soldeFinalTheorique DECIMAL(12, 3) NULL,
        soldeFinalReel DECIMAL(12, 3) NULL,
        ecart DECIMAL(12, 3) NULL,
        statut VARCHAR(20) NOT NULL DEFAULT 'Ouverte',
        notes TEXT,
        data JSON
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Migration automatique d'anciennes sessions logistiques si existantes
    try {
      const [oldDocs] = await db.query("SELECT * FROM documents_logistiques WHERE id LIKE 'session-%'");
      for (const d of (oldDocs as any[])) {
        let p: any = {};
        try { if (d.data) p = typeof d.data === 'string' ? JSON.parse(d.data) : d.data; } catch (e) {}
        await db.query(`
          INSERT INTO sessions_caisse (id, projetId, utilisateurId, utilisateurNom, dateOuverture, dateFermeture, soldeInitial, soldeFinalTheorique, soldeFinalReel, ecart, statut, notes, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE id = id
        `, [
          d.id,
          p.projetId || d.projetId || '1',
          p.utilisateurId || '',
          p.utilisateurNom || '',
          p.dateOuverture ? new Date(p.dateOuverture) : new Date(d.dateDoc),
          p.dateFermeture ? new Date(p.dateFermeture) : null,
          Number(p.soldeInitial || 0),
          p.soldeFinalTheorique !== undefined ? Number(p.soldeFinalTheorique) : null,
          p.soldeFinalReel !== undefined ? Number(p.soldeFinalReel) : null,
          p.ecart !== undefined ? Number(p.ecart) : null,
          p.statut || 'Ouverte',
          p.notes || '',
          JSON.stringify(p)
        ]);
      }
    } catch (e) {
      // ignore
    }

    // Populate categories if empty
    const [catRows] = await db.query("SELECT COUNT(*) as count FROM categories");
    if ((catRows as any)[0].count === 0) {
      const initialCats = [
        { id: 'cat-1', nom: 'Informatique', statut: 'Actif' },
        { id: 'cat-2', nom: 'Téléphonie & Tablettes', statut: 'Actif' },
        { id: 'cat-3', nom: 'Réseau & Câblage', statut: 'Actif' },
        { id: 'cat-4', nom: 'Matériaux BTP', statut: 'Actif' },
        { id: 'cat-5', nom: 'Outillage & Quincaillerie', statut: 'Actif' },
        { id: 'cat-6', nom: 'Électricité', statut: 'Actif' },
        { id: 'cat-7', nom: 'Bureautique & Papeterie', statut: 'Actif' },
        { id: 'cat-8', nom: 'Services & Prestations', statut: 'Actif' }
      ];
      for (const cat of initialCats) {
        await db.query("INSERT INTO categories (id, nom, statut) VALUES (?, ?, ?)", [cat.id, cat.nom, cat.statut]);
      }
    }

    // 🚀 === MIGRATIONS DYNAMIQUES DE COLONNES ET INDEXATION === 🚀
    const addColumnSafely = async (table: string, column: string, definition: string) => {
      try {
        await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`⚡ [Migration] Colonne '${column}' ajoutée avec succès sur '${table}'.`);
      } catch (e: any) {
        if (e.code !== 'ER_DUP_FIELDNAME' && !e.message?.includes('Duplicate column')) {
          // ignore already existing column
        }
      }
    };

    await addColumnSafely('ventes', 'sessionId', 'VARCHAR(50) NULL');
    await addColumnSafely('reglements', 'sessionId', 'VARCHAR(50) NULL');
    await addColumnSafely('reglements', 'caissierId', 'VARCHAR(50) NULL');
    await addColumnSafely('reglements', 'data', 'JSON NULL');

    // 🚀 === OPTIMISATION DES PERFORMANCES (INDEXATION DYNAMIQUE) === 🚀
    // Création d'index sur les colonnes les plus filtrées pour des recherches 10x à 100x plus rapides.
    const addIndexSafely = async (table: string, indexName: string, columns: string) => {
      try {
        await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`);
        console.log(`⚡ [Optimisation] Index de performance '${indexName}' créé sur la table '${table}'.`);
      } catch(e: any) {
        if (e.code !== 'ER_DUP_KEYNAME') {
          console.warn(`⚠️ Impossible d'ajouter l'index ${indexName} sur ${table}: ${e.message}`);
        }
      }
    };

    await addIndexSafely('ventes', 'idx_ventes_projet', 'projetId');
    await addIndexSafely('ventes', 'idx_ventes_date', 'dateVente');
    await addIndexSafely('ventes', 'idx_ventes_client', 'clientId');
    await addIndexSafely('ventes', 'idx_ventes_session', 'sessionId');
    await addIndexSafely('achats', 'idx_achats_projet', 'projetId');
    await addIndexSafely('achats', 'idx_achats_date', 'dateAchat');
    await addIndexSafely('reglements', 'idx_reglements_projet', 'projetId');
    await addIndexSafely('reglements', 'idx_reglements_date', 'dateReglement');
    await addIndexSafely('reglements', 'idx_reglements_session', 'sessionId');
    await addIndexSafely('mouvements_stock', 'idx_mvt_article', 'articleId');
    await addIndexSafely('mouvements_stock', 'idx_mvt_projet', 'projetId');
    await addIndexSafely('mouvements_stock', 'idx_mvt_date', 'dateMouvement');
    await addIndexSafely('mouvements_stock', 'idx_mvt_type', 'typeMouvement');
    await addIndexSafely('articles', 'idx_articles_categorie', 'categorie');
    await addIndexSafely('articles', 'idx_articles_codebarre', 'codeBarre');
    await addIndexSafely('documents_logistiques', 'idx_docs_projet', 'projetId');
    await addIndexSafely('documents_logistiques', 'idx_docs_type_date', 'typeDoc, dateDoc');
    await addIndexSafely('clients', 'idx_clients_projet', 'projetId');
    await addIndexSafely('fournisseurs', 'idx_frn_projet', 'projetId');
    await addIndexSafely('vente_lignes', 'idx_vl_article', 'articleId');
    await addIndexSafely('notifications', 'idx_notif_date_dest', 'dateCreation, destinataireProjetId');
    await addIndexSafely('sessions_caisse', 'idx_sess_projet', 'projetId');
    await addIndexSafely('sessions_caisse', 'idx_sess_user', 'utilisateurId');
    await addIndexSafely('sessions_caisse', 'idx_sess_statut', 'statut');
    
    console.log("✅ [MySQL] Base de données, schémas et index initialisés avec succès.");
  } catch (err: any) {
    console.error("❌ [MySQL] Erreur d'initialisation de la base :", err);
  }
}

// Test Connection Helper
async function testDbConnection() {
  try {
    const db = getDbPool();
    await db.query("SELECT 1 as connected");
    return { success: true, message: "Connexion MySQL réussie !" };
  } catch (err: any) {
    return { success: false, message: `Échec de connexion : ${err.message}` };
  }
}

// ==========================================
// DB LOAD AND SYNC CONTROLLERS
// ==========================================
async function getInitialData() {
  const db = getDbPool();
  try {
    const [
      [projetsRows],
      [stockRows],
      [articlesRows],
      [clientsRows],
      [fournisseursRows],
      [utilisateursRows],
      [mouvementsRows],
      [ventesRows],
      [achatsRows],
      [reglementsRows],
      [docRows],
      [sessRows],
      [auditRows],
      [categoriesRows]
    ] = await Promise.all([
      db.query("SELECT * FROM projets ORDER BY id ASC"),
      db.query("SELECT articleId, projetId, quantite FROM article_stocks"),
      db.query("SELECT * FROM articles ORDER BY designation ASC"),
      db.query("SELECT * FROM clients ORDER BY nom ASC"),
      db.query("SELECT * FROM fournisseurs ORDER BY nom ASC"),
      db.query("SELECT * FROM utilisateurs ORDER BY nom ASC"),
      db.query(`
        SELECT m.*, a.designation as articleNom, a.code as articleCode, p.nom as projetNom 
        FROM mouvements_stock m 
        LEFT JOIN articles a ON m.articleId = a.id 
        LEFT JOIN projets p ON m.projetId = p.id 
        ORDER BY m.dateMouvement DESC
        LIMIT 3000
      `),
      db.query("SELECT * FROM ventes ORDER BY dateVente DESC LIMIT 2000"),
      db.query(`
        SELECT a.*, f.nom as fournisseurNomJoint 
        FROM achats a 
        LEFT JOIN fournisseurs f ON a.fournisseurId = f.id 
        ORDER BY a.dateAchat DESC
        LIMIT 2000
      `),
      db.query("SELECT * FROM reglements ORDER BY dateReglement DESC LIMIT 2000"),
      db.query("SELECT * FROM documents_logistiques ORDER BY dateDoc DESC LIMIT 2000"),
      db.query("SELECT * FROM sessions_caisse ORDER BY dateOuverture DESC LIMIT 500"),
      db.query("SELECT * FROM notifications ORDER BY dateCreation DESC LIMIT 100"),
      db.query("SELECT * FROM categories ORDER BY nom ASC")
    ]);
    
    const stocksMap: Record<string, Record<string, number>> = {};
    for (const s of (stockRows as any[])) {
      if (!stocksMap[s.articleId]) stocksMap[s.articleId] = {};
      stocksMap[s.articleId][s.projetId] = Number(s.quantite);
    }

    const articles = (articlesRows as any[]).map((r) => {
      const artStocks: Record<string, number> = stocksMap[r.id] ? { ...stocksMap[r.id] } : {};
      if (artStocks['1'] === undefined) {
        artStocks['1'] = Number(r.stockGlobal) || 0;
      }
      return {
        id: r.id,
        projetId: "1",
        code: r.code,
        referenceInterne: r.code,
        codeBarres: r.codeBarre ? [r.codeBarre] : [],
        designation: r.designation,
        famille: r.categorie || "Général",
        categorie: r.categorie || "Général",
        typeArticle: r.typeArticle || "Produit",
        prixAchatHT: Number(r.prixAchatHT) || 0,
        prixVenteHT: Number(r.prixVenteHT) || 0,
        tva: Number(r.tva) || 19,
        margeBeneficiaire: Number(r.margePourcentage) || 0,
        stock: Number(r.stockGlobal) || 0,
        stockGlobal: Number(r.stockGlobal) || 0,
        stockMinimum: Number(r.stockSecurite) || 5,
        stockSecurite: Number(r.stockSecurite) || 5,
        uniteMesure: r.unite || "Pièce",
        statut: "Actif",
        stocks: artStocks,
        stockMinimums: { "1": 5, "2": 2, "3": 2 }
      };
    });

    const clients = (clientsRows as any[]).map((r) => ({
      id: r.id,
      code: r.code,
      nom: r.nom,
      email: r.email || "",
      telephone: r.telephone || "",
      adresse: r.adresse || "",
      matriculeFiscal: r.matriculeFiscal || "",
      soldeCredit: Number(r.soldeCredit) || 0,
      soldeInitial: Number(r.soldeCredit) || 0,
      plafondCredit: Number(r.plafondCredit) || 1000,
      projetId: r.projetId || "1",
      statut: "Actif",
      typeTier: "Entreprise",
      scoreSolvabilite: 85
    }));

    const fournisseurs = (fournisseursRows as any[]).map((r) => {
      let parsed: any = {};
      try {
        if (r.data) parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      } catch (e) {}
      return {
        id: r.id,
        code: r.code,
        nom: r.nom,
        email: r.email || "",
        telephone: r.telephone || "",
        adresse: r.adresse || "",
        matriculeFiscal: r.matriculeFiscal || "",
        soldeDette: Number(r.soldeDette) || 0,
        statut: r.statut || parsed.statut || "Actif",
        typeTier: r.typeTier || parsed.typeTier || "Entreprise",
        categorie: r.categorie || parsed.categorie || "Grossiste",
        projetId: r.projetId || parsed.projetId || "1",
        ville: r.ville || parsed.ville || "Tunis",
        codePostal: r.codePostal || parsed.codePostal || "",
        pays: r.pays || parsed.pays || "Tunisie",
        siteWeb: r.siteWeb || parsed.siteWeb || "",
        contactNom: r.contactNom || parsed.contactNom || "",
        contactPoste: r.contactPoste || parsed.contactPoste || "",
        contactTel: r.contactTel || parsed.contactTel || "",
        contactEmail: r.contactEmail || parsed.contactEmail || "",
        delaiPaiement: Number(r.delaiPaiement ?? parsed.delaiPaiement ?? 30),
        plafondCredit: Number(r.plafondCredit ?? parsed.plafondCredit ?? 30000),
        modeReglementPrefere: r.modeReglementPrefere || parsed.modeReglementPrefere || "Virement",
        rib: r.rib || parsed.rib || "",
        banque: r.banque || parsed.banque || "BIAT",
        notes: r.notes || parsed.notes || "",
        evaluationQualite: Number(r.evaluationQualite ?? parsed.evaluationQualite ?? 5),
        ...parsed
      };
    });

    const utilisateurs = (utilisateursRows as any[]).map((r) => ({
      id: r.id,
      nom: r.nom,
      prenom: r.prenom,
      email: r.email,
      telephone: r.telephone,
      motDePasse: r.motDePasse,
      role: r.role,
      statut: r.statut,
      projetId: r.projetId,
      projetsAffectes: r.projetId ? [r.projetId] : ["1", "2", "3"],
      dateCreation: r.dateCreation ? new Date(r.dateCreation).toISOString().split("T")[0] : "",
      derniereConnexion: r.derniereConnexion ? new Date(r.derniereConnexion).toISOString().replace("T", " ").slice(0, 16) : "",
      permissions: {
        peutAccorderRemise: ["super_admin", "admin", "chef_projet", "caissier"].includes(r.role),
        peutModifierPrix: ["super_admin", "admin"].includes(r.role),
        peutSupprimerDocuments: r.role === "super_admin",
        peutVoirMarge: ["super_admin", "admin", "comptable"].includes(r.role),
        peutCloturerCaisse: r.role !== "agent"
      }
    }));

    const mouvements = (mouvementsRows as any[]).map((r) => ({
      id: r.id,
      date: r.dateMouvement ? new Date(r.dateMouvement).toISOString().replace("T", " ").slice(0, 16) : "",
      dateFormatted: r.dateMouvement ? new Date(r.dateMouvement).toLocaleDateString("fr-FR") : "",
      articleId: r.articleId,
      articleNom: r.articleNom || "",
      articleCode: r.articleCode || "",
      designation: r.articleNom || "",
      projetId: r.projetId,
      projetNom: r.projetNom || "",
      boutiqueNom: r.projetNom || "",
      type: r.typeMouvement,
      quantite: Number(r.quantite) || 0,
      quantiteAvant: Number(r.quantiteAvant) || 0,
      quantiteApres: Number(r.quantiteApres) || 0,
      motif: r.motif || "",
      auteur: r.auteurId || "Système",
      utilisateurNom: r.auteurId || "Système"
    }));

    let ventes: any[] = [];
    try {
      const venteIds = (ventesRows as any[]).map((v) => v.id);
      let lignesRows: any[] = [];
      if (venteIds.length > 0) {
        const [rows] = await db.query(
          "SELECT * FROM vente_lignes WHERE venteId IN (?)",
          [venteIds]
        );
        lignesRows = rows as any[];
      }
      
      const lignesByVente: Record<string, any[]> = {};
      for (const l of lignesRows) {
        if (!lignesByVente[l.venteId]) lignesByVente[l.venteId] = [];
        lignesByVente[l.venteId].push({
          id: String(l.id),
          articleId: l.articleId,
          designation: l.designation,
          quantite: Number(l.quantite),
          prixUnitaireHT: Number(l.prixUnitaireHT),
          tva: Number(l.tauxTVA),
          tauxTVA: Number(l.tauxTVA),
          totalHT: Number(l.prixUnitaireHT) * Number(l.quantite),
          totalTTC: Number(l.totalTTC)
        });
      }

      ventes = (ventesRows as any[]).map((r) => {
        let parsedData: any = {};
        try {
          if (r.data) parsedData = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        } catch (e) {}
        const dateVenteStr = r.dateVente ? new Date(r.dateVente).toISOString() : (parsedData.dateVente || parsedData.date || "");
        return {
          ...parsedData,
          id: r.id,
          numero: r.numero,
          sessionId: parsedData.sessionId || r.sessionId || null,
          clientId: r.clientId,
          clientNom: r.clientNom || parsedData.clientNom || "Client Comptoir",
          projetId: r.projetId || "1",
          auteurId: r.caissierId,
          auteurNom: r.auteurNom || parsedData.auteurNom || "Caissier",
          date: r.dateVente ? new Date(r.dateVente).toISOString().split("T")[0] : (parsedData.date || ""),
          dateVente: dateVenteStr,
          dateEcheance: r.dateEcheance || parsedData.dateEcheance || "",
          montantHT: Number(r.totalHT) || 0,
          montantTTC: Number(r.totalTTC) || 0,
          montantPaye: Number(r.montantPaye ?? r.totalTTC) || 0,
          modePaiement: r.modePaiement || "Espèces",
          statut: r.statut || "Payé",
          notes: r.notes || "",
          lignes: lignesByVente[r.id] && lignesByVente[r.id].length > 0 ? lignesByVente[r.id] : parsedData.lignes || []
        };
      });
    } catch (err) {
      console.warn("Erreur lecture ventes:", err);
    }

    let achats: any[] = [];
    try {
      achats = (achatsRows as any[]).map((r) => {
        let parsedData: any = {};
        try {
          if (r.data) parsedData = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        } catch (e) {}
        return {
          ...parsedData,
          id: r.id,
          numero: r.numero,
          projetId: r.projetId || "1",
          fournisseurId: r.fournisseurId,
          fournisseurNom: r.fournisseurNom || r.fournisseurNomJoint || parsedData.fournisseurNom || "Fournisseur",
          date: r.dateAchat ? new Date(r.dateAchat).toISOString().split("T")[0] : "",
          dateEcheance: r.dateEcheance || parsedData.dateEcheance || "",
          montantHT: Number(r.totalHT) || 0,
          montantTTC: Number(r.totalTTC) || 0,
          montantRegle: Number(r.montantRegle) || 0,
          montantPaye: Number(r.montantPaye) || 0,
          statut: r.statut || "Commandé",
          modePaiement: r.modePaiement || "Virement",
          notes: r.notes || "",
          lignes: parsedData.lignes || []
        };
      });
    } catch (err) {
      console.warn("Erreur lecture achats:", err);
    }

    let reglements: any[] = [];
    try {
      reglements = (reglementsRows as any[]).map((r) => {
        let parsedData: any = {};
        try {
          if (r.data) parsedData = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        } catch (e) {}
        return {
          ...parsedData,
          id: r.id,
          projetId: r.projetId || "1",
          sessionId: r.sessionId || parsedData.sessionId || null,
          caissierId: r.caissierId || parsedData.caissierId || null,
          numeroPiece: r.numeroPiece,
          type: r.type,
          tierId: r.tierId,
          tierNom: r.tierNom || "Tiers",
          tierType: r.tierType || "Client",
          documentRef: r.documentRef || "",
          date: r.dateReglement ? new Date(r.dateReglement).toISOString().split("T")[0] : (parsedData.date || ""),
          dateReglement: r.dateReglement ? new Date(r.dateReglement).toISOString() : (parsedData.dateReglement || undefined),
          montant: Number(r.montant) || 0,
          modePaiement: r.modePaiement || "Espèces",
          banque: r.banque || "",
          referencePaiement: r.referencePaiement || "",
          notes: r.notes || "",
          statut: r.statut || "Validé"
        };
      });
    } catch (err) {
      console.warn("Erreur lecture reglements:", err);
    }

    let bonsDeLivraison: any[] = [];
    let bonsDAchat: any[] = [];
    let bonsDeSortie: any[] = [];
    try {
      for (const d of (docRows as any[])) {
        let docData: any = {};
        try {
          docData = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
        } catch (e) {}
        const item = { id: d.id, numero: d.numero, projetId: d.projetId, statut: d.statut, ...docData };
        if (d.typeDoc === "BL") bonsDeLivraison.push(item);
        else if (d.typeDoc === "BA") bonsDAchat.push(item);
        else if (d.typeDoc === "BS" && !d.id.startsWith("session-")) bonsDeSortie.push(item);
      }
    } catch (err) {
      console.warn("Erreur lecture documents_logistiques:", err);
    }

    let sessionsCaisse: any[] = [];
    try {
      const parseSafeIsoDate = (d: any) => {
        if (!d) return undefined;
        if (d === '0000-00-00 00:00:00' || d === '0000-00-00' || d === 'null' || d === '') return undefined;
        try {
          const dt = new Date(d);
          return !isNaN(dt.getTime()) && dt.getFullYear() >= 2020 ? dt.toISOString() : undefined;
        } catch {
          return undefined;
        }
      };

      sessionsCaisse = (sessRows as any[]).map(r => {
        let parsedData: any = {};
        try {
          if (r.data) parsedData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        } catch (e) {}

        const parsedDateFermeture = parseSafeIsoDate(r.dateFermeture) || parseSafeIsoDate(parsedData.dateFermeture);
        const hasValidCloseDate = Boolean(parsedDateFermeture);
        const isFermee = r.statut === 'Fermee' || hasValidCloseDate;
        const resolvedStatut = isFermee ? 'Fermee' : 'Ouverte';
        const parsedDateOuverture = parseSafeIsoDate(r.dateOuverture) || parseSafeIsoDate(parsedData.dateOuverture) || new Date().toISOString();

        return {
          ...parsedData,
          id: r.id,
          projetId: r.projetId || '1',
          utilisateurId: r.utilisateurId,
          utilisateurNom: r.utilisateurNom,
          dateOuverture: parsedDateOuverture,
          dateFermeture: parsedDateFermeture,
          soldeInitial: Number(r.soldeInitial) || 0,
          soldeFinalTheorique: r.soldeFinalTheorique !== null && r.soldeFinalTheorique !== undefined ? Number(r.soldeFinalTheorique) : parsedData.soldeFinalTheorique,
          soldeFinalReel: r.soldeFinalReel !== null && r.soldeFinalReel !== undefined ? Number(r.soldeFinalReel) : parsedData.soldeFinalReel,
          ecart: r.ecart !== null && r.ecart !== undefined ? Number(r.ecart) : parsedData.ecart,
          statut: resolvedStatut,
          notes: r.notes || parsedData.notes || ''
        };
      });
    } catch (err) {
      console.warn("Erreur lecture sessions_caisse:", err);
    }

    const auditLogs = (auditRows as any[]).map(r => ({
      id: r.id,
      timestamp: r.dateCreation ? new Date(r.dateCreation).toLocaleString('fr-FR') : '',
      utilisateurNom: r.auteur || 'Admin',
      utilisateurEmail: 'admin@erp-management.com',
      projetId: r.destinataireProjetId || '1',
      action: r.title,
      categorie: r.categorie || 'Système',
      nouvelleValeur: r.message
    }));

    const categories = (categoriesRows as any[]).map(r => ({
      id: r.id,
      nom: r.nom,
      statut: r.statut || 'Actif'
    }));

    return {
      success: true,
      data: {
        projets: projetsRows,
        articles,
        clients,
        fournisseurs,
        utilisateurs,
        mouvements,
        ventes,
        achats,
        reglements,
        bonsDeLivraison,
        bonsDAchat,
        bonsDeSortie,
        sessionsCaisse,
        auditLogs,
        categories
      }
    };
  } catch (err: any) {
    console.error("Erreur getInitialData depuis MySQL:", err);
    return { success: false, error: err.message, data: null };
  }
}

// Single Entity Save Helper Tasks
async function saveArticleToDb(article: any) {
  const db = getDbPool();
  const id = article.id || `art-${Date.now()}`;
  const code = article.code || `ART-${Math.floor(Math.random() * 100000)}`;
  const codeBarre = Array.isArray(article.codeBarres) && article.codeBarres.length > 0 ? article.codeBarres[0] : article.codeBarre || null;
  const designation = article.designation || "Article sans nom";
  const categorie = article.categorie || article.famille || "Général";
  const typeArticle = article.typeArticle === "Service" ? "Service" : "Produit";
  const prixAchatHT = Number(article.prixAchatHT) || 0;
  const prixVenteHT = Number(article.prixVenteHT) || 0;
  const tva = Number(article.tva) || 19;
  const margePourcentage = Number(article.margeBeneficiaire) || 0;
  const stockGlobal = Number(article.stockGlobal ?? article.stock ?? 0);
  const stockSecurite = Number(article.stockSecurite ?? article.stockMinimum ?? 5);
  const unite = article.uniteMesure || article.unite || "Pièce";

  await db.query(`
    INSERT INTO articles (id, code, codeBarre, designation, categorie, typeArticle, prixAchatHT, prixVenteHT, tva, margePourcentage, stockGlobal, stockSecurite, unite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      code = VALUES(code),
      codeBarre = VALUES(codeBarre),
      designation = VALUES(designation),
      categorie = VALUES(categorie),
      typeArticle = VALUES(typeArticle),
      prixAchatHT = VALUES(prixAchatHT),
      prixVenteHT = VALUES(prixVenteHT),
      tva = VALUES(tva),
      margePourcentage = VALUES(margePourcentage),
      stockGlobal = VALUES(stockGlobal),
      stockSecurite = VALUES(stockSecurite),
      unite = VALUES(unite)
  `, [id, code, codeBarre, designation, categorie, typeArticle, prixAchatHT, prixVenteHT, tva, margePourcentage, stockGlobal, stockSecurite, unite]);

  if (article.stocks && typeof article.stocks === "object") {
    for (const [projetId, quantite] of Object.entries(article.stocks)) {
      await db.query(`
        INSERT INTO article_stocks (articleId, projetId, quantite)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantite = VALUES(quantite)
      `, [id, String(projetId), Number(quantite) || 0]);
    }
  }

  // Recalculer le stock physique global exact à partir des stocks par boutique
  const [stRows] = await db.query("SELECT projetId, quantite FROM article_stocks WHERE articleId = ?", [id]);
  const stocksMap: Record<string, number> = {};
  let totalStock = 0;
  if ((stRows as any[]).length > 0) {
    for (const s of (stRows as any[])) {
      stocksMap[s.projetId] = Number(s.quantite);
      totalStock += Number(s.quantite);
    }
  } else {
    totalStock = stockGlobal;
    stocksMap['1'] = stockGlobal;
    await db.query(`
      INSERT INTO article_stocks (articleId, projetId, quantite)
      VALUES (?, '1', ?)
      ON DUPLICATE KEY UPDATE quantite = VALUES(quantite)
    `, [id, totalStock]);
  }

  await db.query("UPDATE articles SET stockGlobal = ? WHERE id = ?", [totalStock, id]);

  broadcastWs({
    type: 'stock_change',
    payload: { articleId: id, stockGlobal: totalStock, stocks: stocksMap }
  });

  return { success: true, id };
}

async function saveClientToDb(client: any) {
  const db = getDbPool();
  const id = client.id || `cli-${Date.now()}`;
  const code = client.code || `CLI-${Math.floor(Math.random() * 10000)}`;
  const nom = client.nom || "Client sans nom";
  const email = client.email || null;
  const telephone = client.telephone || null;
  const adresse = client.adresse || null;
  const matriculeFiscal = client.matriculeFiscal || null;
  const soldeCredit = Number(client.soldeCredit ?? client.soldeInitial ?? 0);
  const plafondCredit = Number(client.plafondCredit ?? 1000);
  const projetId = client.projetId || "1";

  await db.query(`
    INSERT INTO clients (id, code, nom, email, telephone, adresse, matriculeFiscal, soldeCredit, plafondCredit, projetId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      code = VALUES(code),
      nom = VALUES(nom),
      email = VALUES(email),
      telephone = VALUES(telephone),
      adresse = VALUES(adresse),
      matriculeFiscal = VALUES(matriculeFiscal),
      soldeCredit = VALUES(soldeCredit),
      plafondCredit = VALUES(plafondCredit),
      projetId = VALUES(projetId)
  `, [id, code, nom, email, telephone, adresse, matriculeFiscal, soldeCredit, plafondCredit, projetId]);
  return { success: true, id };
}

async function saveFournisseurToDb(fournisseur: any) {
  const db = getDbPool();
  const id = fournisseur.id || `frn-${Date.now()}`;
  const code = fournisseur.code || `FRN-${Math.floor(Math.random() * 10000)}`;
  const nom = fournisseur.nom || "Fournisseur sans nom";
  const email = fournisseur.email || null;
  const telephone = fournisseur.telephone || null;
  const adresse = fournisseur.adresse || null;
  const matriculeFiscal = fournisseur.matriculeFiscal || null;
  const soldeDette = Number(fournisseur.soldeDette ?? 0);
  const projetId = fournisseur.projetId || "1";
  const typeTier = fournisseur.typeTier || "Entreprise";
  const statut = fournisseur.statut || "Actif";
  const categorie = fournisseur.categorie || "Grossiste";
  const ville = fournisseur.ville || "Tunis";
  const codePostal = fournisseur.codePostal || null;
  const pays = fournisseur.pays || "Tunisie";
  const siteWeb = fournisseur.siteWeb || null;
  const contactNom = fournisseur.contactNom || null;
  const contactPoste = fournisseur.contactPoste || null;
  const contactTel = fournisseur.contactTel || null;
  const contactEmail = fournisseur.contactEmail || null;
  const delaiPaiement = Number(fournisseur.delaiPaiement) || 30;
  const plafondCredit = Number(fournisseur.plafondCredit) || 30000;
  const modeReglementPrefere = fournisseur.modeReglementPrefere || "Virement";
  const rib = fournisseur.rib || null;
  const banque = fournisseur.banque || "BIAT";
  const notes = fournisseur.notes || "";
  const evaluationQualite = Number(fournisseur.evaluationQualite) || 5;
  const dataJson = JSON.stringify(fournisseur);

  await db.query(`
    INSERT INTO fournisseurs (
      id, code, nom, email, telephone, adresse, matriculeFiscal, soldeDette,
      projetId, typeTier, statut, categorie, ville, codePostal, pays, siteWeb,
      contactNom, contactPoste, contactTel, contactEmail, delaiPaiement, plafondCredit,
      modeReglementPrefere, rib, banque, notes, evaluationQualite, data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      code = VALUES(code),
      nom = VALUES(nom),
      email = VALUES(email),
      telephone = VALUES(telephone),
      adresse = VALUES(adresse),
      matriculeFiscal = VALUES(matriculeFiscal),
      soldeDette = VALUES(soldeDette),
      projetId = VALUES(projetId),
      typeTier = VALUES(typeTier),
      statut = VALUES(statut),
      categorie = VALUES(categorie),
      ville = VALUES(ville),
      codePostal = VALUES(codePostal),
      pays = VALUES(pays),
      siteWeb = VALUES(siteWeb),
      contactNom = VALUES(contactNom),
      contactPoste = VALUES(contactPoste),
      contactTel = VALUES(contactTel),
      contactEmail = VALUES(contactEmail),
      delaiPaiement = VALUES(delaiPaiement),
      plafondCredit = VALUES(plafondCredit),
      modeReglementPrefere = VALUES(modeReglementPrefere),
      rib = VALUES(rib),
      banque = VALUES(banque),
      notes = VALUES(notes),
      evaluationQualite = VALUES(evaluationQualite),
      data = VALUES(data)
  `, [id, code, nom, email, telephone, adresse, matriculeFiscal, soldeDette, projetId, typeTier, statut, categorie, ville, codePostal, pays, siteWeb, contactNom, contactPoste, contactTel, contactEmail, delaiPaiement, plafondCredit, modeReglementPrefere, rib, banque, notes, evaluationQualite, dataJson]);
  return { success: true, id };
}

async function saveVenteToDb(vente: any) {
  const db = getDbPool();
  const conn = await db.getConnection();
  let id = vente.id || `vte-${Date.now()}`;
  let numero = vente.numero || `FAC-${Date.now()}`;
  const clientId = vente.clientId || null;
  const clientNom = vente.clientNom || null;
  const projetId = vente.projetId || "1";
  const caissierId = vente.auteurId || null;
  const auteurNom = vente.auteurNom || null;
  const sessionId = vente.sessionId || null;
  const dateEcheance = vente.dateEcheance || null;
  const totalHT = Number(vente.montantHT || vente.totalHT || 0);
  const totalTTC = Number(vente.montantTTC || vente.totalTTC || totalHT);
  const totalTVA = Number(totalTTC - totalHT);
  const montantPaye = Number(vente.montantPaye ?? totalTTC);
  const modePaiement = vente.modePaiement || "Espèces";
  const statut = vente.statut || "Payé";
  const notes = vente.notes || "";

  try {
    await conn.beginTransaction();

    // 1. Résolution de l'ID pour garantir l'intégrité référentielle absolue de la clé étrangère vente_lignes(venteId)
    // On vérifie si une vente existe déjà avec ce même ID ou avec ce même NUMÉRO
    const [existingById] = await conn.query(
      "SELECT id, numero FROM ventes WHERE id = ? LIMIT 1",
      [id]
    );
    const [existingByNum] = await conn.query(
      "SELECT id, numero FROM ventes WHERE numero = ? LIMIT 1",
      [numero]
    );

    const matchById = Array.isArray(existingById) && existingById.length > 0 ? (existingById[0] as any) : null;
    const matchByNum = Array.isArray(existingByNum) && existingByNum.length > 0 ? (existingByNum[0] as any) : null;

    // Vente déjà existante (même ID) => simple mise à jour, AUCUNE nouvelle déduction de stock.
    const isNewSale = !matchById;

    if (matchById) {
      // 1. Vente existante : mise à jour explicite SANS écraser une autre vente
      const dataJson = JSON.stringify({ ...vente, id, numero: matchById.numero || numero, sessionId: sessionId || matchById.sessionId });
      await conn.query(`
        UPDATE ventes SET 
          clientId = ?,
          clientNom = ?,
          projetId = ?,
          sessionId = COALESCE(?, sessionId),
          caissierId = ?,
          auteurNom = ?,
          dateEcheance = ?,
          totalHT = ?,
          totalTVA = ?,
          totalTTC = ?,
          montantPaye = ?,
          modePaiement = ?,
          statut = ?,
          notes = ?,
          data = ?
        WHERE id = ?
      `, [clientId, clientNom, projetId, sessionId, caissierId, auteurNom, dateEcheance, totalHT, totalTVA, totalTTC, montantPaye, modePaiement, statut, notes, dataJson, id]);
    } else {
      // 2. Nouvelle vente : allocation stricte d'un numéro unique sans collision
      let allocatedNumero = numero;
      const year = vente.date ? new Date(vente.date).getFullYear() : new Date().getFullYear();
      const yearStr = isNaN(year) ? new Date().getFullYear().toString() : year.toString();

      for (let attempt = 0; attempt < 10; attempt++) {
        const [conflict] = await conn.query("SELECT id FROM ventes WHERE numero = ? LIMIT 1 FOR UPDATE", [allocatedNumero]);
        if (conflict && (conflict as any[]).length > 0) {
          const [maxSeqRows] = await conn.query(
            "SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) as maxSeq FROM ventes WHERE numero LIKE ? FOR UPDATE",
            [`FAC-${yearStr}-%`]
          );
          const nextSeq = (Number((maxSeqRows as any[])[0]?.maxSeq) || 0) + 1 + attempt;
          allocatedNumero = `FAC-${yearStr}-${nextSeq.toString().padStart(5, '0')}`;
        } else {
          break;
        }
      }
      numero = allocatedNumero;
      const dataJson = JSON.stringify({ ...vente, id, numero, sessionId });

      // Insertion physique garantie de la vente parente
      await conn.query(`
        INSERT INTO ventes (id, numero, clientId, clientNom, projetId, sessionId, caissierId, auteurNom, dateVente, dateEcheance, totalHT, totalTVA, totalTTC, montantPaye, modePaiement, statut, notes, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, numero, clientId, clientNom, projetId, sessionId, caissierId, auteurNom, dateEcheance, totalHT, totalTVA, totalTTC, montantPaye, modePaiement, statut, notes, dataJson]);
    }

    if (Array.isArray(vente.lignes) && vente.lignes.length > 0) {
      await conn.query("DELETE FROM vente_lignes WHERE venteId = ?", [id]);
      for (const l of vente.lignes) {
        if (!l.articleId) continue;
        const isServiceLine = l.typeArticle === 'Service';
        const qte = Number(l.quantite) || 1;
        const puHT = Number(l.prixUnitaireHT) || 0;
        const tva = Number(l.tauxTVA ?? l.tva ?? 19);
        const ttc = Number(l.totalTTC || puHT * qte * (1 + tva / 100));

        await conn.query(`
          INSERT INTO vente_lignes (venteId, articleId, designation, quantite, prixUnitaireHT, tauxTVA, totalTTC)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, l.articleId, l.designation || "Produit", qte, puHT, tva, ttc]);

        // Déduction de stock UNIQUEMENT à la première insertion de la vente, et uniquement pour les produits physiques
        if (!isNewSale || isServiceLine) continue;
        const [typeRows] = await conn.query("SELECT typeArticle FROM articles WHERE id = ? LIMIT 1", [l.articleId]);
        const dbType = (typeRows as any[])[0]?.typeArticle;
        if (!dbType || dbType === 'Service') continue;

        await conn.query(`
          INSERT INTO article_stocks (articleId, projetId, quantite)
          VALUES (?, ?, 0)
          ON DUPLICATE KEY UPDATE quantite = GREATEST(0, quantite - ?)
        `, [l.articleId, projetId, qte]);

        // Recalculate global stock across points of sale
        const [sumRows] = await conn.query(
          "SELECT SUM(quantite) as totalStock FROM article_stocks WHERE articleId = ?",
          [l.articleId]
        );
        const newGlobal = Number((sumRows as any[])[0]?.totalStock) || 0;

        await conn.query(`
          UPDATE articles 
          SET stockGlobal = ?
          WHERE id = ?
        `, [newGlobal, l.articleId]);
      }
    }

    await conn.commit();
  } catch (err: any) {
    await conn.rollback();
    console.error(`❌ [MySQL] Erreur transactionnelle saveVenteToDb (#${numero}):`, err.message);
    throw err;
  } finally {
    conn.release();
  }

  broadcastWs({
    type: 'new_order',
    payload: {
      id,
      numero,
      clientId,
      clientNom,
      projetId,
      montantHT: totalHT,
      montantTTC: totalTTC,
      montantPaye,
      statut,
      modePaiement,
      date: new Date().toISOString().split('T')[0],
      lignes: vente.lignes || []
    }
  });

  broadcastWs({
    type: 'notification',
    payload: {
      id: `notif-${Date.now()}`,
      title: '🛒 Nouvelle Commande',
      message: `Vente #${numero} (${totalTTC.toFixed(3)} DT) enregistrée.`,
      type: 'info',
      dateCreation: new Date().toISOString()
    }
  });

  return { success: true, id, numero };
}

// ==========================================
// ENCAISSEMENT CAISSE (POS) — TRANSACTION ATOMIQUE UNIQUE
// Vente + lignes + déduction stock + mouvements + règlement : tout ou rien.
// ==========================================
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const REMISE_ROLES = ['super_admin', 'admin', 'chef_projet', 'caissier'];
const POS_MODES = ['Espèces', 'Chèque', 'Virement', 'Traite', 'Carte Bancaire'];

async function encaisserVenteCaisse(body: any) {
  const lignesIn: any[] = Array.isArray(body?.lignes) ? body.lignes : [];
  const projetId = String(body?.projetId ?? '').trim();
  const auteurId = String(body?.auteurId ?? '').trim();
  const sessionId = body?.sessionId ? String(body.sessionId) : null;
  const modePaiement = POS_MODES.includes(body?.modePaiement) ? body.modePaiement : 'Espèces';
  const remisePct = Math.min(100, Math.max(0, Number(body?.remisePourcentage) || 0));

  if (!projetId || projetId === 'all') throw new HttpError(400, "Boutique (projet) non spécifiée pour l'encaissement.");
  if (!auteurId) throw new HttpError(400, 'Caissier non identifié.');
  if (lignesIn.length === 0) throw new HttpError(400, 'Le panier est vide.');

  const db = getDbPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Règle : caissier existant et actif
    const [uRows] = await conn.query('SELECT id, nom, prenom, role, statut FROM utilisateurs WHERE id = ? LIMIT 1', [auteurId]);
    const user = (uRows as any[])[0];
    if (!user) throw new HttpError(403, 'Utilisateur inconnu : encaissement refusé.');
    if (user.statut && !['Actif', 'Active'].includes(user.statut)) throw new HttpError(403, `Compte ${user.statut} : encaissement refusé.`);
    const auteurNom = String(body?.auteurNom || `${user.prenom || ''} ${user.nom || ''}`.trim() || 'Caissier');

    // Règle : remise uniquement pour les rôles autorisés
    if (remisePct > 0 && !REMISE_ROLES.includes(user.role)) {
      throw new HttpError(403, "Vous n'êtes pas autorisé à accorder une remise.");
    }

    // Règle : interdiction d'encaisser sur une session de caisse clôturée
    if (sessionId) {
      const [sRows] = await conn.query('SELECT statut, dateFermeture FROM sessions_caisse WHERE id = ? LIMIT 1', [sessionId]);
      const s = (sRows as any[])[0];
      if (s && (s.statut === 'Fermee' || s.dateFermeture)) {
        throw new HttpError(409, 'Cette session de caisse est clôturée. Veuillez ouvrir une nouvelle caisse.');
      }
    }

    const [pRows] = await conn.query('SELECT nom FROM projets WHERE id = ? LIMIT 1', [projetId]);
    const projetNom = (pRows as any[])[0]?.nom || '';

    // Fusion des lignes identiques
    const merged = new Map<string, any>();
    for (const l of lignesIn) {
      const articleId = String(l?.articleId ?? '').trim();
      const q = Math.floor(Number(l?.quantite));
      if (!articleId || !Number.isFinite(q) || q <= 0) throw new HttpError(400, 'Ligne de panier invalide (article ou quantité).');
      const prev = merged.get(articleId);
      if (prev) prev.quantite += q;
      else merged.set(articleId, { ...l, articleId, quantite: q });
    }

    const lignes: any[] = [];
    const stockOps: any[] = [];
    let totalHT = 0;
    let totalTVA = 0;

    for (const l of merged.values()) {
      const [aRows] = await conn.query(
        'SELECT id, code, designation, typeArticle, prixVenteHT, tva FROM articles WHERE id = ? LIMIT 1 FOR UPDATE',
        [l.articleId]
      );
      const art = (aRows as any[])[0];
      let isService: boolean;
      let pu: number;
      let tva: number;
      let designation: string;
      let code = '';

      if (art) {
        // Règle : prix NON modifiable — le prix officiel du catalogue fait foi
        isService = art.typeArticle === 'Service';
        pu = round3(Number(art.prixVenteHT) || 0);
        tva = Number(art.tva) || 19;
        designation = art.designation;
        code = art.code || '';
      } else if (l.typeArticle === 'Service') {
        // Prestations rapides (main d'œuvre, livraison) hors catalogue
        isService = true;
        pu = round3(Math.max(0, Number(l.prixUnitaireHT ?? l.prixVenteHT) || 0));
        tva = Number(l.tauxTVA ?? l.tva ?? 19);
        designation = String(l.designation || 'Prestation de service');
      } else {
        throw new HttpError(404, `Article introuvable dans le catalogue (${l.articleId}).`);
      }

      if (!isService) {
        // Règle : stock strict par boutique, verrouillé contre les ventes simultanées
        const [stRows] = await conn.query(
          'SELECT quantite FROM article_stocks WHERE articleId = ? AND projetId = ? LIMIT 1 FOR UPDATE',
          [l.articleId, projetId]
        );
        const avail = Number((stRows as any[])[0]?.quantite) || 0;
        if (avail <= 0) throw new HttpError(409, `Rupture de stock : "${designation}" (stock = 0) dans ${projetNom || 'cette boutique'}.`);
        if (l.quantite > avail) throw new HttpError(409, `Stock insuffisant pour "${designation}" : ${avail} disponible(s), ${l.quantite} demandé(s).`);
        stockOps.push({ articleId: l.articleId, designation, code, quantite: l.quantite, avant: avail, apres: avail - l.quantite });
      }

      const lineHT = round3(pu * l.quantite);
      const lineTVA = round3(lineHT * tva / 100);
      totalHT += lineHT;
      totalTVA += lineTVA;
      lignes.push({
        articleId: l.articleId,
        code,
        designation,
        quantite: l.quantite,
        prixUnitaireHT: pu,
        tauxTVA: tva,
        tva,
        remisePourcentage: 0,
        totalHT: lineHT,
        totalTTC: round3(lineHT + lineTVA),
        typeArticle: isService ? 'Service' : 'Produit'
      });
    }

    totalHT = round3(totalHT);
    totalTVA = round3(totalTVA);
    const baseTTC = round3(totalHT + totalTVA);
    const remiseMontant = round3(baseTTC * remisePct / 100);
    const totalTTC = round3(Math.max(0, baseTTC - remiseMontant));

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const venteId = `v-${uid}`;

    // Numérotation côté serveur (verrouillée) : FAC-YYYY-00001, sans collision possible
    const [seqRows] = await conn.query(
      "SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) AS maxSeq FROM ventes WHERE numero LIKE ? FOR UPDATE",
      [`FAC-${year}-%`]
    );
    let seq = (Number((seqRows as any[])[0]?.maxSeq) || 0) + 1;
    let numero = '';

    const venteObj: any = {
      id: venteId,
      projetId,
      clientId: 'cli-passage',
      clientNom: 'Client Passager',
      auteurId,
      auteurNom,
      sessionId,
      date: today,
      dateEcheance: today,
      montantHT: totalHT,
      montantTVA: totalTVA,
      montantTTC: totalTTC,
      montantPaye: totalTTC,
      statut: 'Payée',
      modePaiement,
      timbreFiscal: 0,
      remisePourcentage: remisePct,
      remiseGlobalTTC: remiseMontant,
      origine: 'Caisse',
      notes: 'Vente directe au comptoir (Panier Caisse)'
    };

    for (let attempt = 0; attempt < 10; attempt++) {
      numero = `FAC-${year}-${String(seq).padStart(5, '0')}`;
      venteObj.numero = numero;
      try {
        await conn.query(
          `INSERT INTO ventes (id, numero, clientId, clientNom, projetId, sessionId, caissierId, auteurNom, dateVente, dateEcheance, totalHT, totalTVA, totalTTC, montantPaye, modePaiement, statut, notes, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [venteId, numero, 'cli-passage', 'Client Passager', projetId, sessionId, auteurId, auteurNom, today, totalHT, totalTVA, totalTTC, totalTTC, modePaiement, 'Payée', venteObj.notes, JSON.stringify({ ...venteObj, lignes })]
        );
        break;
      } catch (e: any) {
        if (e?.code === 'ER_DUP_ENTRY' && attempt < 9) { seq++; continue; }
        throw e;
      }
    }

    const lignesOut: any[] = [];
    for (const l of lignes) {
      const [ins] = await conn.query(
        'INSERT INTO vente_lignes (venteId, articleId, designation, quantite, prixUnitaireHT, tauxTVA, totalTTC) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [venteId, l.articleId, l.designation, l.quantite, l.prixUnitaireHT, l.tauxTVA, l.totalTTC]
      );
      lignesOut.push({ id: String((ins as any).insertId), ...l });
    }
    venteObj.lignes = lignesOut;

    // Déduction stock + mouvements de stock (Sortie)
    const mouvements: any[] = [];
    const stocksOut: any[] = [];
    for (const op of stockOps) {
      await conn.query('UPDATE article_stocks SET quantite = ? WHERE articleId = ? AND projetId = ?', [op.apres, op.articleId, projetId]);
      const [allSt] = await conn.query('SELECT projetId, quantite FROM article_stocks WHERE articleId = ?', [op.articleId]);
      const stocksMap: Record<string, number> = {};
      let global = 0;
      for (const s of (allSt as any[])) {
        stocksMap[s.projetId] = Number(s.quantite);
        global += Number(s.quantite);
      }
      await conn.query('UPDATE articles SET stockGlobal = ? WHERE id = ?', [global, op.articleId]);
      stocksOut.push({ articleId: op.articleId, stockGlobal: global, stocks: stocksMap });

      const mvtId = `mvt-${uid}-${mouvements.length}`;
      const motif = `Vente caisse (Ticket ${numero})`;
      await conn.query(
        `INSERT INTO mouvements_stock (id, dateMouvement, articleId, projetId, typeMouvement, quantite, quantiteAvant, quantiteApres, motif, auteurId)
         VALUES (?, NOW(), ?, ?, 'Sortie', ?, ?, ?, ?, ?)`,
        [mvtId, op.articleId, projetId, op.quantite, op.avant, op.apres, motif, auteurNom]
      );
      mouvements.push({
        id: mvtId,
        date: now.toISOString().replace('T', ' ').slice(0, 16),
        dateFormatted: now.toLocaleDateString('fr-FR'),
        articleId: op.articleId,
        articleNom: op.designation,
        articleCode: op.code,
        designation: op.designation,
        projetId,
        projetNom,
        boutiqueNom: projetNom,
        type: 'Sortie',
        quantite: op.quantite,
        quantiteAvant: op.avant,
        quantiteApres: op.apres,
        motif,
        referencePiece: numero,
        auteur: auteurNom,
        utilisateurNom: auteurNom
      });
    }

    // Règlement d'encaissement
    const [encRows] = await conn.query(
      "SELECT MAX(CAST(SUBSTRING_INDEX(numeroPiece, '-', -1) AS UNSIGNED)) AS maxSeq FROM reglements WHERE numeroPiece LIKE ? FOR UPDATE",
      [`ENC-${year}-%`]
    );
    const numeroPiece = `ENC-${year}-${String((Number((encRows as any[])[0]?.maxSeq) || 0) + 1).padStart(5, '0')}`;
    const reglement: any = {
      id: `reg-${uid}`,
      projetId,
      sessionId,
      caissierId: auteurId,
      numeroPiece,
      type: 'Encaissement',
      tierId: 'cli-passage',
      tierNom: 'Client Passager',
      tierType: 'Client',
      documentRef: numero,
      date: today,
      dateReglement: now.toISOString(),
      montant: totalTTC,
      modePaiement,
      banque: 'Caisse Centrale',
      referencePaiement: `Caisse Directe (${modePaiement})`,
      notes: `Encaissement ticket caisse ${numero}`,
      statut: 'Validé'
    };
    await conn.query(
      `INSERT INTO reglements (id, projetId, sessionId, caissierId, numeroPiece, type, tierId, tierNom, tierType, documentRef, dateReglement, montant, modePaiement, banque, referencePaiement, notes, statut, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
      [reglement.id, projetId, sessionId, auteurId, numeroPiece, reglement.type, reglement.tierId, reglement.tierNom, reglement.tierType, numero, totalTTC, modePaiement, reglement.banque, reglement.referencePaiement, reglement.notes, reglement.statut, JSON.stringify(reglement)]
    );

    await conn.commit();

    broadcastWs({ type: 'new_order', payload: venteObj });
    for (const s of stocksOut) broadcastWs({ type: 'stock_change', payload: s });
    broadcastWs({
      type: 'notification',
      payload: {
        id: `notif-${uid}`,
        title: '🛒 Vente Caisse',
        message: `Ticket ${numero} (${totalTTC.toFixed(3)} DT) encaissé par ${auteurNom}.`,
        type: 'info',
        dateCreation: now.toISOString()
      }
    });

    console.log(`✅ [Caisse] Vente ${numero} enregistrée (${totalTTC.toFixed(3)} DT, ${lignesOut.length} ligne(s), boutique ${projetId}).`);
    return { success: true, vente: venteObj, reglement, mouvements, stocks: stocksOut };
  } catch (err: any) {
    try { await conn.rollback(); } catch {}
    console.error('❌ [Caisse] Encaissement refusé / annulé :', err?.message);
    throw err;
  } finally {
    conn.release();
  }
}

async function saveAchatToDb(achat: any) {
  const db = getDbPool();
  const id = achat.id || `ach-${Date.now()}`;
  const numero = achat.numero || `ACH-${Date.now()}`;
  const projetId = achat.projetId || "1";
  const fournisseurId = achat.fournisseurId || null;
  const fournisseurNom = achat.fournisseurNom || null;
  const dateEcheance = achat.dateEcheance || null;
  const totalHT = Number(achat.montantHT || 0);
  const totalTTC = Number(achat.montantTTC || totalHT);
  const montantRegle = Number(achat.montantRegle ?? achat.montantPaye ?? 0);
  const montantPaye = Number(achat.montantPaye ?? montantRegle);
  const statut = achat.statut || "Commandé";
  const modePaiement = achat.modePaiement || "Virement";
  const notes = achat.notes || "";
  const dataJson = JSON.stringify(achat);

  await db.query(`
    INSERT INTO achats (id, numero, projetId, fournisseurId, fournisseurNom, dateEcheance, totalHT, totalTTC, montantRegle, montantPaye, statut, modePaiement, notes, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      numero = VALUES(numero),
      projetId = VALUES(projetId),
      fournisseurId = VALUES(fournisseurId),
      fournisseurNom = VALUES(fournisseurNom),
      dateEcheance = VALUES(dateEcheance),
      totalHT = VALUES(totalHT),
      totalTTC = VALUES(totalTTC),
      montantRegle = VALUES(montantRegle),
      montantPaye = VALUES(montantPaye),
      statut = VALUES(statut),
      modePaiement = VALUES(modePaiement),
      notes = VALUES(notes),
      data = VALUES(data)
  `, [id, numero, projetId, fournisseurId, fournisseurNom, dateEcheance, totalHT, totalTTC, montantRegle, montantPaye, statut, modePaiement, notes, dataJson]);
  return { success: true, id };
}

async function saveReglementToDb(reg: any) {
  const db = getDbPool();
  const id = reg.id || `reg-${Date.now()}`;
  const projetId = reg.projetId || "1";
  const sessionId = reg.sessionId || null;
  const caissierId = reg.caissierId || null;
  const numeroPiece = reg.numeroPiece || `REG-${Date.now()}`;
  const type = reg.type || "Encaissement";
  const tierId = reg.tierId || null;
  const tierNom = reg.tierNom || null;
  const tierType = reg.tierType || "Client";
  const documentRef = reg.documentRef || null;
  const montant = Number(reg.montant || 0);
  const modePaiement = reg.modePaiement || "Espèces";
  const banque = reg.banque || null;
  const referencePaiement = reg.referencePaiement || null;
  const notes = reg.notes || "";
  const statut = reg.statut || "Validé";
  const dataJson = JSON.stringify(reg);

  await db.query(`
    INSERT INTO reglements (id, projetId, sessionId, caissierId, numeroPiece, type, tierId, tierNom, tierType, documentRef, montant, modePaiement, banque, referencePaiement, notes, statut, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      sessionId = COALESCE(VALUES(sessionId), sessionId),
      caissierId = COALESCE(VALUES(caissierId), caissierId),
      numeroPiece = VALUES(numeroPiece),
      type = VALUES(type),
      tierId = VALUES(tierId),
      tierNom = VALUES(tierNom),
      tierType = VALUES(tierType),
      documentRef = VALUES(documentRef),
      montant = VALUES(montant),
      modePaiement = VALUES(modePaiement),
      banque = VALUES(banque),
      referencePaiement = VALUES(referencePaiement),
      notes = VALUES(notes),
      statut = VALUES(statut),
      data = VALUES(data)
  `, [id, projetId, sessionId, caissierId, numeroPiece, type, tierId, tierNom, tierType, documentRef, montant, modePaiement, banque, referencePaiement, notes, statut, dataJson]);
  return { success: true, id };
}

async function saveDocumentLogistiqueToDb(doc: any, typeDoc: 'BL' | 'BA' | 'BS') {
  const db = getDbPool();
  const id = doc.id || `${typeDoc.toLowerCase()}-${Date.now()}`;
  const numero = doc.numero || `${typeDoc}-${Date.now()}`;
  const projetId = doc.projetId || "1";
  const statut = doc.statut || "Validé";
  const dataJson = JSON.stringify(doc);

  await db.query(`
    INSERT INTO documents_logistiques (id, typeDoc, numero, projetId, statut, data)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      numero = VALUES(numero),
      projetId = VALUES(projetId),
      statut = VALUES(statut),
      data = VALUES(data)
  `, [id, typeDoc, numero, projetId, statut, dataJson]);
  return { success: true, id };
}

async function saveProjetToDb(projet: any) {
  const db = getDbPool();
  const id = projet.id || `prj-${Date.now()}`;
  const nom = projet.nom || "Nouvelle Boutique";
  const entrepriseNom = projet.entrepriseNom || "SOCIETE UNIVERS GSM DE SUD";
  const codeBoutique = projet.codeBoutique || `BOUT-${Date.now()}`;
  const adresse = projet.adresse || null;
  const ville = projet.ville || null;
  const telephone = projet.telephone || null;
  const email = projet.email || null;
  const statut = projet.statut || "Active";
  const description = projet.description || null;
  const responsable = projet.responsable || null;

  await db.query(`
    INSERT INTO projets (id, nom, entrepriseNom, codeBoutique, adresse, ville, telephone, email, statut, description, responsable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      nom = VALUES(nom),
      entrepriseNom = VALUES(entrepriseNom),
      codeBoutique = VALUES(codeBoutique),
      adresse = VALUES(adresse),
      ville = VALUES(ville),
      telephone = VALUES(telephone),
      email = VALUES(email),
      statut = VALUES(statut),
      description = VALUES(description),
      responsable = VALUES(responsable)
  `, [id, nom, entrepriseNom, codeBoutique, adresse, ville, telephone, email, statut, description, responsable]);
  return { success: true, id };
}

async function saveUtilisateurToDb(u: any) {
  const db = getDbPool();
  const id = u.id || `u-${Date.now()}`;
  const nom = u.nom || "Utilisateur";
  const prenom = u.prenom || "";
  const email = u.email || `user-${Date.now()}@domain.com`;
  const telephone = u.telephone || null;
  const motDePasse = u.motDePasse || "demo123";
  const role = u.role || "agent";
  const statut = u.statut || "Actif";
  const projetId = u.projetId || "1";

  await db.query(`
    INSERT INTO utilisateurs (id, nom, prenom, email, telephone, motDePasse, role, statut, projetId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      nom = VALUES(nom),
      prenom = VALUES(prenom),
      email = VALUES(email),
      telephone = VALUES(telephone),
      motDePasse = VALUES(motDePasse),
      role = VALUES(role),
      statut = VALUES(statut),
      projetId = VALUES(projetId)
  `, [id, nom, prenom, email, telephone, motDePasse, role, statut, projetId]);
  return { success: true, id };
}

async function saveMouvementToDb(mvt: any, updateStock: boolean = true) {
  const db = getDbPool();
  const id = mvt.id || `mvt-${Date.now()}`;
  const articleId = mvt.articleId;
  const projetId = mvt.projetId || "1";
  const typeMouvement = mvt.type || mvt.typeMouvement || "Entrée";
  const quantite = Number(mvt.quantite) || 0;
  const quantiteAvant = Number(mvt.quantiteAvant) || 0;
  const quantiteApres = Number(mvt.quantiteApres) || 0;
  const motif = mvt.motif || "Ajustement manuel";
  const auteurId = mvt.auteur || mvt.auteurId || "Admin";

  if (!articleId) return { success: false, error: "Article ID manquant" };

  await db.query(`
    INSERT INTO mouvements_stock (id, dateMouvement, articleId, projetId, typeMouvement, quantite, quantiteAvant, quantiteApres, motif, auteurId)
    VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE id = id
  `, [id, articleId, projetId, typeMouvement, quantite, quantiteAvant, quantiteApres, motif, auteurId]);

  if (updateStock) {
    let delta = quantite;
    const motifLower = (motif || '').toLowerCase();
    if (typeMouvement === 'Sortie' || motifLower.includes('sortant') || motifLower.includes('vers ')) {
      delta = -Math.abs(quantite);
    } else if (typeMouvement === 'Entrée' || motifLower.includes('entrant') || motifLower.includes('depuis ')) {
      delta = Math.abs(quantite);
    }

    await db.query(`
      INSERT INTO article_stocks (articleId, projetId, quantite)
      VALUES (?, ?, GREATEST(0, ?))
      ON DUPLICATE KEY UPDATE quantite = GREATEST(0, quantite + ?)
    `, [articleId, projetId, Math.max(0, delta), delta]);

    // Recalculer le stock physique global exact
    const [stRows] = await db.query("SELECT projetId, quantite FROM article_stocks WHERE articleId = ?", [articleId]);
    const stocksMap: Record<string, number> = {};
    let totalStock = 0;
    for (const s of (stRows as any[])) {
      stocksMap[s.projetId] = Number(s.quantite);
      totalStock += Number(s.quantite);
    }

    await db.query("UPDATE articles SET stockGlobal = ? WHERE id = ?", [totalStock, articleId]);

    broadcastWs({
      type: 'stock_change',
      payload: { articleId, stockGlobal: totalStock, stocks: stocksMap }
    });
  }

  return { success: true, id };
}

// Transfert de stock physique inter-dépôts & boutiques avec déduction instantanée
async function executeStockTransfer(params: {
  sourceDepotId: string;
  destBoutiqueId: string;
  lignes: Array<{ articleId: string; quantite: number }>;
  motif?: string;
  auteur?: string;
  transferCode?: string;
  date?: string;
}) {
  const db = getDbPool();
  const sourceDepotId = String(params.sourceDepotId || '1');
  const destBoutiqueId = String(params.destBoutiqueId || '2');
  const lignes = Array.isArray(params.lignes) ? params.lignes : [];
  const motif = params.motif || 'Transfert inter-sites';
  const auteur = params.auteur ? String(params.auteur).trim() : '';
  const transferCode = params.transferCode || `TR-${Date.now()}`;

  if (!sourceDepotId || !destBoutiqueId) {
    throw new Error("RÈGLE STRICTE : Le dépôt source et la boutique de destination sont obligatoires.");
  }
  if (sourceDepotId === destBoutiqueId) {
    throw new Error("RÈGLE STRICTE : Le dépôt source et la boutique de destination doivent être obligatoirement différents.");
  }
  if (!auteur || auteur.trim() === '') {
    throw new Error("RÈGLE STRICTE (Règle 10) : L'auteur responsable du transfert doit être obligatoirement identifié.");
  }
  if (lignes.length === 0) {
    throw new Error("RÈGLE STRICTE : Au moins une ligne de transfert est obligatoire.");
  }

  // Contrôle strict préalable : Vérification de la disponibilité physique intégrale avant toute modification
  for (const line of lignes) {
    const articleId = line.articleId;
    const qty = Number(line.quantite) || 0;
    if (!articleId) throw new Error("RÈGLE STRICTE : Identifiant article manquant.");
    if (qty <= 0) throw new Error(`RÈGLE STRICTE : Quantité demandée invalide (${qty}). La quantité doit être supérieure à 0.`);

    const [artRows] = await db.query("SELECT designation, typeArticle, stockGlobal FROM articles WHERE id = ?", [articleId]);
    const art = (artRows as any[])[0];
    if (!art) throw new Error(`RÈGLE STRICTE : L'article ${articleId} n'existe pas dans le catalogue.`);

    if (art.typeArticle !== 'Service') {
      const [srcRows] = await db.query("SELECT quantite FROM article_stocks WHERE articleId = ? AND projetId = ?", [articleId, sourceDepotId]);
      let srcStockAvant = 0;
      if ((srcRows as any[]).length > 0) {
        srcStockAvant = Number((srcRows as any[])[0].quantite || 0);
      } else if (sourceDepotId === '1') {
        srcStockAvant = Number(art.stockGlobal || 0);
      }

      if (srcStockAvant <= 0 || srcStockAvant < qty) {
        throw new Error(`ACTION STRICTEMENT BLOQUÉE (Règle 8 - Stock Négatif Interdit) : Stock nul ou insuffisant au dépôt source pour "${art.designation}" (Disponible : ${srcStockAvant}, Demandé : ${qty}). Aucun transfert fictif n'est autorisé.`);
      }
    }
  }

  const [sourceRows] = await db.query("SELECT nom FROM projets WHERE id = ?", [sourceDepotId]);
  const [destRows] = await db.query("SELECT nom FROM projets WHERE id = ?", [destBoutiqueId]);
  const sourceNom = (sourceRows as any[])[0]?.nom || (sourceDepotId === '1' ? 'Société UGS (Dépôt Central)' : `Dépôt ${sourceDepotId}`);
  const destNom = (destRows as any[])[0]?.nom || `Boutique ${destBoutiqueId}`;

  const conn = await db.getConnection();
  const updatedArticlesList: any[] = [];

  try {
    await conn.beginTransaction();

    for (const line of lignes) {
      const articleId = line.articleId;
      const qty = Number(line.quantite) || 0;
      if (!articleId || qty <= 0) continue;

      // 1. Déduction physique atomique du stock source avec verrouillage FOR UPDATE
      const [srcRows] = await conn.query("SELECT quantite FROM article_stocks WHERE articleId = ? AND projetId = ? FOR UPDATE", [articleId, sourceDepotId]);
      let srcStockAvant = 0;
      if ((srcRows as any[]).length > 0) {
        srcStockAvant = Number((srcRows as any[])[0].quantite || 0);
      } else if (sourceDepotId === '1') {
        const [artRow] = await conn.query("SELECT stockGlobal FROM articles WHERE id = ? FOR UPDATE", [articleId]);
        srcStockAvant = Number((artRow as any[])[0]?.stockGlobal || 0);
      }

      if (srcStockAvant < qty) {
        throw new Error(`Concurrence : Le stock de l'article ${articleId} a changé et est devenu insuffisant.`);
      }

      const srcStockApres = srcStockAvant - qty;

      await conn.query(`
        INSERT INTO article_stocks (articleId, projetId, quantite)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantite = VALUES(quantite)
      `, [articleId, sourceDepotId, srcStockApres]);

      // 2. Ajout physique dans la boutique destination avec verrouillage
      const [dstRows] = await conn.query("SELECT quantite FROM article_stocks WHERE articleId = ? AND projetId = ? FOR UPDATE", [articleId, destBoutiqueId]);
      const dstStockAvant = Number((dstRows as any[])[0]?.quantite || 0);
      const dstStockApres = dstStockAvant + qty;

      await conn.query(`
        INSERT INTO article_stocks (articleId, projetId, quantite)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantite = VALUES(quantite)
      `, [articleId, destBoutiqueId, dstStockApres]);

      // 3. Recalculer le stock global total
      const [allRows] = await conn.query("SELECT projetId, quantite FROM article_stocks WHERE articleId = ?", [articleId]);
      const stocksMap: Record<string, number> = {};
      let totalStock = 0;
      for (const s of (allRows as any[])) {
        stocksMap[s.projetId] = Number(s.quantite);
        totalStock += Number(s.quantite);
      }

      await conn.query("UPDATE articles SET stockGlobal = ? WHERE id = ?", [totalStock, articleId]);

      // 4. Enregistrer les 2 mouvements (Sortie source & Entrée destination)
      const ts = Date.now();
      await conn.query(`
        INSERT INTO mouvements_stock (id, dateMouvement, articleId, projetId, typeMouvement, quantite, quantiteAvant, quantiteApres, motif, auteurId)
        VALUES (?, NOW(), ?, ?, 'Transfert', ?, ?, ?, ?, ?)
      `, [
        `mvt-tr-out-${ts}-${articleId}`,
        articleId,
        sourceDepotId,
        qty,
        srcStockAvant,
        srcStockApres,
        `Transfert sortant vers ${destNom} [${transferCode}] - Motif: ${motif}`,
        auteur
      ]);

      await conn.query(`
        INSERT INTO mouvements_stock (id, dateMouvement, articleId, projetId, typeMouvement, quantite, quantiteAvant, quantiteApres, motif, auteurId)
        VALUES (?, NOW(), ?, ?, 'Transfert', ?, ?, ?, ?, ?)
      `, [
        `mvt-tr-in-${ts}-${articleId}`,
        articleId,
        destBoutiqueId,
        qty,
        dstStockAvant,
        dstStockApres,
        `Transfert entrant depuis ${sourceNom} [${transferCode}] - Motif: ${motif}`,
        auteur
      ]);

      updatedArticlesList.push({ articleId, stockGlobal: totalStock, stocks: stocksMap });
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // 5. Diffuser en temps réel par WebSockets après commit réussi
  for (const item of updatedArticlesList) {
    broadcastWs({
      type: 'stock_change',
      payload: item
    });
  }

  broadcastWs({
    type: 'notification',
    payload: {
      id: `notif-${Date.now()}`,
      title: '📦 Transfert de Stock Effectué',
      message: `Transfert ${transferCode} : ${lignes.length} article(s) transféré(s) de ${sourceNom} vers ${destNom}. Stocks déduits physiquement.`,
      type: 'info',
      dateCreation: new Date().toISOString()
    }
  });

  return { success: true, transferCode, updatedArticles: updatedArticlesList };
}

// Bulk Save-All Implementation to ensure backward compatibility
async function saveAllDataToDb(data: any) {
  if (data.articles) {
    for (const a of data.articles) await saveArticleToDb(a);
  }
  if (data.clients) {
    for (const c of data.clients) await saveClientToDb(c);
  }
  if (data.fournisseurs) {
    for (const f of data.fournisseurs) await saveFournisseurToDb(f);
  }
  if (data.ventes) {
    for (const v of data.ventes) await saveVenteToDb(v);
  }
  if (data.achats) {
    for (const ac of data.achats) await saveAchatToDb(ac);
  }
  if (data.reglements) {
    for (const r of data.reglements) await saveReglementToDb(r);
  }
  if (data.bonsDeLivraison) {
    for (const bl of data.bonsDeLivraison) await saveDocumentLogistiqueToDb(bl, 'BL');
  }
  if (data.bonsDAchat) {
    for (const ba of data.bonsDAchat) await saveDocumentLogistiqueToDb(ba, 'BA');
  }
  if (data.bonsDeSortie) {
    for (const bs of data.bonsDeSortie) await saveDocumentLogistiqueToDb(bs, 'BS');
  }
  if (data.projets) {
    for (const p of data.projets) await saveProjetToDb(p);
  }
  if (data.utilisateurs) {
    for (const u of data.utilisateurs) await saveUtilisateurToDb(u);
  }
  if (data.mouvements) {
    // Si articles était fourni, les stocks sont déjà sauvegardés avec exactitude, on enregistre les mouvements d'historique sans double application
    const shouldUpdateStock = !data.articles || data.articles.length === 0;
    for (const m of data.mouvements) await saveMouvementToDb(m, shouldUpdateStock);
  }
  if (data.categories) {
    for (const cat of data.categories) await saveCategoryToDb(cat);
  }
  if (data.sessionsCaisse) {
    for (const sc of data.sessionsCaisse) await saveSessionCaisseToDb(sc);
  }
  return { success: true };
}

async function saveSessionCaisseToDb(s: any) {
  const db = getDbPool();
  const id = s.id || `session-${Date.now()}`;
  const projetId = s.projetId || '1';
  const utilisateurId = s.utilisateurId || '';
  const utilisateurNom = s.utilisateurNom || '';
  const statut = s.statut || 'Ouverte';
  const dateOuverture = s.dateOuverture ? new Date(s.dateOuverture) : new Date();
  const dateFermeture = (statut === 'Ouverte') ? null : (s.dateFermeture ? new Date(s.dateFermeture) : null);
  const soldeInitial = Number(s.soldeInitial || 0);
  const soldeFinalTheorique = s.soldeFinalTheorique !== undefined ? Number(s.soldeFinalTheorique) : null;
  const soldeFinalReel = s.soldeFinalReel !== undefined ? Number(s.soldeFinalReel) : null;
  const ecart = s.ecart !== undefined ? Number(s.ecart) : null;
  const notes = s.notes || '';
  const dataJson = JSON.stringify({
    ...s,
    statut,
    dateOuverture: dateOuverture.toISOString(),
    dateFermeture: dateFermeture ? dateFermeture.toISOString() : undefined
  });

  // Si on ouvre une nouvelle session, fermer d'anciennes sessions ouvertes orphelines pour cet utilisateur
  if (statut === 'Ouverte' && utilisateurId) {
    try {
      const now = new Date();
      await db.query(`
        UPDATE sessions_caisse 
        SET statut = 'Fermee', 
            dateFermeture = COALESCE(dateFermeture, ?),
            soldeFinalTheorique = COALESCE(soldeFinalTheorique, soldeInitial),
            soldeFinalReel = COALESCE(soldeFinalReel, soldeInitial)
        WHERE id != ? AND utilisateurId = ? AND statut = 'Ouverte'
      `, [now, id, utilisateurId]);
    } catch (e) {
      console.warn("Erreur auto-clôture anciennes sessions:", e);
    }
  }

  await db.query(`
    INSERT INTO sessions_caisse (id, projetId, utilisateurId, utilisateurNom, dateOuverture, dateFermeture, soldeInitial, soldeFinalTheorique, soldeFinalReel, ecart, statut, notes, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      projetId = VALUES(projetId),
      utilisateurId = VALUES(utilisateurId),
      utilisateurNom = VALUES(utilisateurNom),
      dateOuverture = VALUES(dateOuverture),
      dateFermeture = VALUES(dateFermeture),
      soldeInitial = VALUES(soldeInitial),
      soldeFinalTheorique = VALUES(soldeFinalTheorique),
      soldeFinalReel = VALUES(soldeFinalReel),
      ecart = VALUES(ecart),
      statut = VALUES(statut),
      notes = VALUES(notes),
      data = VALUES(data)
  `, [id, projetId, utilisateurId, utilisateurNom, dateOuverture, dateFermeture, soldeInitial, soldeFinalTheorique, soldeFinalReel, ecart, statut, notes, dataJson]);

  broadcastWs({
    type: 'session_caisse_update',
    payload: {
      id,
      projetId,
      utilisateurId,
      utilisateurNom,
      dateOuverture: dateOuverture.toISOString(),
      dateFermeture: dateFermeture ? dateFermeture.toISOString() : undefined,
      soldeInitial,
      soldeFinalTheorique: soldeFinalTheorique !== null ? soldeFinalTheorique : undefined,
      soldeFinalReel: soldeFinalReel !== null ? soldeFinalReel : undefined,
      ecart: ecart !== null ? ecart : undefined,
      statut,
      notes,
      ...s
    }
  });

  return { success: true, id };
}

async function saveCategoryToDb(cat: any) {
  const db = getDbPool();
  const id = cat.id || `cat-${Date.now()}`;
  const nom = cat.nom;
  const statut = cat.statut || 'Actif';
  
  await db.query(`
    INSERT INTO categories (id, nom, statut) 
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE nom = VALUES(nom), statut = VALUES(statut)
  `, [id, nom, statut]);
  
  return { success: true, id };
}

// ==========================================
// REST API ROUTES
// ==========================================
app.get('/api/db/test', async (req, res) => {
  const result = await testDbConnection();
  res.json(result);
});

app.get('/api/db/seed', async (req, res) => {
  await initDatabaseAndSeed();
  res.json({ success: true, message: "Base de données réinitialisée." });
});

app.get('/api/initial-data', async (req, res) => {
  const result = await getInitialData();
  res.json(result);
});

app.post('/api/save-all', async (req, res) => {
  try {
    const result = await saveAllDataToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Categories Endpoints
app.post('/api/categories', async (req, res) => {
  try {
    const result = await saveCategoryToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Articles Endpoints
app.post('/api/articles', async (req, res) => {
  try {
    const result = await saveArticleToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM articles WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clients Endpoints
app.post('/api/clients', async (req, res) => {
  try {
    const result = await saveClientToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM clients WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fournisseurs Endpoints
app.post('/api/fournisseurs', async (req, res) => {
  try {
    const result = await saveFournisseurToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/fournisseurs/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM fournisseurs WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Encaissement Caisse (POS) — transaction atomique unique
app.post('/api/caisse/encaisser', async (req, res) => {
  try {
    const result = await encaisserVenteCaisse(req.body);
    res.json(result);
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ success: false, error: err?.message || "Erreur lors de l'encaissement" });
  }
});

// Ventes Endpoints
app.post('/api/ventes', async (req, res) => {
  try {
    const result = await saveVenteToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ventes/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM vente_lignes WHERE venteId = ?", [req.params.id]);
    await db.query("DELETE FROM ventes WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Achats Endpoints
app.post('/api/achats', async (req, res) => {
  try {
    const result = await saveAchatToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/achats/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM achats WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Règlements Endpoints
app.post('/api/reglements', async (req, res) => {
  try {
    const result = await saveReglementToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reglements/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM reglements WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Documents logistiques Endpoints (BL, BA, BS)
app.post('/api/documents-logistiques/:type', async (req, res) => {
  try {
    const type = req.params.type.toUpperCase() as 'BL' | 'BA' | 'BS';
    const result = await saveDocumentLogistiqueToDb(req.body, type);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/documents-logistiques/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM documents_logistiques WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Projets Endpoints
app.post('/api/projets', async (req, res) => {
  try {
    const result = await saveProjetToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Utilisateurs Endpoints
app.post('/api/utilisateurs', async (req, res) => {
  try {
    const result = await saveUtilisateurToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/utilisateurs/:id', async (req, res) => {
  try {
    const db = getDbPool();
    await db.query("DELETE FROM utilisateurs WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mouvements de stock Endpoints
app.post('/api/mouvements', async (req, res) => {
  try {
    const result = await saveMouvementToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Transfert de stock physique inter-sites
app.post('/api/stock/transfert', async (req, res) => {
  try {
    const result = await executeStockTransfer(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sessions de caisse
app.post('/api/sessions-caisse', async (req, res) => {
  try {
    const result = await saveSessionCaisseToDb(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clôture sécurisée et définitive d'une session de caisse dans MySQL
app.post('/api/sessions-caisse/cloturer', async (req, res) => {
  try {
    const db = getDbPool();
    const { sessionId, projetId, utilisateurId, dateFermeture, soldeFinalTheorique, soldeFinalReel, ecart, notes } = req.body;
    const closureDate = dateFermeture ? new Date(dateFermeture) : new Date();

    if (sessionId) {
      await db.query(`
        UPDATE sessions_caisse 
        SET statut = 'Fermee', 
            dateFermeture = ?, 
            soldeFinalTheorique = ?, 
            soldeFinalReel = ?, 
            ecart = ?, 
            notes = ?,
            data = JSON_SET(COALESCE(data, '{}'), '$.statut', 'Fermee', '$.dateFermeture', ?)
        WHERE id = ?
      `, [closureDate, Number(soldeFinalTheorique || 0), Number(soldeFinalReel || 0), Number(ecart || 0), notes || '', closureDate.toISOString(), sessionId]);
    }

    // Clôture sécurisée pour CE caissier uniquement (ne clôture JAMAIS les caisses des autres caissiers du même point de vente)
    if (utilisateurId) {
      await db.query(`
        UPDATE sessions_caisse 
        SET statut = 'Fermee', 
            dateFermeture = ?, 
            soldeFinalTheorique = COALESCE(soldeFinalTheorique, soldeInitial),
            soldeFinalReel = COALESCE(soldeFinalReel, soldeInitial),
            ecart = 0,
            notes = COALESCE(notes, 'Clôture de caisse'),
            data = JSON_SET(COALESCE(data, '{}'), '$.statut', 'Fermee', '$.dateFermeture', ?)
        WHERE statut = 'Ouverte' AND utilisateurId = ?
      `, [closureDate, closureDate.toISOString(), utilisateurId]);
    }

    broadcastWs({
      type: 'session_caisse_update',
      payload: {
        id: sessionId,
        projetId,
        utilisateurId,
        statut: 'Fermee',
        dateFermeture: closureDate.toISOString(),
        soldeFinalTheorique: Number(soldeFinalTheorique || 0),
        soldeFinalReel: Number(soldeFinalReel || 0),
        ecart: Number(ecart || 0),
        notes
      }
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error("Erreur /api/sessions-caisse/cloturer:", err);
    res.status(500).json({ error: err.message });
  }
});

// Retours Endpoints
app.post('/api/retours', async (req, res) => {
  try {
    const db = getDbPool();
    const ret = req.body;
    const typeDoc = ret.type === 'Vente' ? 'BL' : 'BA';
    await db.query(`
      INSERT INTO documents_logistiques (id, typeDoc, numero, projetId, data)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE data = VALUES(data)
    `, [ret.id, typeDoc, ret.numero || `RET-${Date.now()}`, ret.projetId || '1', JSON.stringify(ret)]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// REAL-TIME POS CART SYNC (SMARTPHONE <-> PC)
// ==========================================
interface PosCartSyncPayload {
  syncKey: string;
  cart: any[];
  posClientId?: string;
  posPaymentMode?: string;
  remiseGlobale?: number;
  lastAction?: string;
  lastItemName?: string;
  senderDeviceId?: string;
  deviceType?: 'smartphone' | 'desktop' | 'tablet';
  updatedAt: number;
}

const posSyncStore = new Map<string, PosCartSyncPayload>();
const posSseSubscribers = new Map<string, Set<express.Response>>();

app.get('/api/caisse/stream/:syncKey', (req, res) => {
  const syncKey = req.params.syncKey;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (!posSseSubscribers.has(syncKey)) {
    posSseSubscribers.set(syncKey, new Set());
  }
  const subscribers = posSseSubscribers.get(syncKey)!;
  subscribers.add(res);

  const currentState = posSyncStore.get(syncKey);
  if (currentState) {
    res.write(`data: ${JSON.stringify({ type: 'sync', payload: currentState })}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ type: 'connected', syncKey })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
    if (subscribers.size === 0) {
      posSseSubscribers.delete(syncKey);
    }
  });
});

app.get('/api/caisse/sync/:syncKey', (req, res) => {
  const syncKey = req.params.syncKey;
  const state = posSyncStore.get(syncKey);
  if (state) {
    res.json(state);
  } else {
    res.json({ syncKey, cart: [], updatedAt: Date.now() });
  }
});

app.post('/api/caisse/sync', (req, res) => {
  try {
    const { syncKey, cart, posClientId, posPaymentMode, remiseGlobale, lastAction, lastItemName, senderDeviceId, deviceType } = req.body;
    if (!syncKey) {
      return res.status(400).json({ error: "syncKey requis pour la synchronisation." });
    }

    const payload: PosCartSyncPayload = {
      syncKey,
      cart: Array.isArray(cart) ? cart : [],
      posClientId: posClientId || '',
      posPaymentMode: posPaymentMode || 'Espèces',
      remiseGlobale: typeof remiseGlobale === 'number' ? remiseGlobale : 0,
      lastAction: lastAction || 'update',
      lastItemName: lastItemName || '',
      senderDeviceId: senderDeviceId || 'unknown',
      deviceType: deviceType || 'desktop',
      updatedAt: Date.now()
    };

    posSyncStore.set(syncKey, payload);

    const subscribers = posSseSubscribers.get(syncKey);
    if (subscribers && subscribers.size > 0) {
      const message = `data: ${JSON.stringify({ type: 'sync', payload })}\n\n`;
      subscribers.forEach(client => {
        try {
          client.write(message);
        } catch {
          subscribers.delete(client);
        }
      });
    }

    res.json({ success: true, updatedAt: payload.updatedAt, subscribersCount: subscribers ? subscribers.size : 0 });
  } catch (error: any) {
    console.error('Erreur lors de la synchronisation de caisse:', error);
    res.status(500).json({ error: error.message || 'Erreur serveur de synchronisation' });
  }
});

// Lazy Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('La clé API GEMINI_API_KEY n\'est pas configurée dans l\'environnement.');
    }
    aiClient = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Endpoint OCR pour les factures
app.post('/api/ocr-invoice', upload.single('invoice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier uploadé." });
    }

    const ai = getGeminiClient();
    const base64EncodeString = req.file.buffer.toString('base64');
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: base64EncodeString
          }
        },
        "Extract the invoice details into JSON: fournisseurNom (supplier name), numero (invoice number), date (YYYY-MM-DD), montantHT (number), montantTTC (number), and a list of lignes with designation, quantite (number), prixUnitaireHT (number), totalHT (number), totalTTC (number)."
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fournisseurNom: { type: Type.STRING },
            numero: { type: Type.STRING },
            date: { type: Type.STRING },
            montantHT: { type: Type.NUMBER },
            montantTTC: { type: Type.NUMBER },
            lignes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  designation: { type: Type.STRING },
                  quantite: { type: Type.NUMBER },
                  prixUnitaireHT: { type: Type.NUMBER },
                  totalHT: { type: Type.NUMBER },
                  totalTTC: { type: Type.NUMBER }
                }
              }
            }
          }
        }
      }
    });

    const parsedJson = JSON.parse(response.text ? response.text.trim() : '{}');
    res.json(parsedJson);
  } catch (error: any) {
    console.error('Erreur OCR:', error);
    res.status(500).json({ error: error.message || 'Erreur lors de l\'analyse du document.' });
  }
});

// Endpoint Assistant ERP
app.post('/api/chat-erp', async (req, res) => {
  try {
    const { prompt, erpContext } = req.body;
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { text: `Vous êtes un assistant ERP expert. Voici le contexte actuel des données de l'ERP : \n${JSON.stringify(erpContext)}\n\nRépondez à la question de l'utilisateur de manière concise et professionnelle en utilisant ces données.` },
        { text: prompt || '' }
      ]
    });
    res.json({ text: response.text || '' });
  } catch (error: any) {
    console.error('Erreur Chat ERP:', error);
    res.status(500).json({ error: error.message || 'Erreur de communication avec l\'assistant IA.' });
  }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Express Global Error:", err);
  if (req.path.startsWith("/api/")) {
    res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
  } else {
    next(err);
  }
});

async function startServer() {
  try {
    await initDatabaseAndSeed();
  } catch (err: any) {
    console.error("Erreur lors de l'initialisation de la base de données :", err.message || err);
  }

  const distPath = path.join(process.cwd(), 'dist');
  let isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    try {
      const vitePkg = 'vite';
      const { createServer: createViteServer } = await import(vitePkg);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn("Vite non trouvé. Basculement sur les fichiers statiques de production.");
      isProd = true;
    }
  }

  if (isProd) {
    app.use(express.static(distPath, { maxAge: '1y' }));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);

  wss = new WebSocketServer({ server });

  // WebSocket Heartbeat & Error Monitoring to prevent socket memory leaks
  wss.on('connection', (ws) => {
    (ws as any).isAlive = true;

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    ws.on('error', (err) => {
      console.warn("⚠️ [WebSocket Client Error]:", err.message);
      wsClients.delete(ws);
    });

    wsClients.add(ws);

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'pos_cart_update') {
          if (parsed.payload && parsed.payload.syncKey) {
            posSyncStore.set(parsed.payload.syncKey, parsed.payload);
          }
          broadcastWs(parsed);
        } else if (parsed.type === 'stock_change' || parsed.type === 'new_order' || parsed.type === 'notification' || parsed.type === 'session_caisse_update') {
          broadcastWs(parsed);
        }
      } catch (err) {
        console.error("Erreur parsing message WS:", err);
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
    });
  });

  // 30s Heartbeat Check
  const heartbeatInterval = setInterval(() => {
    for (const ws of wsClients) {
      if ((ws as any).isAlive === false) {
        wsClients.delete(ws);
        ws.terminate();
        continue;
      }
      (ws as any).isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        wsClients.delete(ws);
      }
    }
  }, 30000);

  // Graceful Process Termination (SIGINT / SIGTERM)
  const gracefulShutdown = (signal: string) => {
    console.log(`\n🛑 [Serveur] Signal ${signal} reçu. Arrêt gracieux en cours...`);
    clearInterval(heartbeatInterval);
    for (const ws of wsClients) {
      try { ws.close(); } catch {}
    }
    wsClients.clear();
    if (wss) {
      try { wss.close(); } catch {}
    }
    server.close(async () => {
      console.log("🔒 [Serveur] Serveur HTTP fermé.");
      if (pool) {
        await pool.end();
        console.log("🔒 [MySQL] Pool de connexions fermé avec succès.");
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.error("⚠️ [Serveur] Délai dépassé, arrêt forcé.");
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
