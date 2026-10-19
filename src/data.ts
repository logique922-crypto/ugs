import { Article, AuditLog, Client, Fournisseur, Projet, Utilisateur, RetourVente, RetourMarchandise, BonDeLivraison, BonDAchat, BonDeSortie, StockOperation, SessionCaisse, SessionActionLog } from './types';

export const mockUsers: Utilisateur[] = [
  { 
    id: 'demo-super-admin', 
    nom: 'Direction Générale UGS', 
    prenom: 'Super Admin',
    email: 'superadmin@erp-management.com', 
    telephone: '+216 75 655 555',
    motDePasse: 'demo123', 
    role: 'super_admin', 
    statut: 'Actif', 
    projetsAffectes: ['1', '2', '3'],
    dateCreation: '2023-01-15',
    derniereConnexion: '2026-09-08 11:42',
    permissions: {
      peutAccorderRemise: true,
      peutModifierPrix: true,
      peutSupprimerDocuments: true,
      peutVoirMarge: true,
      peutCloturerCaisse: true,
    }
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
    projetsAffectes: ['1'],
    dateCreation: '2023-01-20',
    derniereConnexion: '2026-09-08 09:15',
    permissions: {
      peutAccorderRemise: true,
      peutModifierPrix: true,
      peutSupprimerDocuments: false,
      peutVoirMarge: true,
      peutCloturerCaisse: false,
    }
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
    projetsAffectes: ['1', '2', '3'],
    dateCreation: '2023-03-10',
    derniereConnexion: '2026-09-07 16:30',
    permissions: {
      peutAccorderRemise: false,
      peutModifierPrix: false,
      peutSupprimerDocuments: false,
      peutVoirMarge: true,
      peutCloturerCaisse: true,
    }
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
    projetsAffectes: ['2', '3'],
    dateCreation: '2023-05-12',
    derniereConnexion: '2026-09-08 08:30',
    permissions: {
      peutAccorderRemise: false,
      peutModifierPrix: false,
      peutSupprimerDocuments: false,
      peutVoirMarge: false,
      peutCloturerCaisse: true,
    }
  },
  { 
    id: 'demo-caissier-scolaire', 
    nom: 'Rim Trabelsi (Boutique Scolaire)', 
    prenom: 'Rim',
    email: 'caissier.scolaire@erp-management.com', 
    telephone: '+216 74 000 002',
    motDePasse: 'demo123', 
    role: 'caissier', 
    statut: 'Actif', 
    projetId: '2', 
    projetsAffectes: ['2'],
    dateCreation: '2023-06-25',
    derniereConnexion: '2026-09-08 10:10',
    permissions: {
      peutAccorderRemise: false,
      peutModifierPrix: false,
      peutSupprimerDocuments: false,
      peutVoirMarge: false,
      peutCloturerCaisse: true,
    }
  },
  { 
    id: 'u-gabes', 
    nom: 'Fatma Zahra (Boutique Gabès)', 
    prenom: 'Fatma',
    email: 'gabes@erp-management.com', 
    telephone: '+216 75 000 001',
    motDePasse: 'demo123', 
    role: 'chef_projet', 
    statut: 'Actif', 
    projetId: '3', 
    projetsAffectes: ['3'],
    dateCreation: '2023-07-01',
    derniereConnexion: '2026-09-06 14:05',
    permissions: {
      peutAccorderRemise: true,
      peutModifierPrix: false,
      peutSupprimerDocuments: false,
      peutVoirMarge: true,
      peutCloturerCaisse: true,
    }
  },
  { 
    id: 'u7', 
    nom: 'Sarah Ayadi (Agent Commercial)', 
    prenom: 'Sarah',
    email: 'agent@entreprise.com', 
    telephone: '+216 75 655 559',
    motDePasse: 'agent123', 
    role: 'agent', 
    statut: 'Actif', 
    projetId: '1', 
    projetsAffectes: ['1', '3'],
    dateCreation: '2023-09-14',
    derniereConnexion: '2026-09-05 18:22',
    permissions: {
      peutAccorderRemise: true,
      peutModifierPrix: false,
      peutSupprimerDocuments: false,
      peutVoirMarge: false,
      peutCloturerCaisse: false,
    }
  }
];

export const mockAuditLogs: AuditLog[] = [];

export const mockProjets: Projet[] = [
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

// All business entities are 100% clean and driven strictly by the database
export const mockArticles: Article[] = [];
export const mockClients: Client[] = [];
export const mockFournisseurs: Fournisseur[] = [];
export const mockVentes: any[] = [];
export const mockAchats: any[] = [];
export const mockReglements: any[] = [];
export const mockRelances: any[] = [];
export const mockMouvements: any[] = [];
export const mockMonthlyData: Record<string, Array<{ mois: string; ventes: number; achats: number }>> = {
  'all': [],
  '1': [],
  '2': [],
  '3': []
};
export const mockObjectifs: any[] = [];
export const mockBonsDeLivraison: BonDeLivraison[] = [];
export const mockStockOperations: StockOperation[] = [];
export const mockRetoursMarchandise: RetourMarchandise[] = [];
export const mockRetoursVente: RetourVente[] = [];
export const mockBonsDAchat: BonDAchat[] = [];
export const mockBonsDeSortie: BonDeSortie[] = [];
export const mockSessionsCaisse: SessionCaisse[] = [];
export const mockActionLogsCaisse: SessionActionLog[] = [];
