import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Reglement, Projet, Vente, Achat, Client, Fournisseur, Utilisateur, Article, LigneVente, MouvementStock, SessionCaisse, SessionActionLog, RetourVente, LigneRetourVente, ModeRemboursement } from '../types';
import { generateReceiptPdf, generateReturnSlipPdf } from '../utils/pdfExportEngine';
import { generateNextDocNumber } from '../utils/numbering';
import { generateZReportPdf } from '../utils/caisseZReport';
import { CameraBarcodeScannerModal } from './CameraBarcodeScannerModal';
import { TicketPanierModal } from './TicketPanierModal';
import { getArticleStock, updateArticleStock, isArticleInProject } from '../utils/stockUtils';
import { createGuaranteedStockMovement } from '../utils/stockIntegrityEngine';

interface CartItem {
  article: Article;
  quantite: number;
  prixVenteHT: number;
}

interface CaisseProps {
  currentUser: Utilisateur;
  selectedProjectId: string;
  onSelectProject?: (projectId: string) => void;
  reglements: Reglement[];
  projets: Projet[];
  ventes: Vente[];
  achats: Achat[];
  clients: Client[];
  fournisseurs: Fournisseur[];
  articles?: Article[];
  mouvements?: MouvementStock[];
  sessions: SessionCaisse[];
  actionLogs: SessionActionLog[];
  retours?: RetourVente[];
  onRetoursChange?: (retours: RetourVente[]) => void;
  onReglementsChange: (reglements: Reglement[]) => void;
  onVentesChange?: (ventes: Vente[]) => void;
  onPosSaleRecorded?: (result: { vente: Vente; reglement: Reglement; mouvements: MouvementStock[]; stocks: Array<{ articleId: string; stockGlobal: number; stocks: Record<string, number> }> }) => void;
  onArticlesChange?: (articles: Article[]) => void;
  onClientsChange?: (clients: Client[]) => void;
  onMouvementsChange?: (mouvements: MouvementStock[]) => void;
  onSessionsChange: (sessions: SessionCaisse[]) => void;
  onActionLogsChange: (logs: SessionActionLog[]) => void;
}

export function Caisse({
  currentUser,
  selectedProjectId,
  onSelectProject,
  reglements,
  projets,
  ventes,
  achats,
  clients,
  fournisseurs,
  articles = [],
  mouvements = [],
  sessions = [],
  actionLogs = [],
  retours = [],
  onRetoursChange,
  onReglementsChange,
  onVentesChange,
  onPosSaleRecorded,
  onArticlesChange,
  onClientsChange,
  onMouvementsChange,
  onSessionsChange,
  onActionLogsChange
}: CaisseProps) {
  // État local de fermeture immédiate (garantit que l'écran bascule instantanément vers l'ouverture sans aucun résidu de panier)
  const [sessionClosedLocally, setSessionClosedLocally] = useState<boolean>(false);

  // Nettoyage automatique des anciennes clés toxiques de localStorage qui bloquaient les caisses au rechargement
  useEffect(() => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('ugs_session_closed_user_') || key.startsWith('ugs_session_closed_project_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
  }, []);

  // Session State - Conserve la session ouverte à travers les actualisations et appareils
  const activeSession = useMemo(() => {
    if (sessionClosedLocally) return undefined;

    const isSessionClosed = (s: SessionCaisse) => {
      if (s.statut === 'Fermee') return true;
      if (s.dateFermeture && s.dateFermeture !== '0000-00-00 00:00:00' && s.dateFermeture !== 'null') {
        const dt = new Date(s.dateFermeture);
        if (!isNaN(dt.getTime()) && dt.getFullYear() >= 2020) return true;
      }
      if (localStorage.getItem('ugs_closed_session_' + s.id) === 'true') return true;
      return false;
    };

    // Correspondance d'identité flexible et robuste (ID insensible au type ou Nom)
    const isUserMatch = (s: SessionCaisse) => {
      const sessUserId = String(s.utilisateurId || '').trim();
      const currentUserId = String(currentUser.id || '').trim();
      const sessUserNom = String(s.utilisateurNom || '').trim().toLowerCase();
      const currentUserNom = String(currentUser.nom || '').trim().toLowerCase();
      return (sessUserId && currentUserId && sessUserId === currentUserId) || 
             (sessUserNom && currentUserNom && sessUserNom === currentUserNom);
    };

    // RÈGLE STRICTE ET FONDAMENTALE :
    // Chaque utilisateur / caissier a STRICTEMENT sa propre caisse individuelle (SessionCaisse).
    // Lorsque le caissier 1 ouvre sa caisse, et le caissier 2 ouvre, chacun a sa propre session distincte.
    // Un utilisateur ne doit JAMAIS hériter ou opérer sur la session d'un autre utilisateur.
    // Priorité 1: Session ouverte du caissier dans le projet/boutique actif
    if (selectedProjectId !== 'all') {
      const match = sessions.find(s => 
        isUserMatch(s) && 
        String(s.projetId) === String(selectedProjectId) && 
        s.statut === 'Ouverte' &&
        !isSessionClosed(s)
      );
      if (match) return match;
    }

    // Priorité 2: Session ouverte du caissier sur son point de vente
    const mySession = sessions.find(s => 
      isUserMatch(s) && 
      s.statut === 'Ouverte' &&
      !isSessionClosed(s)
    );
    return mySession;
  }, [sessions, currentUser.id, currentUser.nom, currentUser.role, currentUser.projetId, selectedProjectId, sessionClosedLocally]);

  // Si une session active existe et que le projet sélectionné est 'all', aligner sur le projet de la session
  useEffect(() => {
    if (activeSession && selectedProjectId === 'all' && activeSession.projetId) {
      onSelectProject(activeSession.projetId);
    }
  }, [activeSession, selectedProjectId, onSelectProject]);

  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [openingNotes, setOpeningNotes] = useState<string>('');
  const [sessionNotes, setSessionNotes] = useState<string>('');
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false);
  const [selectedOpeningBoutiqueId, setSelectedOpeningBoutiqueId] = useState<string>('');
  const [lastClosedSession, setLastClosedSession] = useState<{
    soldeFinal: number;
    soldeInitial: number;
    dateFermeture: string;
    boutiqueId: string;
    boutiqueNom: string;
  } | null>(() => {
    try {
      const saved = localStorage.getItem('ugs_last_closed_session_' + currentUser.id) || localStorage.getItem('ugs_last_closed_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Ventes rattachées à la session active (filtrage strict par session et horodatage pour garantir 0 DT à chaque ouverture)
  const sessionSales = useMemo(() => {
    if (!activeSession) return [];
    const openTime = new Date(activeSession.dateOuverture).getTime();

    return ventes.filter(v => {
      const isStore = v.projetId === selectedProjectId || v.projetId === activeSession.projetId;
      if (!isStore) return false;

      if (v.statut === 'Devis' || v.statut === 'Annulée') return false;

      const isCashier = !v.auteurId || v.auteurId === currentUser.id || v.auteurId === activeSession.utilisateurId;
      if (!isCashier) return false;

      // Rattachement STRICT à cette session :
      // 1. Si sessionId est présent
      if (v.sessionId) {
        return v.sessionId === activeSession.id;
      }

      // 2. Si dateVente (horodatage ISO) est disponible
      if (v.dateVente) {
        const t = new Date(v.dateVente).getTime();
        if (!isNaN(t)) return t >= openTime;
      }

      // 3. Si date contient une heure ISO
      if (v.date && v.date.includes('T')) {
        const t = new Date(v.date).getTime();
        if (!isNaN(t)) return t >= openTime;
      }

      // 4. Si l'identifiant contient un timestamp UNIX (ex: "v-1792141706651")
      const idMatch = v.id.match(/\b(\d{13})\b/);
      if (idMatch) {
        const t = Number(idMatch[1]);
        if (!isNaN(t)) return t >= openTime;
      }

      // Vente antérieure ou non rattachée : exclure pour garantir 0 DT à la nouvelle ouverture
      return false;
    });
  }, [activeSession, ventes, selectedProjectId, currentUser.id]);

  // Totaux par mode de règlement des ventes de la session
  const totalVentesEspeces = useMemo(() => {
    return sessionSales
      .filter(v => v.modePaiement === 'Espèces' || !v.modePaiement)
      .reduce((sum, v) => sum + (v.montantPaye ?? v.montantTTC ?? 0), 0);
  }, [sessionSales]);

  const totalVentesCheque = useMemo(() => {
    return sessionSales
      .filter(v => v.modePaiement === 'Chèque')
      .reduce((sum, v) => sum + (v.montantPaye ?? v.montantTTC ?? 0), 0);
  }, [sessionSales]);

  const totalVentesAutres = useMemo(() => {
    return sessionSales
      .filter(v => v.modePaiement !== 'Espèces' && v.modePaiement !== 'Chèque' && v.modePaiement)
      .reduce((sum, v) => sum + (v.montantPaye ?? v.montantTTC ?? 0), 0);
  }, [sessionSales]);

  const totalVentesGlobal = useMemo(() => {
    return sessionSales.reduce((sum, v) => sum + (v.montantPaye ?? v.montantTTC ?? 0), 0);
  }, [sessionSales]);

  // Retours clients de la session active (strictement isolés par session caissier)
  const sessionRetours = useMemo(() => {
    if (!activeSession) return [];
    const openTime = new Date(activeSession.dateOuverture).getTime();

    return retours.filter(r => {
      const isStore = r.projetId === selectedProjectId || r.projetId === activeSession.projetId;
      if (!isStore) return false;

      // 1. Si sessionId est présent
      if (r.sessionId) {
        return r.sessionId === activeSession.id;
      }

      // 2. Par auteur et date >= ouverture
      const isSameCashier = !r.auteurId || r.auteurId === currentUser.id || r.auteurId === activeSession.utilisateurId;
      if (!isSameCashier) return false;

      if (r.date) {
        const t = new Date(r.date.replace(' ', 'T')).getTime();
        if (!isNaN(t)) return t >= openTime;
      }

      const idMatch = r.id.match(/\b(\d{13})\b/);
      if (idMatch) {
        const t = Number(idMatch[1]);
        if (!isNaN(t)) return t >= openTime;
      }

      return false;
    });
  }, [activeSession, retours, selectedProjectId, currentUser.id]);

  // Totaux des retours de la session
  const totalRetoursEspeces = useMemo(() => {
    return sessionRetours
      .filter(r => r.modeRemboursement === 'Espèces')
      .reduce((sum, r) => sum + (r.montantTotal || 0), 0);
  }, [sessionRetours]);

  const totalRetoursAvoir = useMemo(() => {
    return sessionRetours
      .filter(r => r.modeRemboursement === 'Avoir')
      .reduce((sum, r) => sum + (r.montantTotal || 0), 0);
  }, [sessionRetours]);

  const totalRetoursGlobal = useMemo(() => {
    return sessionRetours.reduce((sum, r) => sum + (r.montantTotal || 0), 0);
  }, [sessionRetours]);

  // Chiffre d'Affaires Net de la session (Ventes TTC - Retours TTC)
  const caNetSession = useMemo(() => {
    return Math.max(0, totalVentesGlobal - totalRetoursGlobal);
  }, [totalVentesGlobal, totalRetoursGlobal]);

  // Mouvements d'espèces manuels de la session (hors tickets de ventes directes et hors remboursements retours)
  const sessionReglementsManuels = useMemo(() => {
    if (!activeSession) return { encaissementsEspeces: 0, decaissementsEspeces: 0, decaissementsRetours: 0, count: 0, items: [] as Reglement[] };
    const openTime = new Date(activeSession.dateOuverture).getTime();

    const list = reglements.filter(r => {
      const isStore = r.projetId === selectedProjectId || r.projetId === activeSession.projetId;
      if (!isStore) return false;
      if (r.documentRef?.startsWith('FAC-') || r.documentRef?.startsWith('DEV-')) return false;

      if ((r as any).sessionId) {
        return (r as any).sessionId === activeSession.id;
      }

      const regDate = (r as any).dateReglement || r.date;
      if (regDate && regDate.includes('T')) {
        const t = new Date(regDate).getTime();
        if (!isNaN(t)) return t >= openTime;
      }

      const idMatch = r.id.match(/\b(\d{13})\b/);
      if (idMatch) {
        const t = Number(idMatch[1]);
        if (!isNaN(t)) return t >= openTime;
      }

      return false;
    });

    const enc = list.filter(r => r.type === 'Encaissement' && r.modePaiement === 'Espèces').reduce((s, r) => s + r.montant, 0);
    const decDivers = list.filter(r => r.type === 'Décaissement' && r.modePaiement === 'Espèces' && !r.documentRef?.startsWith('RET-')).reduce((s, r) => s + r.montant, 0);
    const decRetours = list.filter(r => r.type === 'Décaissement' && r.modePaiement === 'Espèces' && r.documentRef?.startsWith('RET-')).reduce((s, r) => s + r.montant, 0);
    return { encaissementsEspeces: enc, decaissementsEspeces: decDivers, decaissementsRetours: decRetours, count: list.length, items: list };
  }, [activeSession, reglements, selectedProjectId]);

  // MONTANT FINAL TOTAL DANS LE TIROIR-CAISSE (Calculé Automatiquement en temps réel)
  // Fond Initial + Ventes Espèces + Entrées diverses - Dépenses diverses - Remboursements retours en espèces
  const soldeFinalCalcule = useMemo(() => {
    if (!activeSession) return 0;
    const effectifRetoursEspeces = Math.max(totalRetoursEspeces, sessionReglementsManuels.decaissementsRetours || 0);
    return activeSession.soldeInitial + totalVentesEspeces + sessionReglementsManuels.encaissementsEspeces - sessionReglementsManuels.decaissementsEspeces - effectifRetoursEspeces;
  }, [activeSession, totalVentesEspeces, sessionReglementsManuels, totalRetoursEspeces]);

  const logAction = (action: string, type: SessionActionLog['type'], montant?: number, details?: string) => {
    if (!activeSession) return;
    const newLog: SessionActionLog = {
      id: `log-${Date.now()}`,
      sessionId: activeSession.id,
      utilisateurId: currentUser.id,
      timestamp: new Date().toISOString(),
      action,
      type,
      montant,
      details
    };
    onActionLogsChange([newLog, ...actionLogs]);
  };

  const handleOpenSession = (chosenBoutiqueId?: string) => {
    const targetProjectId = chosenBoutiqueId || selectedOpeningBoutiqueId || (selectedProjectId !== 'all' && selectedProjectId !== '1'
      ? selectedProjectId 
      : (currentUser.projetId && currentUser.projetId !== 'all' && currentUser.projetId !== '1' ? currentUser.projetId : (retailBoutiques[0]?.id || '1')));

    const newSession: SessionCaisse = {
      id: `session-${Date.now()}`,
      projetId: targetProjectId,
      utilisateurId: currentUser.id,
      utilisateurNom: currentUser.nom,
      dateOuverture: new Date().toISOString(),
      soldeInitial: openingBalance,
      statut: 'Ouverte',
      notes: openingNotes.trim() ? openingNotes : undefined
    };
    if (selectedProjectId !== targetProjectId) {
      onSelectProject(targetProjectId);
    }
    const updatedSessions = [newSession, ...sessions.filter(s => s.id !== newSession.id)];
    onSessionsChange(updatedSessions);

    // Persistance immédiate dans localStorage pour survie immédiate au refresh
    try {
      localStorage.setItem('ugs_sessions_caisse', JSON.stringify(updatedSessions));
      localStorage.removeItem('ugs_last_closed_session_' + currentUser.id);
      localStorage.removeItem('ugs_last_closed_session');
      localStorage.removeItem('ugs_closed_session_' + newSession.id);
    } catch {}

    // Envoi direct et garanti au backend MySQL
    fetch('/api/sessions-caisse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSession)
    }).catch(err => console.error("Erreur API ouverture caisse:", err));
    
    // Log the opening
    const newLog: SessionActionLog = {
      id: `log-${Date.now()}`,
      sessionId: newSession.id,
      utilisateurId: currentUser.id,
      timestamp: new Date().toISOString(),
      action: 'Ouverture de session',
      type: 'Ouverture',
      montant: openingBalance,
      details: `Session de caisse ouverte avec un fond initial de ${openingBalance.toFixed(3)} DT`
    };
    onActionLogsChange([newLog, ...actionLogs]);
    setIsOpeningModalOpen(false);
    setLastClosedSession(null);

    // Déverrouiller la session pour afficher le terminal POS actif
    setSessionClosedLocally(false);
    setPosSuccessMsg(`Nouvelle session de caisse initialisée et ouverte avec succès ! Fond initial : ${openingBalance.toFixed(3)} DT.`);
  };

  const [closingCountedCash, setClosingCountedCash] = useState<number | ''>('');
  const [sessionSalesSearch, setSessionSalesSearch] = useState('');
  const [sessionSalesModeFilter, setSessionSalesModeFilter] = useState('all');

  const filteredSessionSales = useMemo(() => {
    return sessionSales.filter(v => {
      const q = sessionSalesSearch.toLowerCase().trim();
      const matchSearch = !q || 
        v.numero.toLowerCase().includes(q) ||
        (v.clientNom && v.clientNom.toLowerCase().includes(q)) ||
        (v.lignes && v.lignes.some(l => l.designation.toLowerCase().includes(q)));
      
      const matchMode = sessionSalesModeFilter === 'all' || v.modePaiement === sessionSalesModeFilter;
      return matchSearch && matchMode;
    });
  }, [sessionSales, sessionSalesSearch, sessionSalesModeFilter]);

  const handleCloseSession = () => {
    if (!activeSession) return;
    
    // Le montant final théorique calculé automatiquement
    const finalTheorique = soldeFinalCalcule;
    const countedAmount = closingCountedCash !== '' ? Number(closingCountedCash) : finalTheorique;
    const diff = countedAmount - finalTheorique;
    const closureDate = new Date().toISOString();

    const closedSession: SessionCaisse = {
      ...activeSession,
      dateFermeture: closureDate,
      soldeFinalTheorique: finalTheorique,
      soldeFinalReel: countedAmount,
      ecart: diff,
      statut: 'Fermee' as const,
      notes: sessionNotes.trim() ? sessionNotes : (diff === 0 ? 'Clôture de caisse certifiée conforme sans anomalie.' : `Clôture avec écart de ${diff.toFixed(3)} DT.`)
    };

    const updatedSessions = sessions.map(s => {
      // Clôturer STRICTEMENT cette session active ou d'anciennes sessions orphelines de CE caissier (sans toucher aux caisses des autres caissiers)
      const isTargetUserSession = s.id === activeSession.id || (
        (String(s.utilisateurId) === String(currentUser.id) || (s.utilisateurNom && s.utilisateurNom.toLowerCase() === currentUser.nom.toLowerCase())) &&
        s.statut === 'Ouverte'
      );

      if (isTargetUserSession) {
        return {
          ...s,
          dateFermeture: closureDate,
          soldeFinalTheorique: s.id === activeSession.id ? finalTheorique : (s.soldeFinalTheorique || s.soldeInitial),
          soldeFinalReel: s.id === activeSession.id ? countedAmount : (s.soldeFinalReel || s.soldeInitial),
          ecart: s.id === activeSession.id ? diff : 0,
          statut: 'Fermee' as const,
          notes: sessionNotes.trim() ? sessionNotes : (diff === 0 ? 'Clôture de caisse certifiée conforme sans anomalie.' : `Clôture avec écart de ${diff.toFixed(3)} DT.`)
        };
      }
      return s;
    });
    onSessionsChange(updatedSessions);
    
    // Log the closing
    const newLog: SessionActionLog = {
      id: `log-${Date.now()}`,
      sessionId: activeSession.id,
      utilisateurId: currentUser.id,
      timestamp: closureDate,
      action: 'Clôture de Session',
      type: 'Fermeture',
      montant: countedAmount,
      details: `Caisse clôturée. Solde compté: ${countedAmount.toFixed(3)} DT (Théorique: ${finalTheorique.toFixed(3)} DT, Écart: ${diff.toFixed(3)} DT, Fond initial: ${activeSession.soldeInitial.toFixed(3)} DT + Espèces: ${totalVentesEspeces.toFixed(3)} DT).`
    };
    onActionLogsChange([newLog, ...actionLogs]);

    // Génération automatique et immédiate du Ticket Z (Procès-Verbal Officiel)
    try {
      generateZReportPdf({
        session: closedSession,
        projet: currentProject || projets.find(p => p.id === activeSession.projetId),
        caissier: currentUser,
        ventesSession: sessionSales,
        reglementsSession: sessionReglementsManuels.items,
        retoursSession: sessionRetours,
        soldeFinalCalcule: finalTheorique
      });
    } catch (errZ) {
      console.warn("Erreur génération Z-Report:", errZ);
    }

    // Clôture immédiate et garantie au niveau backend MySQL
    fetch('/api/sessions-caisse/cloturer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeSession.id,
        projetId: activeSession.projetId,
        utilisateurId: currentUser.id,
        dateFermeture: closureDate,
        soldeFinalTheorique: finalTheorique,
        soldeFinalReel: countedAmount,
        ecart: diff,
        notes: sessionNotes.trim() ? sessionNotes : (diff === 0 ? 'Clôture de caisse certifiée conforme sans anomalie.' : `Clôture avec écart de ${diff.toFixed(3)} DT.`)
      })
    }).catch(err => console.error("Erreur API clôture caisse:", err));

    fetch('/api/sessions-caisse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(closedSession)
    }).catch(err => console.error("Erreur save session fermée:", err));

    // Mémoriser la session clôturée pour l'affichage dans la boîte d'initialisation
    const closedData = {
      soldeFinal: countedAmount,
      soldeInitial: activeSession.soldeInitial,
      dateFermeture: closureDate,
      boutiqueId: activeSession.projetId,
      boutiqueNom: currentProject?.nom || 'Point de vente'
    };
    setLastClosedSession(closedData);
    try {
      localStorage.setItem('ugs_last_closed_session_' + currentUser.id, JSON.stringify(closedData));
      localStorage.setItem('ugs_last_closed_session', JSON.stringify(closedData));
      localStorage.setItem('ugs_closed_session_' + activeSession.id, 'true');
      localStorage.setItem('ugs_sessions_caisse', JSON.stringify(updatedSessions));
    } catch {}

    // Vider immédiatement le panier et réinitialiser les sélections POS
    setCart([]);
    setPosClientId('');
    setPosPaymentMode('Espèces');
    setPosRemise(0);
    broadcastCartUpdate([], '', 'Espèces', 'clear');

    // Fermer la modal de clôture
    setIsClosingModalOpen(false);
    setSessionNotes('');
    setClosingCountedCash('');
    
    // Réinitialiser les champs pour la nouvelle caisse
    setOpeningBalance(0);
    setOpeningNotes('');
    setSelectedOpeningBoutiqueId(activeSession.projetId);

    // Verrouiller localement pour afficher immédiatement l'interface d'ouverture dédiée permanente
    setSessionClosedLocally(true);
    setIsOpeningModalOpen(true);

    setPosSuccessMsg(`Caisse clôturée avec succès ! Solde certifié : ${countedAmount.toFixed(3)} DT. Le Ticket Z a été généré.`);
  };

  // Main view tab: POS Terminal vs Session History vs Journal (comptable defaults to audit journal)
  const isComptable = currentUser.role === 'comptable';
  const isSuperAdmin = currentUser.role === 'super_admin';
  const [activeTab, setActiveTab] = useState<'pos' | 'session_history' | 'journal'>(currentUser.role === 'comptable' ? 'journal' : 'pos');

  // POS State (BF-PROD-019 & BF-PROD-020)
  const [posSearchTerm, setPosSearchTerm] = useState('');
  const [posCategoryFilter, setPosCategoryFilter] = useState('all');
  const [posTypeFilter, setPosTypeFilter] = useState<'all' | 'Produit' | 'Service'>('all');
  const [posSortBy, setPosSortBy] = useState<'most_sold' | 'name_asc' | 'price_asc' | 'price_desc'>('most_sold');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [posClientId, setPosClientId] = useState<string>('');
  const [posPaymentMode, setPosPaymentMode] = useState<'Espèces' | 'Chèque' | 'Virement' | 'Traite'>('Espèces');
  const [posRemise, setPosRemise] = useState<number>(0);
  const [isCheckingOut, setIsCheckingOut] = useState<boolean>(false);
  const [posSuccessMsg, setPosSuccessMsg] = useState<string | null>(null);
  // Mobile active sub-tab for POS ('catalog' vs 'cart')
  const [posMobileTab, setPosMobileTab] = useState<'catalog' | 'cart'>('catalog');

  // Returns Management (Gestion des Retours)
  const [isPosReturnModalOpen, setIsPosReturnModalOpen] = useState(false);
  const [posReturnActiveTab, setPosReturnActiveTab] = useState<'nouveau' | 'historique'>('nouveau');
  const [posReturnType, setPosReturnType] = useState<'ticket' | 'libre'>('ticket');
  const [posReturnSelectedSaleId, setPosReturnSelectedSaleId] = useState<string>('');
  const [posReturnTicketSearch, setPosReturnTicketSearch] = useState<string>('');
  const [posReturnClientId, setPosReturnClientId] = useState<string>('');
  const [posReturnRefundMode, setPosReturnRefundMode] = useState<ModeRemboursement>('Espèces');
  const [posReturnMotif, setPosReturnMotif] = useState<string>('Retour article au comptoir');
  const [posReturnLines, setPosReturnLines] = useState<Array<{
    articleId: string;
    articleCode?: string;
    designation: string;
    quantiteVendue: number;
    quantiteRetournee: number;
    prixUnitaire: number; // Prix Unitaire TTC
    tauxTVA?: number;
    prixUnitaireHT?: number;
    motif: string;
    remettreEnStock: boolean;
  }>>([]);
  const [posViewingReturn, setPosViewingReturn] = useState<RetourVente | null>(null);
  const [selectedTicketVente, setSelectedTicketVente] = useState<Vente | null>(null);

  // Scanner Engine State (BF-PROD-020)
  const [scannerInput, setScannerInput] = useState('');
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isDouchetteModalOpen, setIsDouchetteModalOpen] = useState(false);
  const [douchetteInput, setDouchetteInput] = useState('');
  const [recentScans, setRecentScans] = useState<Article[]>([]);
  const douchetteInputRef = useRef<HTMLInputElement | null>(null);
  const [scannerFeedback, setScannerFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
    article?: Article;
  } | null>(null);

  // REAL-TIME POS CART SYNC (Smartphone <-> PC)
  const [syncStatus, setSyncStatus] = useState<'connected' | 'syncing' | 'offline'>('connected');
  const [syncNotification, setSyncNotification] = useState<{
    message: string;
    sourceDevice: 'smartphone' | 'desktop' | 'tablet';
    itemName?: string;
    timestamp: number;
  } | null>(null);

  const deviceId = useMemo(() => {
    let id = sessionStorage.getItem('pos_device_id');
    if (!id) {
      id = `dev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      sessionStorage.setItem('pos_device_id', id);
    }
    return id;
  }, []);

  const isMobileDevice = useMemo(() => {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent) || window.innerWidth < 1024;
  }, []);

  const syncKey = useMemo(() => {
    if (activeSession) return `session_${activeSession.id}`;
    return `user_${currentUser.id}_project_${selectedProjectId}`;
  }, [activeSession, currentUser.id, selectedProjectId]);

  const isRemoteUpdateRef = useRef(false);

  // Helper pour diffuser les mises à jour aux autres appareils
  const broadcastCartUpdate = useCallback((
    newCart: CartItem[], 
    newClientId?: string, 
    newPaymentMode?: string, 
    actionName?: string, 
    itemName?: string
  ) => {
    if (isRemoteUpdateRef.current) return;
    setSyncStatus('syncing');

    const payload = {
      syncKey,
      cart: newCart,
      posClientId: newClientId !== undefined ? newClientId : posClientId,
      posPaymentMode: newPaymentMode !== undefined ? newPaymentMode : posPaymentMode,
      lastAction: actionName || 'update',
      lastItemName: itemName || '',
      senderDeviceId: deviceId,
      deviceType: isMobileDevice ? 'smartphone' : 'desktop',
      updatedAt: Date.now()
    };

    // 1. Envoyer au serveur Express
    fetch('/api/caisse/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(() => setSyncStatus('connected'))
    .catch(() => setSyncStatus('connected'));

    // 2. Diffuser par BroadcastChannel pour les onglets/fenêtres locales
    try {
      const channel = new BroadcastChannel('pos_cart_sync_channel');
      channel.postMessage(payload);
      channel.close();
    } catch {}
  }, [syncKey, posClientId, posPaymentMode, deviceId, isMobileDevice]);


  // Web Audio Synth Beep feedback (BF-PROD-020)
  const playBeep = (type: 'success' | 'error' = 'success') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === 'success' ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(type === 'success' ? 1046.5 : 220, ctx.currentTime); // C6 or A3
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (type === 'success' ? 0.15 : 0.3));
    } catch {
      // Audio context may be restricted by browser policy
    }
  };

  // Real-Time SSE and BroadcastChannel Synchronizer
  useEffect(() => {
    if (!syncKey) return;

    // 1. Initial fetch from server
    fetch(`/api/caisse/sync/${syncKey}`)
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.cart) && data.cart.length > 0) {
          isRemoteUpdateRef.current = true;
          setCart(prev => prev.length === 0 ? data.cart : prev);
          if (data.posClientId) setPosClientId(data.posClientId);
          if (data.posPaymentMode) setPosPaymentMode(data.posPaymentMode);
          setTimeout(() => { isRemoteUpdateRef.current = false; }, 100);
        }
      })
      .catch(() => {});

    // 2. Server-Sent Events (SSE) Stream
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/caisse/stream/${syncKey}`);
      
      eventSource.onopen = () => {
        setSyncStatus('connected');
      };

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'sync' && parsed.payload) {
            const p = parsed.payload;
            if (p.senderDeviceId !== deviceId) {
              isRemoteUpdateRef.current = true;
              setCart(p.cart || []);
              if (p.posClientId !== undefined) setPosClientId(p.posClientId);
              if (p.posPaymentMode !== undefined) setPosPaymentMode(p.posPaymentMode);

              if (p.lastItemName) {
                setSyncNotification({
                  message: `Article scanné / ajouté depuis ${p.deviceType === 'smartphone' ? 'le smartphone 📱' : 'un autre poste 💻'} : "${p.lastItemName}"`,
                  sourceDevice: p.deviceType || 'smartphone',
                  itemName: p.lastItemName,
                  timestamp: Date.now()
                });
                playBeep('success');
              } else if (p.lastAction === 'checkout') {
                setSyncNotification({
                  message: `Encaissement validé sur un autre appareil. Le panier a été réinitialisé.`,
                  sourceDevice: p.deviceType || 'smartphone',
                  timestamp: Date.now()
                });
              }

              setTimeout(() => {
                isRemoteUpdateRef.current = false;
              }, 100);
            }
          }
        } catch (e) {
          console.error("Erreur de parsing SSE", e);
        }
      };

      eventSource.onerror = () => {
        setSyncStatus('syncing');
      };
    } catch (e) {
      console.error("SSE stream unavailable", e);
    }

    // 3. BroadcastChannel listener (inter-onglets instantané)
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('pos_cart_sync_channel');
      channel.onmessage = (event) => {
        const p = event.data;
        if (p && p.syncKey === syncKey && p.senderDeviceId !== deviceId) {
          isRemoteUpdateRef.current = true;
          setCart(p.cart || []);
          if (p.posClientId !== undefined) setPosClientId(p.posClientId);
          if (p.posPaymentMode !== undefined) setPosPaymentMode(p.posPaymentMode);
          if (p.lastItemName) {
            setSyncNotification({
              message: `Article scanné / ajouté depuis ${p.deviceType === 'smartphone' ? 'le smartphone 📱' : 'un autre écran 💻'} : "${p.lastItemName}"`,
              sourceDevice: p.deviceType || 'smartphone',
              itemName: p.lastItemName,
              timestamp: Date.now()
            });
            playBeep('success');
          }
          setTimeout(() => {
            isRemoteUpdateRef.current = false;
          }, 100);
        }
      };
    } catch {}

    // 3.5. Real-Time WebSocket Event Listener
    const handleWsCartUpdate = (e: any) => {
      const p = e.detail;
      if (p && p.syncKey === syncKey && p.senderDeviceId !== deviceId) {
        isRemoteUpdateRef.current = true;
        setCart(p.cart || []);
        if (p.posClientId !== undefined) setPosClientId(p.posClientId);
        if (p.posPaymentMode !== undefined) setPosPaymentMode(p.posPaymentMode);
        if (p.lastItemName) {
          setSyncNotification({
            message: `Article scanné / ajouté depuis ${p.deviceType === 'smartphone' ? 'le smartphone 📱' : 'un autre écran 💻'} : "${p.lastItemName}"`,
            sourceDevice: p.deviceType || 'smartphone',
            itemName: p.lastItemName,
            timestamp: Date.now()
          });
          playBeep('success');
        }
        setTimeout(() => {
          isRemoteUpdateRef.current = false;
        }, 100);
      }
    };
    window.addEventListener('pos_cart_update_ws', handleWsCartUpdate);

    // 4. Polling de secours toutes les 2.5 secondes
    const pollTimer = setInterval(() => {
      fetch(`/api/caisse/sync/${syncKey}`)
        .then(res => res.json())
        .then(p => {
          if (p && p.senderDeviceId && p.senderDeviceId !== deviceId && p.updatedAt && (Date.now() - p.updatedAt < 4000)) {
            isRemoteUpdateRef.current = true;
            setCart(p.cart || []);
            if (p.posClientId !== undefined) setPosClientId(p.posClientId);
            if (p.posPaymentMode !== undefined) setPosPaymentMode(p.posPaymentMode);
            setTimeout(() => {
              isRemoteUpdateRef.current = false;
            }, 100);
          }
        })
        .catch(() => {});
    }, 2500);

    return () => {
      window.removeEventListener('pos_cart_update_ws', handleWsCartUpdate);
      if (eventSource) eventSource.close();
      if (channel) channel.close();
      clearInterval(pollTimer);
    };
  }, [syncKey, deviceId]);

  // Auto-dismiss sync notification after 5s
  useEffect(() => {
    if (syncNotification) {
      const t = setTimeout(() => setSyncNotification(null), 5000);
      return () => clearTimeout(t);
    }
  }, [syncNotification]);

  // Journal Filters State

  const [filterType, setFilterType] = useState<'all' | 'Encaissement' | 'Décaissement'>('all');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal: New Cash Movement
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newType, setNewType] = useState<'Encaissement' | 'Décaissement'>('Encaissement');
  const [newTierType, setNewTierType] = useState<'Client' | 'Fournisseur' | 'Autre'>('Client');
  const [newTierId, setNewTierId] = useState('');
  const [newMontant, setNewMontant] = useState<number>(0);
  const [newMode, setNewMode] = useState<'Espèces' | 'Chèque' | 'Virement' | 'Traite'>('Espèces');
  const [newBanque, setNewBanque] = useState('Caisse Centrale');
  const [newRef, setNewRef] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const isGlobal = selectedProjectId === '1' || selectedProjectId === 'all';
  const currentProject = selectedProjectId === 'all' ? null : projets.find(p => p.id === selectedProjectId);
  const isCentralUgs = selectedProjectId === '1' || currentProject?.codeBoutique === 'ERP Management-CENTRALE' || (currentProject?.nom ? currentProject.nom.toLowerCase().includes('stock central') : false);

  const retailBoutiques = useMemo(() => {
    return projets.filter(p => p.id !== '1' && p.codeBoutique !== 'ERP Management-CENTRALE' && !p.nom.toLowerCase().includes('stock central'));
  }, [projets]);

  // Scoped Data
  const scopedReglements = useMemo(() => {
    return isGlobal ? reglements : reglements.filter(r => r.projetId === selectedProjectId);
  }, [reglements, isGlobal, selectedProjectId]);

  const scopedClients = useMemo(() => isGlobal ? clients : clients.filter(c => c.projetId === selectedProjectId), [clients, isGlobal, selectedProjectId]);
  const scopedFournisseurs = useMemo(() => isGlobal ? fournisseurs : fournisseurs.filter(f => f.projetId === selectedProjectId), [fournisseurs, isGlobal, selectedProjectId]);

  const scopedArticles = useMemo(() => {
    const list = articles.filter(a => isArticleInProject(a, selectedProjectId));
    return list.filter(a => a.statut !== 'Inactif');
  }, [articles, selectedProjectId]);

  const getDefaultCart = (): CartItem[] => {
    return [];
  };

  useEffect(() => {
    setCart([]);
  }, [selectedProjectId]); // Reset cart to empty when project changes

  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== 'all' && selectedProjectId !== '1') {
      setSelectedOpeningBoutiqueId(selectedProjectId);
    } else if (currentUser.projetId && currentUser.projetId !== 'all' && currentUser.projetId !== '1') {
      setSelectedOpeningBoutiqueId(currentUser.projetId);
    } else if (retailBoutiques.length > 0) {
      setSelectedOpeningBoutiqueId(retailBoutiques[0].id);
    }
  }, [selectedProjectId, currentUser.projetId, retailBoutiques]);

  const handleCancelPosSale = () => {
    setCart([]);
    setPosClientId('');
    setPosPaymentMode('Espèces');
    setPosRemise(0);
    setPosSuccessMsg(null);
    broadcastCartUpdate([], '', 'Espèces', 'clear');
  };

  // Categories list
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    scopedArticles.forEach(a => {
      if (a.famille) set.add(a.famille);
      if (a.categorie) set.add(a.categorie);
    });
    return Array.from(set);
  }, [scopedArticles]);

  // POS Filtered Articles
  const articleSalesCount = useMemo(() => {
    const counts: Record<string, number> = {};
    ventes.forEach(vente => {
      // Consider all sales for the frequency
      vente.lignes?.forEach(ligne => {
        if (ligne.articleId) {
          counts[ligne.articleId] = (counts[ligne.articleId] || 0) + ligne.quantite;
        }
      });
    });
    return counts;
  }, [ventes]);

  const filteredPosArticles = useMemo(() => {
    const result = scopedArticles.filter(a => {
      const q = posSearchTerm.toLowerCase().trim();
      const matchesSearch = !q || 
        a.designation.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        (a.codeBarres && a.codeBarres.some(cb => cb.toLowerCase().includes(q))) ||
        (a.famille && a.famille.toLowerCase().includes(q));

      const matchesCat = posCategoryFilter === 'all' || a.famille === posCategoryFilter || a.categorie === posCategoryFilter;
      const matchesType = posTypeFilter === 'all' || (a.typeArticle || 'Produit') === posTypeFilter;
      return matchesSearch && matchesCat && matchesType;
    });

    result.sort((a, b) => {
      if (posSortBy === 'most_sold') {
        const countA = articleSalesCount[a.id] || 0;
        const countB = articleSalesCount[b.id] || 0;
        if (countA !== countB) return countB - countA;
        return a.designation.localeCompare(b.designation);
      }
      if (posSortBy === 'name_asc') return a.designation.localeCompare(b.designation);
      if (posSortBy === 'price_asc') return (a.prixVenteHT || 0) - (b.prixVenteHT || 0);
      if (posSortBy === 'price_desc') return (b.prixVenteHT || 0) - (a.prixVenteHT || 0);
      return 0;
    });

    return result;
  }, [scopedArticles, posSearchTerm, posCategoryFilter, posTypeFilter, posSortBy, articleSalesCount]);

  // POS Cart Calculations (TVA incluse, timbre fiscal à 0)
  const cartTotalHT = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.quantite * (item.prixVenteHT || 0)), 0);
  }, [cart]);

  const cartTotalTVA = useMemo(() => {
    return cart.reduce((sum, item) => {
      const tvaPercent = item.article.tva ?? 19;
      return sum + (item.quantite * (item.prixVenteHT || 0) * (tvaPercent / 100));
    }, 0);
  }, [cart]);

  const posTimbreFiscal = 0; // Sans timbre fiscal
  const baseTTC = cartTotalHT + cartTotalTVA;
  const discountAmount = baseTTC * ((posRemise || 0) / 100);
  const cartTotalTTC = Math.max(0, baseTTC - discountAmount);

  // Add Article to POS Cart (BF-PROD-019 avec application stricte des règles de stock)
  const handleAddToCart = (article: Article, initialQty: number = 1) => {
    const storeId = selectedProjectId === 'all' ? '1' : selectedProjectId;
    const currentBoutiqueNom = currentProject?.nom || 'la boutique';
    
    if (article.typeArticle !== 'Service') {
      const availStock = getArticleStock(article, storeId);
      const existing = cart.find(item => item.article.id === article.id);
      const totalWanted = (existing ? existing.quantite : 0) + initialQty;

      if (availStock <= 0) {
        playBeep('error');
        alert(`🔴 RUPTURE DE STOCK (RÈGLE STRICTE) :\nLe produit "${article.designation}" est en rupture (stock disponible = 0) dans ${currentBoutiqueNom}.\nImpossible de l'ajouter au panier.`);
        return;
      }
      if (totalWanted > availStock) {
        playBeep('error');
        alert(`⚠️ STOCK INSUFFISANT (RÈGLE STRICTE) :\nLe stock disponible pour "${article.designation}" est de ${availStock} unité(s) dans ${currentBoutiqueNom}.\nVous avez déjà ${existing ? existing.quantite : 0} dans le panier.`);
        return;
      }
    }

    setCart(prev => {
      let updated: CartItem[];
      const existingIndex = prev.findIndex(item => item.article.id === article.id);
      if (existingIndex >= 0) {
        updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantite: updated[existingIndex].quantite + initialQty
        };
      } else {
        updated = [...prev, { article, quantite: initialQty, prixVenteHT: article.prixVenteHT || 0 }];
      }
      broadcastCartUpdate(updated, undefined, undefined, 'add_item', article.designation);
      return updated;
    });
  };

  const handleUpdateCartQty = (articleId: string, delta: number) => {
    if (delta > 0) {
      const storeId = selectedProjectId === 'all' ? '1' : selectedProjectId;
      const targetItem = cart.find(ci => ci.article.id === articleId);
      if (targetItem && targetItem.article.typeArticle !== 'Service') {
        const availStock = getArticleStock(targetItem.article, storeId);
        if (targetItem.quantite + delta > availStock) {
          playBeep('error');
          alert(`⚠️ STOCK INSUFFISANT (RÈGLE STRICTE) : Le stock disponible pour "${targetItem.article.designation}" est limité à ${availStock} unité(s).`);
          return;
        }
      }
    }
    setCart(prev => {
      const updated = prev.map(item => {
        if (item.article.id === articleId) {
          const newQ = item.quantite + delta;
          return newQ > 0 ? { ...item, quantite: newQ } : null;
        }
        return item;
      }).filter(Boolean) as CartItem[];
      broadcastCartUpdate(updated, undefined, undefined, 'update_qty');
      return updated;
    });
  };

  const handleSetCartQty = (articleId: string, exactQty: number) => {
    if (exactQty > 0) {
      const storeId = selectedProjectId === 'all' ? '1' : selectedProjectId;
      const targetItem = cart.find(ci => ci.article.id === articleId);
      if (targetItem && targetItem.article.typeArticle !== 'Service') {
        const availStock = getArticleStock(targetItem.article, storeId);
        if (exactQty > availStock) {
          playBeep('error');
          alert(`⚠️ STOCK INSUFFISANT (RÈGLE STRICTE) : Le stock disponible pour "${targetItem.article.designation}" est limité à ${availStock} unité(s).`);
          return;
        }
      }
    }
    setCart(prev => {
      let updated: CartItem[];
      if (exactQty <= 0) {
        updated = prev.filter(item => item.article.id !== articleId);
      } else {
        updated = prev.map(item => item.article.id === articleId ? { ...item, quantite: exactQty } : item);
      }
      broadcastCartUpdate(updated, undefined, undefined, 'set_qty');
      return updated;
    });
  };

  const handleRemoveFromCart = (articleId: string) => {
    setCart(prev => {
      const updated = prev.filter(item => item.article.id !== articleId);
      broadcastCartUpdate(updated, undefined, undefined, 'remove_item');
      return updated;
    });
  };


  // Process Scanner Barcode / QR Code Pipeline
  // Flow: SCAN -> Code-barres -> Recherche produit -> Produit identifié -> Vérification disponibilité -> Ajout panier
  const handleProcessScan = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    // 1. SCAN & 2. Code-barres
    // 3. Recherche produit in scopedArticles or global articles
    let found = scopedArticles.find(a => 
      (a.codeBarres && a.codeBarres.some(cb => cb.trim() === code)) ||
      a.code.trim().toLowerCase() === code.toLowerCase() ||
      a.id.trim().toLowerCase() === code.toLowerCase() ||
      (a.referenceInterne && a.referenceInterne.trim().toLowerCase() === code.toLowerCase())
    );

    // Fallback search in all articles
    if (!found) {
      found = articles.find(a => 
        (a.codeBarres && a.codeBarres.some(cb => cb.trim() === code)) ||
        a.code.trim().toLowerCase() === code.toLowerCase()
      );
    }

    // 4. Produit identifié
    if (!found) {
      playBeep('error');
      setScannerFeedback({
        type: 'error',
        message: `❌ Produit non identifié pour le code [${code}]. Aucun produit correspondant trouvé dans le catalogue.`
      });
      setScannerInput('');
      return;
    }

    // 5. Vérification disponibilité
    const currentBoutiqueNom = currentProject?.nom || 'Global';
    const storeId = selectedProjectId === 'all' ? 'p1' : selectedProjectId;
    const availableStock = getArticleStock(found, storeId);

    if (found.statut === 'Inactif') {
      playBeep('error');
      setScannerFeedback({
        type: 'warning',
        message: `Produit inactif ! Le produit "${found.designation}" (${found.code}) est actuellement désactivé.`,
        article: found
      });
      setScannerInput('');
      return;
    }

    if (found.typeArticle !== 'Service') {
      if (availableStock <= 0) {
        playBeep('error');
        setScannerFeedback({
          type: 'warning',
          message: `Stock épuisé ! Le produit "${found.designation}" (Prix: ${found.prixVenteHT} DT) est actuellement indisponible dans ${currentBoutiqueNom} (Stock : 0).`,
          article: found
        });
        setScannerInput('');
        return;
      }

      // Check availability against items already in cart
      const cartMatch = cart.find(ci => ci.article.id === found.id);
      const qtyInCart = cartMatch ? cartMatch.quantite : 0;
      if (qtyInCart + 1 > availableStock) {
        playBeep('error');
        setScannerFeedback({
          type: 'warning',
          message: `Stock insuffisant ! Seules ${availableStock} unités de "${found.designation}" sont disponibles en stock dans ${currentBoutiqueNom} (${qtyInCart} déjà dans le panier).`,
          article: found
        });
        setScannerInput('');
        return;
      }
    }

    // 6. Ajout automatique panier
    handleAddToCart(found, 1);
    setPosMobileTab('cart');
    playBeep('success');
    setScannerFeedback({
      type: 'success',
      message: `⚡ SCAN RÉUSSI [${code}] ➔ "${found.designation}" (Prix: ${found.prixVenteHT.toFixed(3)} DT | Stock: ${found.stock}) AJOUTÉ AUTOMATIQUEMENT AU PANIER !`,
      article: found
    });
    setScannerInput('');
  };

  // Submit POS Sale — transaction atomique côté serveur (vente + stock + mouvements + règlement)
  const handleCheckoutPosSale = async () => {
    if (cart.length === 0 || isCheckingOut) return;

    const storeId = selectedProjectId === 'all' ? '1' : selectedProjectId;
    const currentBoutiqueNom = currentProject?.nom || 'la boutique';

    // RÈGLE STRICTE : aucune vente sans session de caisse ouverte
    if (!activeSession) {
      playBeep('error');
      alert("🔒 ENCAISSEMENT BLOQUÉ :\nAucune session de caisse ouverte. Veuillez initialiser la caisse avant d'encaisser.");
      return;
    }

    // RÈGLES STRICTES : contrôle préalable des stocks (le serveur revérifie sous verrou)
    for (const item of cart) {
      if (item.article.typeArticle !== 'Service') {
        const availStock = getArticleStock(item.article, storeId);
        if (availStock <= 0) {
          playBeep('error');
          alert(`🔴 ACTION STRICTEMENT BLOQUÉE (RÈGLE STRICTE) :\nLe produit "${item.article.designation}" est en rupture complète de stock dans ${currentBoutiqueNom} (Stock = 0).\n\nImpossible de finaliser la vente.`);
          return;
        }
        if (item.quantite > availStock) {
          playBeep('error');
          alert(`⚠️ ACTION STRICTEMENT BLOQUÉE (RÈGLE STRICTE) :\nPour "${item.article.designation}", la quantité demandée (${item.quantite}) dépasse le stock disponible (${availStock}) dans ${currentBoutiqueNom}.\n\nVeuillez ajuster le panier.`);
          return;
        }
      }
    }

    setIsCheckingOut(true);
    try {
      const res = await fetch('/api/caisse/encaisser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projetId: activeSession.projetId || storeId,
          sessionId: activeSession.id,
          auteurId: currentUser.id,
          auteurNom: currentUser.nom,
          modePaiement: posPaymentMode || 'Espèces',
          remisePourcentage: posRemise || 0,
          lignes: cart.map(item => ({
            articleId: item.article.id,
            quantite: item.quantite,
            designation: item.article.designation,
            typeArticle: item.article.typeArticle || 'Produit',
            prixUnitaireHT: item.prixVenteHT,
            tva: item.article.tva ?? 19
          }))
        })
      });

      let data: any = null;
      try { data = await res.json(); } catch {}

      if (!res.ok || !data?.success || !data?.vente) {
        playBeep('error');
        alert(`❌ ENCAISSEMENT NON ENREGISTRÉ :\n${data?.error || `Erreur serveur (${res.status}).`}\n\nLe panier a été conservé. Aucune vente ni mouvement de stock n'a été créé.`);
        return;
      }

      const savedSale: Vente = data.vente;
      onPosSaleRecorded?.(data);

      // Affiche automatiquement le ticket et la fiche de détails de vente
      setSelectedTicketVente(savedSale);

      logAction(`Vente ${savedSale.numero}`, 'Vente', savedSale.montantTTC, `Vente à ${savedSale.clientNom}`);
      playBeep('success');
      setPosSuccessMsg(
        `Vente ${savedSale.numero} enregistrée (${savedSale.montantTTC.toFixed(3)} DT) ! Stock et mouvements mis à jour.`
      );
      setCart([]);
      setPosRemise(0);
      setTimeout(() => setPosSuccessMsg(null), 5000);
    } catch (err: any) {
      playBeep('error');
      alert(`❌ CONNEXION IMPOSSIBLE AU SERVEUR :\n${err?.message || err}\n\nLa vente n'a PAS été enregistrée. Le panier a été conservé, veuillez réessayer.`);
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Retours Scoped List & Sales
  const scopedRetours = useMemo(() => {
    return retours.filter(r => selectedProjectId === 'all' || r.projetId === selectedProjectId);
  }, [retours, selectedProjectId]);

  const posAvailableSales = useMemo(() => {
    return ventes.filter(v => {
      if (selectedProjectId !== 'all' && v.projetId && v.projetId !== selectedProjectId) return false;
      if (posReturnTicketSearch) {
        const q = posReturnTicketSearch.toLowerCase();
        return (
          v.numero.toLowerCase().includes(q) ||
          (v.clientNom && v.clientNom.toLowerCase().includes(q))
        );
      }
      return true;
    }).slice(0, 30);
  }, [ventes, selectedProjectId, posReturnTicketSearch]);

  const handlePosSelectSale = (sale: Vente) => {
    setPosReturnSelectedSaleId(sale.id);
    setPosReturnClientId(sale.clientId);
    if (sale.lignes && sale.lignes.length > 0) {
      setPosReturnLines(sale.lignes.map(l => {
        const qte = l.quantite || 1;
        let prixUnitaireTTC = 0;
        if (typeof l.totalTTC === 'number' && l.totalTTC > 0 && qte > 0) {
          prixUnitaireTTC = Number((l.totalTTC / qte).toFixed(3));
        } else {
          const tvaRate = l.tauxTVA ?? l.tva ?? 19;
          const remisePct = l.remisePourcentage ?? l.remise ?? 0;
          const puHT = l.prixUnitaireHT || 0;
          prixUnitaireTTC = Number((puHT * (1 + tvaRate / 100) * (1 - remisePct / 100)).toFixed(3));
        }
        if (prixUnitaireTTC <= 0 && l.prixUnitaireHT) {
          prixUnitaireTTC = Number((l.prixUnitaireHT * 1.19).toFixed(3));
        }

        return {
          articleId: l.articleId,
          articleCode: l.code || '',
          designation: l.designation,
          quantiteVendue: l.quantite,
          quantiteRetournee: 0,
          prixUnitaire: prixUnitaireTTC,
          tauxTVA: l.tauxTVA ?? l.tva ?? 19,
          prixUnitaireHT: l.prixUnitaireHT,
          motif: 'Changement d\'avis',
          remettreEnStock: true
        };
      }));
    } else {
      setPosReturnLines([]);
    }
  };

  const handlePosSubmitReturn = (e: React.FormEvent) => {
    e.preventDefault();
    const activeLines = posReturnLines.filter(l => l.quantiteRetournee > 0);
    if (activeLines.length === 0) {
      alert('Veuillez sélectionner au moins un article avec une quantité supérieure à 0.');
      return;
    }

    const calculatedTotal = activeLines.reduce((acc, l) => acc + (l.quantiteRetournee * l.prixUnitaire), 0);
    const targetClient = clients.find(c => c.id === posReturnClientId) || { id: 'c-walkin', nom: 'Client Comptoir' };
    const storeId = selectedProjectId === 'all' ? (projets[0]?.id || 'p1') : selectedProjectId;
    const storeNom = currentProject?.nom || 'Boutique';
    const now = new Date();
    const dateFormatted = `${now.toISOString().split('T')[0]} ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const returnNumber = `RET-${now.getFullYear()}-${(retours.length + 1).toString().padStart(4, '0')}`;
    const codeAvoir = posReturnRefundMode === 'Avoir' ? `AVR-${now.getFullYear()}-${(retours.filter(r => r.codeAvoir).length + 1).toString().padStart(4, '0')}` : undefined;

    const sourceSale = ventes.find(v => v.id === posReturnSelectedSaleId);

    // Stock updates & movements
    const newStockMovements: MouvementStock[] = [];
    if (onArticlesChange) {
      let updatedArticlesList = [...articles];
      activeLines.forEach(line => {
        if (line.remettreEnStock) {
          const art = updatedArticlesList.find(a => a.id === line.articleId);
          if (art && art.typeArticle !== 'Service') {
            const stockAvant = getArticleStock(art, storeId);
            const updatedArt = updateArticleStock(art, storeId, line.quantiteRetournee);
            const stockApres = getArticleStock(updatedArt, storeId);
            updatedArticlesList = updatedArticlesList.map(a => a.id === art.id ? updatedArt : a);

            const mvt = createGuaranteedStockMovement({
              article: art,
              projetId: storeId,
              projetNom: storeNom,
              type: 'ENTRÉE',
              quantite: line.quantiteRetournee,
              quantiteAvant: stockAvant,
              quantiteApres: stockApres,
              motif: `Retour caisse (${returnNumber}) - ${line.motif}`,
              currentUser,
              referencePiece: returnNumber
            });
            newStockMovements.push(mvt);
          }
        }
      });
      onArticlesChange(updatedArticlesList);
      if (onMouvementsChange && newStockMovements.length > 0) {
        onMouvementsChange([...newStockMovements, ...mouvements]);
      }
    }

    // Décaissement for cash refund
    let newRegId: string | undefined = undefined;
    if (posReturnRefundMode === 'Espèces' && calculatedTotal > 0) {
      const regId = `reg-ret-${Date.now()}`;
      newRegId = regId;
      const decaissementReg: Reglement = {
        id: regId,
        projetId: storeId,
        numeroPiece: `DEC-${Date.now().toString().slice(-6)}`,
        type: 'Décaissement',
        tierId: targetClient.id,
        tierNom: targetClient.nom,
        tierType: 'Client',
        documentRef: returnNumber,
        date: now.toISOString().split('T')[0],
        dateReglement: now.toISOString(),
        ...(activeSession ? { sessionId: activeSession.id } : {}),
        montant: calculatedTotal,
        modePaiement: 'Espèces',
        banque: 'Caisse Centrale',
        referencePaiement: `Remboursement Retour ${returnNumber}`,
        notes: `Remboursement immédiat comptoir suite au retour de vente ${sourceSale ? sourceSale.numero : 'direct'}`,
        statut: 'Validé'
      };
      onReglementsChange([decaissementReg, ...reglements]);
    }

    // Log in register action logs
    logAction(`Retour ${returnNumber}`, 'Ajustement', calculatedTotal, `Remboursement (${posReturnRefundMode})`);

    const linesPayload: LigneRetourVente[] = activeLines.map(l => {
      const puTTC = l.prixUnitaire;
      const tvaRate = l.tauxTVA ?? 19;
      const puHT = l.prixUnitaireHT || Number((puTTC / (1 + tvaRate / 100)).toFixed(3));
      const totTTC = Number((l.quantiteRetournee * puTTC).toFixed(3));
      const totHT = Number((l.quantiteRetournee * puHT).toFixed(3));
      const totTVA = Number((totTTC - totHT).toFixed(3));

      return {
        articleId: l.articleId,
        articleCode: l.articleCode,
        designation: l.designation,
        quantiteVendue: l.quantiteVendue,
        quantiteRetournee: l.quantiteRetournee,
        prixUnitaire: puTTC,
        totalLigne: totTTC,
        tauxTVA: tvaRate,
        prixUnitaireHT: puHT,
        totalHT: totHT,
        totalTVA: totTVA,
        motif: l.motif,
        remettreEnStock: l.remettreEnStock
      };
    });

    const newReturn: RetourVente = {
      id: `ret-${Date.now()}`,
      sessionId: activeSession ? activeSession.id : undefined,
      numero: returnNumber,
      type: posReturnType === 'ticket' ? 'Vente Caisse' : 'Retour Libre',
      venteId: sourceSale?.id,
      venteNumero: sourceSale?.numero,
      clientId: targetClient.id,
      clientNom: targetClient.nom,
      projetId: storeId,
      projetNom: storeNom,
      date: dateFormatted,
      lignes: linesPayload,
      montantTotal: calculatedTotal,
      modeRemboursement: posReturnRefundMode,
      codeAvoir,
      statut: 'Validé',
      motifGeneral: posReturnMotif,
      auteurId: currentUser.id,
      auteurNom: currentUser.nom,
      reglementId: newRegId,
      mouvementStockIds: newStockMovements.map(m => m.id)
    };

    if (onRetoursChange) {
      onRetoursChange([newReturn, ...retours]);
    }

    setIsPosReturnModalOpen(false);
    setPosSuccessMsg(`Retour ${returnNumber} validé avec succès (${calculatedTotal.toFixed(3)} DT) ! Stock réintégré.`);
  };

  // Journal Filtered List
  const filteredReglements = useMemo(() => {
    return scopedReglements.filter(r => {
      const matchesSearch = r.numeroPiece.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            r.tierNom.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (r.documentRef && r.documentRef.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesType = filterType === 'all' || r.type === filterType;
      const matchesMode = filterMode === 'all' || r.modePaiement === filterMode;
      return matchesSearch && matchesType && matchesMode;
    });
  }, [scopedReglements, searchTerm, filterType, filterMode]);

  // Financial Totals
  const totalEncaissements = scopedReglements.filter(r => r.type === 'Encaissement').reduce((a, r) => a + r.montant, 0);
  const totalDecaissements = scopedReglements.filter(r => r.type === 'Décaissement').reduce((a, r) => a + r.montant, 0);
  const soldeNetCaisse = totalEncaissements - totalDecaissements;

  // Open Create Movement Modal
  const handleOpenCreate = () => {
    setNewType('Encaissement');
    setNewTierType('Client');
    setNewTierId(scopedClients[0]?.id || '');
    setNewMontant(0);
    setNewMode('Espèces');
    setNewBanque('Caisse Centrale');
    setNewRef(`PC-${Date.now().toString().slice(-4)}`);
    setNewNotes('Opération de trésorerie courante');
    setIsModalOpen(true);
  };

  // Submit Create Movement
  const handleSaveMovement = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMontant <= 0) return;

    let tierNom = 'Divers';
    if (newTierType === 'Client') {
      const c = scopedClients.find(cli => cli.id === newTierId);
      if (c) tierNom = c.nom;
    } else if (newTierType === 'Fournisseur') {
      const f = scopedFournisseurs.find(fou => fou.id === newTierId);
      if (f) tierNom = f.nom;
    }

    const year = new Date().getFullYear();
    const count = reglements.length + 1;
    const prefix = newType === 'Encaissement' ? 'ENC' : 'DEC';
    const numeroPiece = `${prefix}-${year}-${count.toString().padStart(4, '0')}`;

    const newReg: Reglement = {
      id: `reg-${Date.now()}`,
      projetId: isGlobal ? (projets[0]?.id || 'p1') : selectedProjectId,
      numeroPiece,
      type: newType,
      tierId: newTierId,
      tierNom,
      tierType: newTierType,
      date: new Date().toISOString().split('T')[0],
      dateReglement: new Date().toISOString(),
      ...(activeSession ? { sessionId: activeSession.id } : {}),
      montant: newMontant,
      modePaiement: newMode,
      banque: newBanque,
      referencePaiement: newRef,
      notes: newNotes,
      statut: 'Validé'
    };

    onReglementsChange([newReg, ...reglements]);
    setIsModalOpen(false);
  };

  if (isCentralUgs) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-4 sm:p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
        <div className="w-24 h-24 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shadow-2xl border-4 border-white shrink-0">
          <span className="material-symbols-outlined text-[48px]">warehouse</span>
        </div>

        <div className="text-center space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
            ERP Management • Société UGS
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Pas de Vente Directe à la Société UGS</h1>
          
        </div>

        {/* Option to select a retail boutique POS */}
        <div className="w-full bg-white p-6 sm:p-8 rounded-xl border border-slate-200 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-purple-600 text-[24px]">storefront</span>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Boutiques & Points de Vente</h3>
                
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {retailBoutiques.map(boutique => (
              <div 
                key={boutique.id} 
                className="p-5 bg-slate-50 hover:bg-purple-50/60 border-2 border-slate-200 hover:border-purple-300 rounded-xl transition-all flex flex-col justify-between space-y-4 group"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-800 font-extrabold text-[10px] rounded-md uppercase tracking-wider">
                      {boutique.codeBoutique}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Active
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm group-hover:text-purple-900 transition-colors">{boutique.nom}</h4>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{boutique.adresse}, {boutique.ville}</p>
                </div>

                <button
                  onClick={() => {
                    if (onSelectProject) onSelectProject(boutique.id);
                    setSelectedOpeningBoutiqueId(boutique.id);
                    setIsOpeningModalOpen(true);
                  }}
                  className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">point_of_sale</span>
                  Ouvrir Caisse {boutique.nom}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // INTERFACE DÉDIÉE PERMANENTE D'OUVERTURE DE CAISSE
  // Tant que le caissier n'a pas ouvert une nouvelle caisse, cette interface reste toujours affichée
  if (!activeSession && !isComptable) {
    const targetStore = retailBoutiques.find(b => b.id === selectedOpeningBoutiqueId) || currentProject || retailBoutiques[0];

    return (
      <div className="flex flex-col items-center justify-center min-h-[75vh] p-4 sm:p-6 space-y-6 animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-purple-700 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-purple-600/30">
          <span className="material-symbols-outlined text-[44px]">point_of_sale</span>
        </div>

        <div className="text-center space-y-1.5 max-w-lg">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Ouverture de Session de Caisse
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            La caisse est actuellement fermée. Veuillez écrire le montant initial (fond de caisse) pour ouvrir la session et commencer les encaissements.
          </p>
        </div>

        {/* Notification si une caisse vient d'être clôturée */}
        {lastClosedSession && (
          <div className="w-full max-w-lg p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3 shadow-xs">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[22px]">verified</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-emerald-950">Session précédente clôturée avec succès</span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                  Fermée
                </span>
              </div>
              <p className="text-[11px] text-emerald-800 mt-1">
                Solde final certifié : <strong className="font-mono text-emerald-950 font-bold">{lastClosedSession.soldeFinal.toFixed(3)} DT</strong> • {lastClosedSession.boutiqueNom}
              </p>
              {lastClosedSession.soldeInitial > 0 && (
                <button
                  type="button"
                  onClick={() => setOpeningBalance(lastClosedSession.soldeInitial)}
                  className="mt-2 text-[11px] font-bold text-emerald-800 hover:text-emerald-950 underline flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">replay</span>
                  Reprendre le fond initial précédent ({lastClosedSession.soldeInitial.toFixed(3)} DT)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Carte de saisie du montant initial et ouverture */}
        <div className="w-full max-w-lg bg-white p-6 sm:p-8 rounded-2xl border-2 border-slate-200/90 shadow-2xl space-y-6">
          {/* Infos Caissier et Boutique */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Caissier(ère)</span>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {currentUser.nom.charAt(0)}
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-slate-900 truncate">{currentUser.nom}</p>
                  <p className="text-[10px] text-purple-600 font-semibold uppercase">{currentUser.role}</p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Point de Vente</span>
              {retailBoutiques.length > 1 ? (
                <select
                  value={selectedOpeningBoutiqueId}
                  onChange={(e) => setSelectedOpeningBoutiqueId(e.target.value)}
                  className="w-full text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg p-1.5 focus:outline-none focus:border-purple-600"
                >
                  {retailBoutiques.map(b => (
                    <option key={b.id} value={b.id}>{b.nom} ({b.codeBoutique})</option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <span className="material-symbols-outlined text-[16px] text-indigo-500">store</span>
                  <span className="truncate">{targetStore?.nom || 'Boutique'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Saisie du Fond de Caisse Initial */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider text-center">
              Fond de Caisse Initial (Montant en Espèces)
            </label>
            
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.001"
                value={openingBalance || ''}
                onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
                placeholder="0.000"
                className="w-full px-4 py-4 bg-purple-50/50 border-2 border-purple-300 rounded-2xl text-3xl font-black text-slate-900 focus:outline-none focus:border-purple-600 focus:bg-white text-center font-mono transition-all"
                autoFocus
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-purple-600 text-lg">
                DT
              </span>
            </div>

            {/* Présélections rapides de montants */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-center">
                Montants usuels rapides :
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {[0, 50, 100, 150, 200, 300, 400, 500].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setOpeningBalance(preset)}
                    className={`py-1.5 px-2 rounded-lg font-mono text-xs font-bold border transition-all cursor-pointer ${
                      openingBalance === preset
                        ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 hover:bg-purple-50 border-slate-200'
                    }`}
                  >
                    {preset.toFixed(3)}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {[10, 20, 50, 100].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setOpeningBalance(prev => +(prev + step).toFixed(3))}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-md transition-colors cursor-pointer"
                  >
                    +{step} DT
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setOpeningBalance(0)}
                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[10px] rounded-md transition-colors cursor-pointer"
                >
                  Effacer (0 DT)
                </button>
              </div>
            </div>
          </div>

          {/* Remarques / Observations d'ouverture */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Remarques / Observations d'ouverture (facultatif)
            </label>
            <input
              type="text"
              value={openingNotes}
              onChange={(e) => setOpeningNotes(e.target.value)}
              placeholder="Ex: Tiroir vérifié conforme, monnaie suffisante..."
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-purple-600"
            />
          </div>

          {/* Bouton d'action obligatoire */}
          <button
            type="button"
            onClick={() => handleOpenSession(selectedOpeningBoutiqueId)}
            className="w-full py-4.5 px-6 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white font-black text-base rounded-xl shadow-xl shadow-purple-600/30 transition-all hover:scale-[1.01] active:scale-95 flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[24px]">key</span>
            <span>OUVRIR LA NOUVELLE CAISSE ({openingBalance.toFixed(3)} DT)</span>
          </button>
        </div>
      </div>
    );
  }



  return (
    <div className="space-y-6">
      {/* Header & Main Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-6 rounded-xl border border-slate-200/80 shadow-sm">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold shadow-xs shrink-0">
              <span className="material-symbols-outlined text-[22px]">
                {isComptable ? 'verified_user' : 'point_of_sale'}
              </span>
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">
                {isComptable ? 'Audit des Caisses & Contrôle Financier' : 'Caisse & Ventes'}
              </h1>
              {isComptable ? (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-purple-200">
                    <span className="material-symbols-outlined text-[12px]">visibility</span>
                    Mode Audit & Contrôle (Lecture Seule)
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Consultation des sessions, clôtures (Tickets Z) et flux de trésorerie
                  </span>
                </div>
              ) : activeSession ? (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    <span className="animate-pulse w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Caisse Ouverte
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    depuis {new Date(activeSession.dateOuverture).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-amber-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                    Caisse Non Initialisée
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsOpeningModalOpen(true)}
                    className="text-[11px] font-bold text-purple-700 hover:text-purple-900 underline flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">key</span>
                    Initialiser la caisse
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/80">
          {!isComptable && (
            <button
              type="button"
              onClick={() => setActiveTab('pos')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'pos'
                  ? 'bg-white text-purple-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[17px]">point_of_sale</span>
              <span>Terminal POS</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('session_history')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'session_history'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">receipt_long</span>
            <span>Historique Ventes (Session)</span>
            {sessionSales.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-purple-100 text-purple-800 text-[10px] font-black rounded-full">
                {sessionSales.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('journal')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'journal'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">fact_check</span>
            <span>Journal & Clôtures (Tickets Z)</span>
          </button>
        </div>
      </div>



      {/* POS TERMINAL TAB */}
      {activeTab === 'pos' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          
          {/* Bandeau d'avertissement lorsque la caisse n'est pas encore initialisée */}
          {!activeSession && !isComptable && (
            <div className="bg-gradient-to-r from-amber-600 via-purple-950 to-slate-900 rounded-2xl p-5 text-white shadow-xl border border-amber-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
                  <span className="material-symbols-outlined text-[28px]">lock</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5 bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-400/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                      Caisse Non Initialisée
                    </span>
                    <span className="text-xs text-slate-300 font-semibold">
                      • {currentProject?.nom || 'Point de vente'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Veuillez initialiser le fond de caisse pour commencer les encaissements et utiliser le terminal de vente.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpeningModalOpen(true)}
                className="w-full sm:w-auto px-5 py-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center gap-2 shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">key</span>
                <span>INITIALISER LA CAISSE</span>
              </button>
            </div>
          )}

          {/* Bandeau d'état et calculs automatiques de la session de caisse en temps réel */}
          {activeSession && (
            <div className="bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 rounded-2xl p-4 text-white shadow-xl border border-purple-900/40">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <span className="material-symbols-outlined text-2xl">point_of_sale</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        Caisse Ouverte
                      </span>
                      <span className="text-[11px] text-slate-400">• Session #{activeSession.id.slice(-6).toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-slate-300 font-medium">
                      Caissier : <span className="font-bold text-white">{currentUser.nom}</span> • Début : <span className="font-mono text-purple-300">{new Date(activeSession.dateOuverture).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </p>
                  </div>
                </div>

                {/* KPIs en temps réel calculés automatiquement */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto">
                  <div className="bg-white/10 backdrop-blur-md rounded-xl px-3 py-2 border border-white/10 flex-1 sm:flex-initial">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Fond Initial</p>
                    <p className="text-xs sm:text-sm font-bold font-mono text-amber-300">{activeSession.soldeInitial.toFixed(3)} DT</p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-md rounded-xl px-3 py-2 border border-white/10 flex-1 sm:flex-initial">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Ventes Espèces</p>
                    <p className="text-xs sm:text-sm font-bold font-mono text-emerald-400">+{totalVentesEspeces.toFixed(3)} DT</p>
                  </div>

                  <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl px-3.5 py-2 border border-purple-400/40 shadow-md flex-1 sm:flex-initial">
                    <p className="text-[10px] uppercase font-black tracking-wider text-purple-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">lock</span>
                      Total Tiroir (Auto)
                    </p>
                    <p className="text-sm sm:text-base font-black font-mono text-white">{soldeFinalCalcule.toFixed(3)} DT</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('session_history')}
                    className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                    title="Consulter l'historique des ventes de cette session"
                  >
                    <span className="material-symbols-outlined text-[17px]">receipt_long</span>
                    <span>Ventes Session ({sessionSales.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setClosingCountedCash(soldeFinalCalcule);
                      setIsClosingModalOpen(true);
                    }}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[17px]">lock</span>
                    <span>Clôturer Caisse</span>
                  </button>

                </div>
              </div>
            </div>
          )}

          {/* Toast Notification Sync Smartphone */}
          {syncNotification && (
            <div className="p-3.5 bg-gradient-to-r from-purple-700 via-indigo-700 to-slate-900 text-white font-extrabold text-xs rounded-xl shadow-xl flex items-center justify-between animate-in slide-in-from-top duration-300 border border-purple-400/40">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white shrink-0">
                  <span className="material-symbols-outlined text-[20px] animate-bounce">
                    {syncNotification.sourceDevice === 'smartphone' ? 'phone_iphone' : 'desktop_windows'}
                  </span>
                </div>
                <div>
                  <p className="font-black text-amber-300 text-[11px] uppercase tracking-wide">
                    ⚡ Synchronisation en direct
                  </p>
                  <p className="text-xs font-bold text-white mt-0.5">{syncNotification.message}</p>
                </div>
              </div>
              <button
                onClick={() => setSyncNotification(null)}
                className="p-1 text-purple-200 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          )}

          {/* Scanner Console Control Panel */}
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleProcessScan(scannerInput);
                }}
                className="flex-1 flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-400 text-[20px]">
                    barcode_reader
                  </span>
                  <input
                    id="scanner-input"
                    type="text"
                    value={scannerInput}
                    onChange={(e) => setScannerInput(e.target.value)}
                    placeholder="Entrez ou scannez un code-barres / QR Code (ex: 6191234567890)..."
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-all font-mono shadow-inner"
                  />
                </div>
              </form>

              <button
                type="button"
                onClick={() => setIsCameraScannerOpen(true)}
                className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-xs rounded-xl shadow-md shadow-purple-500/20 transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0 border border-purple-400/40 active:scale-95"
                title="Scanner par caméra smartphone en continu sans fatigue"
              >
                <span className="material-symbols-outlined text-[19px]">photo_camera</span>
                <span>Scanner Caméra (Scan Rapide ⚡)</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDouchetteModalOpen(true)}
                className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs rounded-xl shadow-md shadow-amber-500/10 transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0 border border-amber-300/40 active:scale-95"
                title="Scanner à l'aide d'un pistolet de lecture code-barres (douchette USB/Bluetooth)"
              >
                <span className="material-symbols-outlined text-[19px]">barcode_reader</span>
                <span>Scanner avec Douchette (Pistolet 🔫)</span>
              </button>
            </div>
          </div>


          {/* Scanner Feedback Notification Toast */}
          {scannerFeedback && (
            <div className={`p-4 rounded-xl font-extrabold text-xs shadow-lg flex items-center justify-between animate-in zoom-in-95 border ${
              scannerFeedback.type === 'success'
                ? 'bg-emerald-500 text-white border-emerald-400'
                : scannerFeedback.type === 'warning'
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-rose-600 text-white border-rose-500'
            }`}>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[24px] shrink-0">
                  {scannerFeedback.type === 'success' ? 'check_circle' : scannerFeedback.type === 'warning' ? 'warning' : 'cancel'}
                </span>
                <div>
                  <p className="leading-relaxed font-bold">{scannerFeedback.message}</p>
                  {scannerFeedback.article && (
                    <div className="mt-1 flex items-center gap-3 text-[11px] opacity-90 font-mono flex-wrap">
                      <span>Article : {scannerFeedback.article.designation}</span>
                      <span>• Prix : {scannerFeedback.article.prixVenteHT} DT</span>
                      <span className="font-bold text-amber-200">
                        • Stock restant : {scannerFeedback.article.typeArticle === 'Service' ? 'Prestation illimitée' : `${getArticleStock(scannerFeedback.article, selectedProjectId === 'all' ? (activeSession?.projetId || '1') : selectedProjectId)} unité(s)`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setScannerFeedback(null)}
                className="p-1 hover:bg-black/10 rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          )}

          {posSuccessMsg && (
            <div className="p-4 bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-lg flex items-center justify-between animate-in zoom-in-95">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                {posSuccessMsg}
              </span>
              <button onClick={() => setPosSuccessMsg(null)} className="text-emerald-100 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          )}

          {/* Mobile Segmented Switcher (Catalogue vs Panier) */}
          <div className="lg:hidden flex items-center p-1 bg-slate-200/80 rounded-xl">
            <button
              type="button"
              onClick={() => setPosMobileTab('catalog')}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                posMobileTab === 'catalog'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">grid_view</span>
              <span>Catalogue ({filteredPosArticles.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setPosMobileTab('cart')}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer relative ${
                posMobileTab === 'cart'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
              <span>Panier</span>
              {cart.length > 0 && (
                <span className={`ml-1 text-[11px] font-mono font-bold ${posMobileTab === 'cart' ? 'text-amber-300' : 'text-purple-700'}`}>
                  ({cart.reduce((s, i) => s + i.quantite, 0)}) • {cartTotalTTC.toFixed(2)} DT
                </span>
              )}
            </button>
          </div>

          {/* Main Grid: Products vs Ticket Panier */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Product Search & Catalog (7 cols) */}
            <div className={`lg:col-span-7 space-y-4 ${posMobileTab === 'cart' ? 'hidden lg:block' : 'block'}`}>
              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm space-y-3">
                {/* Search Bar */}
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                    search
                  </span>
                  <input
                    type="text"
                    value={posSearchTerm}
                    onChange={(e) => setPosSearchTerm(e.target.value)}
                    placeholder="Rechercher un article (nom, référence, code-barres)..."
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-purple-600 focus:bg-white transition-all shadow-2xs"
                  />
                  {posSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setPosSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <span className="material-symbols-outlined text-[18px]">cancel</span>
                    </button>
                  )}
                </div>

                {/* Filters & Sort Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Category Filter Pills */}
                  <div className="flex-1 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setPosCategoryFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-all ${
                        posCategoryFilter === 'all'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Tous les articles ({scopedArticles.length})
                    </button>
                    {categoriesList.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPosCategoryFilter(cat)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-all ${
                          posCategoryFilter === cat
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={posTypeFilter}
                      onChange={(e) => setPosTypeFilter(e.target.value as any)}
                      className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-purple-600 cursor-pointer"
                    >
                      <option value="all">Tous types</option>
                      <option value="Produit">Produits physiques</option>
                      <option value="Service">Services & Prestations</option>
                    </select>

                    <select
                      value={posSortBy}
                      onChange={(e) => setPosSortBy(e.target.value as any)}
                      className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-purple-600 cursor-pointer"
                    >
                      <option value="most_sold">Les plus vendus 🔥</option>
                      <option value="name_asc">De A à Z</option>
                      <option value="price_asc">Prix croissant</option>
                      <option value="price_desc">Prix décroissant</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Quick Services Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">bolt</span>
                  Ajout Rapide :
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const moArticle = scopedArticles.find(a => a.id === 'mo-install' || a.designation.toLowerCase().includes('main d\'œuvre'));
                    if (moArticle) {
                      setCart(prev => {
                        const exists = prev.find(i => i.article.id === moArticle.id);
                        if (exists) return prev.map(i => i.article.id === moArticle.id ? { ...i, quantite: i.quantite + 1 } : i);
                        return [...prev, { article: moArticle, quantite: 1, prixVenteHT: moArticle.prixVenteHT }];
                      });
                    } else {
                      const tempMO: Article = {
                        id: 'mo-temp',
                        designation: 'Main d\'œuvre Standard',
                        code: 'SRV-MO',
                        typeArticle: 'Service',
                        famille: 'Services',
                        prixVenteHT: 15.000,
                        prixAchatHT: 0,
                        stock: 999,
                        stocks: {},
                        projetId: selectedProjectId,
                        statut: 'Actif',
                        tva: 19
                      };
                      setCart(prev => {
                        const exists = prev.find(i => i.article.id === tempMO.id);
                        if (exists) return prev.map(i => i.article.id === tempMO.id ? { ...i, quantite: i.quantite + 1 } : i);
                        return [...prev, { article: tempMO, quantite: 1, prixVenteHT: tempMO.prixVenteHT }];
                      });
                    }
                  }}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-xl text-[11px] font-bold hover:bg-purple-700 transition-all shadow-md shadow-purple-500/20 flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">build</span>
                  Main d'œuvre (15 DT)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const srvLivraison: Article = {
                      id: 'srv-livraison',
                      designation: 'Service Livraison',
                      code: 'SRV-LIV',
                      typeArticle: 'Service',
                      famille: 'Services',
                      prixVenteHT: 7.000,
                      prixAchatHT: 0,
                      stock: 999,
                      stocks: {},
                      projetId: selectedProjectId,
                      statut: 'Actif',
                      tva: 19
                    };
                    setCart(prev => {
                      const exists = prev.find(i => i.article.id === srvLivraison.id);
                      if (exists) return prev.map(i => i.article.id === srvLivraison.id ? { ...i, quantite: i.quantite + 1 } : i);
                      return [...prev, { article: srvLivraison, quantite: 1, prixVenteHT: srvLivraison.prixVenteHT }];
                    });
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-[11px] font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                  Livraison (7 DT)
                </button>
              </div>

              {/* Product Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {filteredPosArticles.map(article => {
                  const inCart = cart.find(ci => ci.article.id === article.id);
                  const price = article.prixVenteHT || 0;
                  const storeId = selectedProjectId === 'all' ? (activeSession?.projetId || '1') : selectedProjectId;
                  const isService = article.typeArticle === 'Service';
                  const totalStoreStock = isService ? 999 : getArticleStock(article, storeId);
                  const inCartQty = inCart ? inCart.quantite : 0;
                  const remainingStock = isService ? null : Math.max(0, totalStoreStock - inCartQty);
                  const isOutOfStock = !isService && totalStoreStock <= 0;
                  const isCartLimitReached = !isService && remainingStock === 0 && inCartQty > 0;
                  const isLowStock = !isService && remainingStock !== null && remainingStock > 0 && remainingStock <= 5;

                  return (
                    <div
                      key={article.id}
                      onClick={() => {
                        if (!isOutOfStock && !isCartLimitReached) {
                          handleAddToCart(article, 1);
                        }
                      }}
                      className={`p-4 bg-white rounded-xl border transition-all relative overflow-hidden group hover:shadow-md ${
                        isOutOfStock 
                          ? 'border-rose-200 bg-rose-50/20 opacity-80 cursor-not-allowed'
                          : isCartLimitReached
                            ? 'border-amber-300 bg-amber-50/20 cursor-not-allowed'
                            : inCart 
                              ? 'border-purple-500 ring-2 ring-purple-500/20 bg-purple-50/20 cursor-pointer' 
                              : 'border-slate-200 hover:border-purple-300 cursor-pointer'
                      }`}
                    >
                      {/* Top Badges: Category & Stock Status */}
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="inline-block text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded truncate max-w-[110px]">
                          {article.famille || 'Général'}
                        </span>

                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {inCart && (
                            <span className="bg-purple-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-xs flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">shopping_cart</span>
                              {inCart.quantite} au panier
                            </span>
                          )}

                          {isService ? (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">bolt</span>
                              Service
                            </span>
                          ) : isOutOfStock ? (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1 animate-pulse">
                              <span className="material-symbols-outlined text-[12px]">cancel</span>
                              Rupture (0)
                            </span>
                          ) : isCartLimitReached ? (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">warning</span>
                              Max atteint
                            </span>
                          ) : isLowStock ? (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px] text-amber-600">warning</span>
                              ⚠️ Reste : {remainingStock}
                            </span>
                          ) : (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">inventory_2</span>
                              Reste : {remainingStock}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-xl border flex items-center justify-center font-bold shrink-0 transition-colors ${
                          isOutOfStock
                            ? 'bg-rose-50 border-rose-200 text-rose-500'
                            : isLowStock
                              ? 'bg-amber-50 border-amber-200 text-amber-600'
                              : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:bg-purple-100 group-hover:text-purple-700'
                        }`}>
                          <span className="material-symbols-outlined text-[24px]">
                            {isService ? 'build' : isOutOfStock ? 'remove_shopping_cart' : 'inventory_2'}
                          </span>
                        </div>
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
                            {article.code}
                          </span>
                          <h4 className="text-xs font-extrabold text-slate-900 truncate group-hover:text-purple-700 transition-colors">
                            {article.designation}
                          </h4>

                          {/* Quantité restante bien visible pour le caissier */}
                          <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-500">Stock restant :</span>
                            {isService ? (
                              <span className="text-[11px] font-black text-purple-700">Prestation illimitée</span>
                            ) : (
                              <span className={`text-[11px] font-black font-mono px-2 py-0.5 rounded border ${
                                isOutOfStock
                                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                                  : isLowStock
                                    ? 'bg-amber-100 text-amber-950 border-amber-300'
                                    : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                              }`}>
                                {remainingStock} {remainingStock !== null && remainingStock > 1 ? 'unités' : 'unité'}
                                {inCartQty > 0 ? ` (sur ${totalStoreStock})` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold block uppercase">Prix Unitaire</span>
                          <span className="text-base font-bold text-slate-900 font-mono">
                            {price.toFixed(3)} <span className="text-xs font-bold text-slate-500">DT</span>
                          </span>
                        </div>

                        <button
                          type="button"
                          disabled={isOutOfStock || isCartLimitReached}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isOutOfStock && !isCartLimitReached) {
                              handleAddToCart(article, 1);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1 ${
                            isOutOfStock || isCartLimitReached
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              : 'bg-purple-600 hover:bg-purple-700 text-white cursor-pointer active:scale-95'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {isOutOfStock ? 'block' : 'add'}
                          </span>
                          {isOutOfStock ? 'Rupture' : isCartLimitReached ? 'Complet' : 'Ajouter'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {filteredPosArticles.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-white rounded-xl border border-slate-200">
                    <span className="material-symbols-outlined text-slate-300 text-[48px]">search_off</span>
                    <p className="text-xs font-bold text-slate-500 mt-2">Aucun produit trouvé dans le catalogue.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Ticket Panier & Total (5 cols) */}
            <div className={`lg:col-span-5 space-y-4 ${posMobileTab === 'catalog' ? 'hidden lg:block' : 'block'}`}>
              {/* Mobile Back Button to Catalog */}
              <button
                type="button"
                onClick={() => setPosMobileTab('catalog')}
                className="lg:hidden inline-flex items-center gap-1.5 text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-3 py-2 rounded-xl transition-colors cursor-pointer w-fit mb-1"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Continuer les achats (Catalogue)
              </button>

              <div className="bg-white rounded-xl border border-slate-200/90 shadow-md overflow-hidden flex flex-col h-full">
                {/* Ticket Header */}
                <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400 text-[20px]">shopping_bag</span>
                    <h3 className="font-extrabold text-sm uppercase tracking-wider">Panier de Caisse</h3>
                  </div>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="text-[11px] text-rose-300 hover:text-white font-bold flex items-center gap-1 cursor-pointer bg-rose-500/20 hover:bg-rose-500/30 px-2 py-1 rounded-lg transition-colors"
                      title="Supprimer tous les articles du panier"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                      Supprimer tous
                    </button>
                  )}
                </div>

                {/* Client de la vente : Toujours Client Passager pour la caisse */}
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Client :</span>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-extrabold text-slate-800 shadow-2xs">
                    <span className="material-symbols-outlined text-[15px] text-purple-600">person</span>
                    <span>Client Passager</span>
                  </div>
                </div>

                {/* Cart Items List */}
                <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto divide-y divide-slate-100 flex-1">
                  {cart.map(item => {
                    const pu = item.prixVenteHT || 0;
                    const subtotal = item.quantite * pu;

                    return (
                      <div key={item.article.id} className="pt-3 first:pt-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-extrabold text-slate-900 leading-tight">
                              {item.article.designation}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-mono">
                                {item.article.code}
                              </span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                item.article.typeArticle === 'Service'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {item.article.typeArticle || 'Produit'}
                              </span>
                            </div>

                            {/* Prix unitaire fixe et non modifiable (conforme au catalogue d'articles) */}
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                P.U :
                              </span>
                              <span className="text-xs font-mono font-extrabold text-slate-800 bg-slate-100/80 px-2 py-0.5 rounded border border-slate-200">
                                {(item.prixVenteHT ?? item.article.prixVenteHT ?? 0).toFixed(3)} <span className="text-[10px] font-bold text-slate-500">DT</span>
                              </span>
                            </div>

                            {/* Stock restant en boutique */}
                            {item.article.typeArticle !== 'Service' && (() => {
                              const storeId = selectedProjectId === 'all' ? (activeSession?.projetId || '1') : selectedProjectId;
                              const currentStock = getArticleStock(item.article, storeId);
                              const remainingAfterCart = currentStock - item.quantite;
                              return (
                                <div className="mt-1 flex items-center gap-1.5 text-[10.5px]">
                                  <span className="text-slate-500 font-bold">Rayon :</span>
                                  <span className={`font-mono font-black ${
                                    remainingAfterCart < 0 
                                      ? 'text-rose-600' 
                                      : remainingAfterCart === 0 
                                        ? 'text-amber-600' 
                                        : 'text-emerald-700'
                                  }`}>
                                    {remainingAfterCart >= 0 ? `${remainingAfterCart} restant(s)` : `Dépassement de ${Math.abs(remainingAfterCart)} !`}
                                  </span>
                                  <span className="text-slate-400 text-[9.5px]">({currentStock} en stock)</span>
                                </div>
                              );
                            })()}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.article.id)}
                            className="text-slate-300 hover:text-rose-600 transition-colors p-1"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>

                        {/* Quantity Controls & Subtotal (BF-PROD-019) */}
                        <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200">
                          {/* Qté buttons */}
                          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQty(item.article.id, -1)}
                              className="w-6 h-6 rounded flex items-center justify-center font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.quantite}
                              onChange={(e) => handleSetCartQty(item.article.id, parseInt(e.target.value) || 1)}
                              className="w-10 text-center text-xs font-extrabold text-slate-900 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQty(item.article.id, 1)}
                              className="w-6 h-6 rounded flex items-center justify-center font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          {/* Subtotal calculation */}
                          <div className="text-right">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block">Sous-total</span>
                            <span className="text-xs font-bold text-purple-700">
                              {subtotal.toFixed(3)} DT
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {cart.length === 0 && (
                    <div className="py-12 text-center text-slate-400 space-y-2">
                      <span className="material-symbols-outlined text-[36px] text-slate-300">add_shopping_cart</span>
                      <p className="text-xs font-bold">Le panier est vide.</p>
                      <p className="text-[11px]">Cliquez sur un article à gauche pour l'ajouter.</p>
                    </div>
                  )}
                </div>

                {/* Total Calculation Footer (TVA incluse, sans timbre fiscal) */}
                <div className="p-4 bg-slate-900 text-white space-y-2 border-t border-slate-800 text-xs">
                  <div className="space-y-1.5 font-medium">
                    <div className="flex justify-between text-slate-400">
                      <span>Total HT ({cart.reduce((s, i) => s + i.quantite, 0)} art.) :</span>
                      <span className="text-white font-mono tabular-nums">{cartTotalHT.toFixed(3)} DT</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Total TVA :</span>
                      <span className="text-white font-mono tabular-nums">{cartTotalTVA.toFixed(3)} DT</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Timbre Fiscal :</span>
                      <span className="text-slate-500 font-mono">Exonéré (0,000 DT)</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-emerald-400 pt-2 border-t border-slate-800">
                      <span>TOTAL TTC À PAYER :</span>
                      <span className="font-mono tabular-nums">{cartTotalTTC.toFixed(3)} DT</span>
                    </div>
                  </div>

                  {/* Remise sur le prix TTC */}
                  <div className="space-y-1 pt-2 border-t border-slate-800">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase">Remise Globale (%) :</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={posRemise || ''}
                      onChange={(e) => setPosRemise(parseFloat(e.target.value) || 0)}
                      placeholder="Ex: 10"
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm font-bold placeholder-slate-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all outline-none"
                    />
                  </div>

                   {/* Complete Checkout Button */}
                  <button
                    type="button"
                    disabled={cart.length === 0}
                    onClick={handleCheckoutPosSale}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 border-emerald-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 border disabled:border-slate-800"
                  >
                    <span className="material-symbols-outlined text-[20px]">payments</span>
                    <span>Encaisser ({cartTotalTTC.toFixed(3)} DT)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Floating Cart Peek Bar */}
          {posMobileTab === 'catalog' && cart.length > 0 && (
            <div className="lg:hidden fixed bottom-14 left-3 right-3 z-30 bg-slate-950/95 backdrop-blur-md text-white p-3 rounded-xl shadow-2xl border border-slate-800 flex items-center justify-between animate-in slide-in-from-bottom-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
                  {cart.reduce((s, i) => s + i.quantite, 0)}
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold uppercase">Total Panier</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">{cartTotalTTC.toFixed(3)} DT</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPosMobileTab('cart')}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>Encaisser</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* SESSION HISTORY TAB - Historique Complet de la Session Active du Caissier */}
      {activeTab === 'session_history' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {!activeSession ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200/60">
                <span className="material-symbols-outlined text-3xl">lock</span>
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="font-bold text-lg text-slate-900">Aucune Session de Caisse Ouverte</h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Vous devez initialiser votre caisse avec un montant d'ouverture pour enregistrer des ventes et suivre l'historique de votre session.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpeningModalOpen(true)}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">key</span>
                <span>Initialiser & Ouvrir ma Caisse</span>
              </button>
            </div>
          ) : (
            <>
              {/* Grand Bandeau Récapitulatif de la Session Active */}
              <div className="bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white p-5 sm:p-6 rounded-2xl shadow-xl border border-purple-900/40">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300 shrink-0 shadow-inner">
                      <span className="material-symbols-outlined text-[28px]">receipt_long</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-wider text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-400/30 font-mono">
                          Session #{activeSession.id.slice(-6).toUpperCase()}
                        </span>
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 bg-emerald-500/20 px-2.5 py-0.5 rounded-full border border-emerald-400/30">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                          Session Ouverte (En Cours)
                        </span>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-white mt-1">
                        Caisse de {currentUser.nom} • {currentProject?.nom || 'Point de Vente'}
                      </h2>
                      <p className="text-xs text-slate-300">
                        Ouverte le {new Date(activeSession.dateOuverture).toLocaleDateString('fr-FR')} à {new Date(activeSession.dateOuverture).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {activeSession.notes ? ` • Note: ${activeSession.notes}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenCreate}
                      className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                      title="Ajouter un mouvement d'espèces (Apport ou Retrait)"
                    >
                      <span className="material-symbols-outlined text-[17px] text-purple-300">swap_vert</span>
                      <span>Mouvement Espèces</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPosReturnActiveTab('nouveau');
                        setIsPosReturnModalOpen(true);
                      }}
                      className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                      title="Gérer les retours clients et avoirs"
                    >
                      <span className="material-symbols-outlined text-[17px] text-indigo-300">assignment_return</span>
                      <span>Retours & Avoirs</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => generateZReportPdf({
                        session: activeSession,
                        projet: currentProject,
                        caissier: currentUser,
                        ventesSession: sessionSales,
                        reglementsSession: sessionReglementsManuels.items,
                        retoursSession: sessionRetours,
                        soldeFinalCalcule: soldeFinalCalcule
                      })}
                      className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all cursor-pointer flex items-center gap-1.5"
                      title="Imprimer l'état provisoire de la session (X-Report)"
                    >
                      <span className="material-symbols-outlined text-[17px]">print</span>
                      <span>État Provisoire (X-Report)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setClosingCountedCash(soldeFinalCalcule);
                        setIsClosingModalOpen(true);
                      }}
                      className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[17px]">lock</span>
                      <span>Clôturer Caisse</span>
                    </button>
                  </div>
                </div>

                {/* 5 KPIs Financiers Fondamentaux de la Session */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
                  {/* KPI 1 : Montant d'ouverture */}
                  <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <span>Fond Initial</span>
                      <span className="material-symbols-outlined text-[16px] text-amber-400">savings</span>
                    </div>
                    <p className="text-base sm:text-lg font-black font-mono text-amber-300 mt-1">
                      {activeSession.soldeInitial.toFixed(3)} DT
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Versé à l'ouverture</p>
                  </div>

                  {/* KPI 2 : Ventes & CA Net */}
                  <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <span>Ventes ({sessionSales.length})</span>
                      <span className="material-symbols-outlined text-[16px] text-emerald-400">shopping_cart</span>
                    </div>
                    <p className="text-base sm:text-lg font-black font-mono text-emerald-400 mt-1">
                      {totalVentesGlobal.toFixed(3)} DT
                    </p>
                    <p className="text-[10px] text-slate-300 mt-0.5 font-medium">
                      CA Net: <strong className="font-mono text-white">{caNetSession.toFixed(3)} DT</strong>
                    </p>
                  </div>

                  {/* KPI 3 : Retours & Remboursements */}
                  <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <span>Retours ({sessionRetours.length})</span>
                      <span className="material-symbols-outlined text-[16px] text-rose-400">assignment_return</span>
                    </div>
                    <p className="text-base sm:text-lg font-black font-mono text-rose-300 mt-1">
                      -{totalRetoursGlobal.toFixed(3)} DT
                    </p>
                    <p className="text-[10px] text-slate-300 mt-0.5 font-medium">
                      Espèces: -{totalRetoursEspeces.toFixed(3)} DT • Avoirs: {totalRetoursAvoir.toFixed(3)} DT
                    </p>
                  </div>

                  {/* KPI 4 : Mouvements Manuels */}
                  <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <span>Mouvements Espèces</span>
                      <span className="material-symbols-outlined text-[16px] text-blue-400">swap_vert</span>
                    </div>
                    <p className="text-base sm:text-lg font-black font-mono text-blue-300 mt-1">
                      {(sessionReglementsManuels.encaissementsEspeces - sessionReglementsManuels.decaissementsEspeces >= 0 ? '+' : '')}
                      {(sessionReglementsManuels.encaissementsEspeces - sessionReglementsManuels.decaissementsEspeces).toFixed(3)} DT
                    </p>
                    <p className="text-[10px] text-slate-300 mt-0.5 font-medium">
                      +{sessionReglementsManuels.encaissementsEspeces.toFixed(3)} DT / -{sessionReglementsManuels.decaissementsEspeces.toFixed(3)} DT
                    </p>
                  </div>

                  {/* KPI 5 : Tiroir-Caisse Théorique */}
                  <div className="col-span-2 sm:col-span-1 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl p-3 border border-purple-400/40 shadow-lg">
                    <div className="flex items-center justify-between text-purple-200 text-[10px] font-bold uppercase tracking-wider">
                      <span>Tiroir Théorique</span>
                      <span className="material-symbols-outlined text-[16px]">lock</span>
                    </div>
                    <p className="text-base sm:text-lg font-black font-mono text-white mt-1">
                      {soldeFinalCalcule.toFixed(3)} DT
                    </p>
                    <p className="text-[10px] text-purple-200 mt-0.5">Espèces réelles attendues</p>
                  </div>
                </div>
              </div>

              {/* Barre de Recherche et Filtres */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative flex-1 w-full">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
                  <input
                    type="text"
                    value={sessionSalesSearch}
                    onChange={(e) => setSessionSalesSearch(e.target.value)}
                    placeholder="Rechercher par N° ticket (FAC-...), client, désignation..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-purple-600 focus:bg-white transition-all"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select
                    value={sessionSalesModeFilter}
                    onChange={(e) => setSessionSalesModeFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-purple-600 cursor-pointer"
                  >
                    <option value="all">Tous modes de règlement</option>
                    <option value="Espèces">Espèces</option>
                    <option value="Chèque">Chèque</option>
                    <option value="Carte Bancaire">Carte Bancaire</option>
                    <option value="Virement">Virement</option>
                    <option value="Traite">Traite</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setActiveTab('pos')}
                    className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_shopping_cart</span>
                    <span>Nouvelle Vente POS</span>
                  </button>
                </div>
              </div>

              {/* Tableau Détaillé des Ventes Réalisées Pendant Cette Session */}
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-600 text-[20px]">receipt</span>
                    <h3 className="font-bold text-sm text-slate-900">
                      Ventes & Tickets Réalisés ({filteredSessionSales.length} / {sessionSales.length})
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500 font-mono font-bold">
                    Total TTC : <span className="text-purple-700">{filteredSessionSales.reduce((s, v) => s + (v.montantPaye ?? v.montantTTC ?? 0), 0).toFixed(3)} DT</span>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                        <th className="py-3 px-4">N° Ticket</th>
                        <th className="py-3 px-4">Heure Vente</th>
                        <th className="py-3 px-4">Client</th>
                        <th className="py-3 px-4">Articles & Quantités</th>
                        <th className="py-3 px-4 text-center">Règlement</th>
                        <th className="py-3 px-4 text-right">Total HT</th>
                        <th className="py-3 px-4 text-right">Total TTC</th>
                        <th className="py-3 px-4 text-center">Ticket</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {filteredSessionSales.map(sale => (
                        <tr key={sale.id} className="hover:bg-purple-50/30 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-purple-900">
                            {sale.numero}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono">
                            {sale.dateVente 
                              ? new Date(sale.dateVente).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                              : (sale.date || '—')}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-800">
                            {sale.clientNom || 'Client Comptoir'}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 max-w-xs">
                            {sale.lignes && sale.lignes.length > 0 ? (
                              <div className="truncate font-sans" title={sale.lignes.map(l => `${l.quantite}x ${l.designation}`).join(' • ')}>
                                <span className="font-bold text-slate-900">{sale.lignes.reduce((s, l) => s + l.quantite, 0)} pièce(s) :</span>{' '}
                                {sale.lignes.map(l => `${l.quantite}x ${l.designation}`).join(', ')}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Vente directe comptoir</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              sale.modePaiement === 'Espèces' || !sale.modePaiement
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : sale.modePaiement === 'Chèque'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              {sale.modePaiement || 'Espèces'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-slate-600">
                            {sale.montantHT.toFixed(3)} DT
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-black text-slate-950">
                            {(sale.montantPaye ?? sale.montantTTC ?? 0).toFixed(3)} DT
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedTicketVente(sale)}
                                className="p-1.5 text-purple-600 hover:bg-purple-100/70 rounded-lg transition-colors cursor-pointer"
                                title="Voir / Imprimer le Ticket de Caisse Thermique"
                              >
                                <span className="material-symbols-outlined text-[18px]">receipt</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}

                      {filteredSessionSales.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-12 text-slate-400">
                            <span className="material-symbols-outlined text-4xl text-slate-300 block mb-2">shopping_bag</span>
                            <p className="font-semibold text-slate-600 text-xs">Aucune vente trouvée dans cette session.</p>
                            <p className="text-[11px] text-slate-400 mt-1">Les ventes enregistrées sur le terminal POS apparaîtront automatiquement ici.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mouvements Manuels de la Session */}
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-indigo-600 text-[20px]">swap_vert</span>
                    <h3 className="font-bold text-sm text-slate-900">
                      Mouvements d'Espèces de la Session ({sessionReglementsManuels.items.length})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-indigo-200 shadow-2xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    <span>Ajouter Mouvement Espèces</span>
                  </button>
                </div>

                {sessionReglementsManuels.items.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 space-y-2">
                    <span className="material-symbols-outlined text-3xl text-slate-300 block">account_balance_wallet</span>
                    <p className="text-xs font-semibold text-slate-600">Aucun mouvement d'espèces manuel pour cette session.</p>
                    <p className="text-[11px] text-slate-400">Utilisez le bouton ci-dessus pour enregistrer un apport de monnaie ou un retrait de caisse.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                          <th className="py-2.5 px-4">N° Pièce</th>
                          <th className="py-2.5 px-4">Heure</th>
                          <th className="py-2.5 px-4">Type</th>
                          <th className="py-2.5 px-4">Tiers / Motif</th>
                          <th className="py-2.5 px-4 text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sessionReglementsManuels.items.map(r => (
                          <tr key={r.id}>
                            <td className="py-2.5 px-4 font-mono font-bold text-slate-800">{r.numeroPiece}</td>
                            <td className="py-2.5 px-4 font-mono text-slate-500">
                              {r.dateReglement 
                                ? new Date(r.dateReglement).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                                : r.date}
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                r.type === 'Encaissement' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                              }`}>
                                {r.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">{r.notes || r.tierNom || '—'}</td>
                            <td className={`py-2.5 px-4 text-right font-mono font-bold ${
                              r.type === 'Encaissement' ? 'text-emerald-600' : 'text-rose-600'
                            }`}>
                              {r.type === 'Encaissement' ? '+' : '-'}{r.montant.toFixed(3)} DT
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Retours & Remboursements Réalisés Pendant Cette Session */}
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-rose-600 text-[20px]">assignment_return</span>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">
                        Retours & Remboursements de la Session ({sessionRetours.length})
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Total TTC: <strong className="text-rose-600 font-mono">-{totalRetoursGlobal.toFixed(3)} DT</strong> • Espèces décaissées: <strong className="text-rose-700 font-mono">-{totalRetoursEspeces.toFixed(3)} DT</strong> • Avoirs générés: <strong className="text-amber-700 font-mono">+{totalRetoursAvoir.toFixed(3)} DT</strong>
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPosReturnActiveTab('nouveau');
                      setIsPosReturnModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-rose-200 shadow-2xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    <span>Nouveau Retour POS</span>
                  </button>
                </div>

                {sessionRetours.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 space-y-2">
                    <span className="material-symbols-outlined text-3xl text-slate-300 block">assignment_return</span>
                    <p className="text-xs font-semibold text-slate-600">Aucun retour enregistré pendant cette session.</p>
                    <p className="text-[11px] text-slate-400">Les remboursements d'espèces et bons d'avoirs émis par ce caissier apparaîtront ici.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                          <th className="py-2.5 px-4">N° Retour</th>
                          <th className="py-2.5 px-4">Heure</th>
                          <th className="py-2.5 px-4">Ticket Origine</th>
                          <th className="py-2.5 px-4">Client</th>
                          <th className="py-2.5 px-4">Restitution</th>
                          <th className="py-2.5 px-4 text-center">Articles</th>
                          <th className="py-2.5 px-4 text-right">Montant TTC</th>
                          <th className="py-2.5 px-4 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sessionRetours.map(r => (
                          <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-4">
                              <span className="font-mono font-bold text-rose-700">{r.numero}</span>
                              <span className="block text-[10px] text-slate-400">{r.type}</span>
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-500">
                              {r.date && r.date.includes(' ')
                                ? r.date.split(' ')[1]?.slice(0, 5) || r.date
                                : r.date && r.date.includes('T')
                                ? new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                                : r.date}
                            </td>
                            <td className="py-2.5 px-4 font-mono font-medium text-slate-700">
                              {r.venteNumero ? (
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-bold text-slate-700">
                                  {r.venteNumero}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Retour direct</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 font-semibold text-slate-800">
                              {r.clientNom || 'Client Comptoir'}
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                r.modeRemboursement === 'Espèces'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : r.modeRemboursement === 'Avoir'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200'
                              }`}>
                                <span className="material-symbols-outlined text-[12px]">
                                  {r.modeRemboursement === 'Espèces' ? 'payments' : r.modeRemboursement === 'Avoir' ? 'confirmation_number' : 'sync'}
                                </span>
                                {r.modeRemboursement}
                                {r.codeAvoir ? ` (${r.codeAvoir})` : ''}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-700">
                              {r.lignes ? r.lignes.reduce((s, l) => s + (l.quantiteRetournee || 0), 0) : 0}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold text-rose-600">
                              -{(r.montantTotal || 0).toFixed(3)} DT
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setPosViewingReturn(r)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                  title="Consulter le détail du retour"
                                >
                                  <span className="material-symbols-outlined text-[17px]">visibility</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => generateReturnSlipPdf(r, currentProject)}
                                  className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Télécharger le Bon de Retour TTC (PDF)"
                                >
                                  <span className="material-symbols-outlined text-[17px]">picture_as_pdf</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* JOURNAL TAB */}
      {activeTab === 'journal' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {isComptable ? 'Journal des Mouvements & Rapprochements Bancaires' : 'Historique des Mouvements de Caisse'}
              </h2>
              <p className="text-xs text-slate-500">
                {isComptable 
                  ? 'Audit des encaissements clients, décaissements fournisseurs et flux certifiés' 
                  : 'Historique des entrées et sorties d\'argent'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isComptable ? (
                <>
                  <button
                    onClick={() => {
                      setNewType('Encaissement');
                      setNewTierType('Client');
                      setNewTierId(scopedClients[0]?.id || '');
                      setNewMontant(0);
                      setNewMode('Espèces');
                      setNewBanque('Caisse Centrale');
                      setNewRef(`ENC-${Date.now().toString().slice(-4)}`);
                      setNewNotes('Encaissement client au comptant');
                      setIsModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">payments</span>
                    + Entrée d'argent
                  </button>

                  <button
                    onClick={() => {
                      setNewType('Décaissement');
                      setNewTierType('Fournisseur');
                      setNewTierId(scopedFournisseurs[0]?.id || '');
                      setNewMontant(0);
                      setNewMode('Virement');
                      setNewBanque('BIAT');
                      setNewRef(`DEC-${Date.now().toString().slice(-4)}`);
                      setNewNotes('Décaissement fournisseur / charge');
                      setIsModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                    - Sortie d'argent
                  </button>

                  <button
                    onClick={handleOpenCreate}
                    className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Autre Opération
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-slate-500 text-[16px]">policy</span>
                    Contrôle de Conformité
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Entrées d'Argent</span>
                <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                </span>
              </div>
              <p className="text-2xl font-bold text-emerald-600 mt-2">
                +{totalEncaissements.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} <span className="text-xs font-bold text-slate-500">DT</span>
              </p>
              <span className="text-xs text-slate-500 mt-1 block">Ventes et encaissements reçus</span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Sorties d'Argent</span>
                <span className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                </span>
              </div>
              <p className="text-2xl font-bold text-rose-600 mt-2">
                -{totalDecaissements.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} <span className="text-xs font-bold text-slate-500">DT</span>
              </p>
              <span className="text-xs text-slate-500 mt-1 block">Dépenses et paiements fournisseurs</span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-purple-200 shadow-sm bg-purple-50/40">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-purple-900 uppercase tracking-wider">Argent en Caisse</span>
                <span className="p-2 rounded-xl bg-purple-100 text-purple-700">
                  <span className="material-symbols-outlined text-[18px]">account_balance</span>
                </span>
              </div>
              <p className="text-2xl font-bold text-purple-900 mt-2">
                {soldeNetCaisse.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} <span className="text-xs font-bold text-purple-700">DT</span>
              </p>
              <span className="text-xs text-purple-700 font-semibold mt-1 block">Solde disponible</span>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            {/* Filters */}
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-50/50">
              <div className="relative w-full md:w-80">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Rechercher une opération, client, fournisseur..."
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="all">Toutes les opérations</option>
                  <option value="Encaissement">Entrées d'argent (+)</option>
                  <option value="Décaissement">Sorties d'argent (-)</option>
                </select>

                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="all">Tous les modes</option>
                  <option value="Espèces">Espèces</option>
                  <option value="Chèque">Chèque</option>
                  <option value="Virement">Virement</option>
                  <option value="Traite">Traite</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4">N° Opération</th>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Client / Fournisseur</th>
                    <th className="py-3.5 px-4">Document lié</th>
                    <th className="py-3.5 px-4">Paiement</th>
                    <th className="py-3.5 px-4 text-right">Montant</th>
                    <th className="py-3.5 px-4 text-center">Sens</th>
                    <th className="py-3.5 px-4 text-right">Reçu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {filteredReglements.map((reg) => (
                    <tr key={reg.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-purple-600">receipt</span>
                        {reg.numeroPiece}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {new Date(reg.date).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-900">{reg.tierNom}</span>
                        <span className="block text-[10px] text-slate-400">{reg.tierType}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">
                        {reg.documentRef || 'Règlement direct'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-medium text-slate-800">{reg.modePaiement}</span>
                        {reg.banque && <span className="block text-[10px] text-slate-400">{reg.banque}</span>}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-bold text-sm ${
                        reg.type === 'Encaissement' ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {reg.type === 'Encaissement' ? '+' : '-'}{reg.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DT
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          reg.type === 'Encaissement' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {reg.type === 'Encaissement' ? 'Entrée' : 'Sortie'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(() => {
                            const matchedSale = ventes.find(v => v.numero === reg.documentRef || v.id === reg.documentRef);
                            if (matchedSale) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setSelectedTicketVente(matchedSale)}
                                  className="flex items-center gap-1 px-2 py-1 bg-purple-50 hover:bg-purple-600 text-purple-700 hover:text-white border border-purple-200 hover:border-purple-600 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer shadow-2xs"
                                  title="Consulter le ticket de panier complet"
                                >
                                  <span className="material-symbols-outlined text-[13px]">receipt_long</span>
                                  <span>Ticket</span>
                                </button>
                              );
                            }
                            return null;
                          })()}

                          <button
                            type="button"
                            onClick={() => generateReceiptPdf(reg, currentProject)}
                            className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer"
                            title="Télécharger le Reçu PDF"
                          >
                            <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredReglements.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-slate-400 text-sm">
                        Aucun mouvement de caisse enregistré.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sessions de Caisse & Procès-Verbaux Z */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-600 text-[20px]">receipt_long</span>
                  Historique des Sessions & Clôtures de Caisse (Tickets Z)
                </h3>
                <p className="text-xs text-slate-500">Soldes d'ouverture, soldes finaux certifiés et ré-impression des procès-verbaux</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                    <th className="py-3 px-4">Session N°</th>
                    <th className="py-3 px-4">Caissier</th>
                    <th className="py-3 px-4">Date Ouverture</th>
                    <th className="py-3 px-4">Date Clôture</th>
                    <th className="py-3 px-4 text-right">Fond Initial</th>
                    <th className="py-3 px-4 text-right">Solde Final Certifié</th>
                    <th className="py-3 px-4 text-center">Statut</th>
                    <th className="py-3 px-4 text-right">Ticket Z</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {sessions
                    .filter(s => (selectedProjectId === 'all' || s.projetId === selectedProjectId) && 
                                 (currentUser.role !== 'caissier' || s.utilisateurId === currentUser.id || (s.utilisateurNom && s.utilisateurNom.toLowerCase() === currentUser.nom.toLowerCase())))
                    .map(sess => {
                    const sSales = ventes.filter(v => 
                      v.sessionId === sess.id || (
                        v.projetId === sess.projetId && 
                        (v.auteurId === sess.utilisateurId || (v.auteurNom && sess.utilisateurNom && v.auteurNom.toLowerCase() === sess.utilisateurNom.toLowerCase())) &&
                        v.date >= sess.dateOuverture.split('T')[0] &&
                        v.statut !== 'Devis' && v.statut !== 'Annulée'
                      )
                    );
                    const sRegs = reglements.filter(r => r.projetId === sess.projetId && r.date >= sess.dateOuverture.split('T')[0]);
                    const sRetours = retours.filter(r => 
                      r.sessionId === sess.id || (
                        r.projetId === sess.projetId && 
                        (r.auteurId === sess.utilisateurId || (r.auteurNom && sess.utilisateurNom && r.auteurNom.toLowerCase() === sess.utilisateurNom.toLowerCase())) &&
                        r.date >= sess.dateOuverture.split('T')[0]
                      )
                    );
                    const finalVal = sess.soldeFinalReel ?? sess.soldeFinalTheorique ?? sess.soldeInitial;

                    return (
                      <tr key={sess.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold text-purple-900">
                          #{sess.id.slice(-6).toUpperCase()}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          {sess.utilisateurNom || 'Caissier'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {new Date(sess.dateOuverture).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {sess.dateFermeture ? new Date(sess.dateFermeture).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-700">
                          {sess.soldeInitial.toFixed(3)} DT
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-purple-700">
                          {sess.statut === 'Fermee' ? `${finalVal.toFixed(3)} DT` : 'En cours...'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            sess.statut === 'Ouverte' 
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sess.statut === 'Ouverte' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
                            {sess.statut === 'Ouverte' ? 'En Cours' : 'Clôturée (Certifiée)'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => generateZReportPdf({
                              session: sess,
                              projet: projets.find(p => p.id === sess.projetId),
                              caissier: { id: sess.utilisateurId, nom: sess.utilisateurNom, email: '', role: 'caissier', projetId: sess.projetId, statut: 'Actif' },
                              ventesSession: sSales,
                              reglementsSession: sRegs,
                              retoursSession: sRetours,
                              soldeFinalCalcule: finalVal
                            })}
                            className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                            title="Télécharger / Imprimer le Ticket Z"
                          >
                            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                            <span className="hidden sm:inline">Ticket Z</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400 text-xs">
                        Aucune session de caisse enregistrée.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CREATE MOVEMENT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-sm text-slate-900">Ajouter une Entrée ou Sortie d'Argent</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveMovement} className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Sens de l'opération</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewType('Encaissement')}
                    className={`py-2 text-xs font-bold rounded-xl border ${
                      newType === 'Encaissement' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    + Entrée d'argent
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('Décaissement')}
                    className={`py-2 text-xs font-bold rounded-xl border ${
                      newType === 'Décaissement' ? 'bg-rose-50 border-rose-500 text-rose-700' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    - Sortie d'argent
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Client ou Fournisseur</label>
                <select
                  value={newTierType}
                  onChange={(e) => setNewTierType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 mb-2"
                >
                  <option value="Client">Client</option>
                  <option value="Fournisseur">Fournisseur</option>
                  <option value="Autre">Autre / Divers</option>
                </select>

                {newTierType === 'Client' && (
                  <select
                    value={newTierId}
                    onChange={(e) => setNewTierId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  >
                    {scopedClients.map(c => (
                      <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                  </select>
                )}

                {newTierType === 'Fournisseur' && (
                  <select
                    value={newTierId}
                    onChange={(e) => setNewTierId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  >
                    {scopedFournisseurs.map(f => (
                      <option key={f.id} value={f.id}>{f.nom}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Montant (DT)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={newMontant}
                    onChange={(e) => setNewMontant(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Moyen de Paiement</label>
                  <select
                    value={newMode}
                    onChange={(e) => setNewMode(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  >
                    <option value="Espèces">Espèces</option>
                    <option value="Chèque">Chèque</option>
                    <option value="Virement">Virement</option>
                    <option value="Traite">Traite</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Banque / Compte</label>
                <input
                  type="text"
                  value={newBanque}
                  onChange={(e) => setNewBanque(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow-md cursor-pointer"
                >
                  Enregistrer l'opération
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CAMERA SCANNER MODAL (BF-PROD-020) */}
      {isCameraScannerOpen && (
        <CameraBarcodeScannerModal
          articles={articles}
          onScanSuccess={(code) => handleProcessScan(code)}
          onClose={() => setIsCameraScannerOpen(false)}
        />
      )}

      {/* DOUCHETTE SCANNER MODAL */}
      {isDouchetteModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 p-6 space-y-6 text-center text-white relative">
            
            <button 
              onClick={() => setIsDouchetteModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="space-y-2">
              <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                <span className="material-symbols-outlined text-4xl">barcode_reader</span>
              </div>
              <h3 className="font-bold text-lg text-white">Scanner avec Douchette</h3>
              <p className="text-xs text-slate-400">
                Prêt à scanner... Veuillez scanner le code-barres de l'article avec votre pistolet lecteur USB/Bluetooth.
              </p>
            </div>

            {/* Hidden/styled input that automatically grabs and retains focus */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = douchetteInput.trim();
                if (code) {
                  handleProcessScan(code);
                  // Keep track of recently scanned item names to show in the modal
                  const foundItem = articles.find(a => 
                    (a.codeBarres && a.codeBarres.some(cb => cb.trim() === code)) ||
                    a.code.trim().toLowerCase() === code.toLowerCase()
                  );
                  if (foundItem) {
                    setRecentScans(prev => [foundItem, ...prev.slice(0, 4)]);
                  }
                }
                setDouchetteInput('');
              }}
              className="space-y-4"
            >
              <input
                ref={douchetteInputRef}
                type="text"
                autoFocus
                placeholder="Le scan s'affichera ici..."
                className="w-full text-center py-3 bg-slate-950 border border-slate-700 rounded-xl text-lg font-black tracking-widest text-amber-400 placeholder-slate-800 focus:outline-none focus:border-amber-400 font-mono shadow-inner"
                value={douchetteInput}
                onChange={(e) => setDouchetteInput(e.target.value)}
                onBlur={() => {
                  // Auto re-focus if the modal is open
                  setTimeout(() => {
                    if (douchetteInputRef.current) {
                      douchetteInputRef.current.focus();
                    }
                  }, 150);
                }}
              />
              
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider animate-bounce">
                🎯 Focalisation automatique active
              </div>
            </form>

            {/* List of recent scans inside the modal */}
            {recentScans.length > 0 && (
              <div className="border-t border-slate-800 pt-4 text-left space-y-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Scans Récents :</span>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {recentScans.map((item, idx) => {
                    const storeId = selectedProjectId === 'all' ? (activeSession?.projetId || '1') : selectedProjectId;
                    const isService = item.typeArticle === 'Service';
                    const stockVal = isService ? 999 : getArticleStock(item, storeId);
                    return (
                      <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-3 bg-slate-950/60 rounded-lg border border-slate-800/40">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-bold text-slate-200 truncate max-w-56">{item.designation}</span>
                          <span className={`text-[10px] font-mono font-bold ${
                            isService ? 'text-purple-300' : stockVal <= 0 ? 'text-rose-400' : stockVal <= 5 ? 'text-amber-400' : 'text-emerald-400'
                          }`}>
                            {isService ? 'Service (Illimité)' : `Stock restant : ${stockVal} unité(s)`}
                          </span>
                        </div>
                        <span className="text-emerald-400 font-mono font-bold shrink-0">{item.prixVenteHT.toFixed(3)} DT</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={() => setIsDouchetteModalOpen(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Terminer la saisie
            </button>

          </div>
        </div>
      )}

      {/* Modal Clôture de Caisse Certifiée et Automatique */}
      {isClosingModalOpen && activeSession && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center text-purple-300">
                  <span className="material-symbols-outlined text-2xl">lock_clock</span>
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">
                    Clôture de Caisse & Ticket Z
                  </h3>
                  <p className="text-xs text-slate-300">
                    Arrêté de session individuelle • {currentUser.nom} ({currentProject?.nom || 'Boutique'})
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsClosingModalOpen(false)} 
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Double Carte : Théorique vs Comptage Physique */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Solde Théorique Calculé */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px] text-purple-600">calculate</span>
                    Solde Théorique Système
                  </span>
                  <div className="text-2xl font-black text-slate-900 tracking-tight font-mono">
                    {soldeFinalCalcule.toFixed(3)} <span className="text-xs font-bold text-slate-500">DT</span>
                  </div>
                  <p className="text-[10px] text-slate-400">Fond + Ventes Espèces + Mouvements</p>
                </div>

                {/* Saisie Montant Réel Compté */}
                <div className="p-4 bg-purple-50/60 rounded-2xl border-2 border-purple-300 text-center space-y-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-purple-800 inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px] text-purple-700">payments</span>
                    Espèces Réelles Comptées
                  </span>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={closingCountedCash}
                      onChange={(e) => setClosingCountedCash(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder={soldeFinalCalcule.toFixed(3)}
                      className="w-full text-center text-2xl font-black text-purple-950 font-mono bg-white border border-purple-200 rounded-xl py-1 px-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <p className="text-[10px] font-semibold text-purple-700">Total espèces physiques dans le tiroir</p>
                </div>
              </div>

              {/* Indicateur d'Écart en temps réel */}
              {(() => {
                const counted = closingCountedCash !== '' ? Number(closingCountedCash) : soldeFinalCalcule;
                const diff = counted - soldeFinalCalcule;
                const isZero = Math.abs(diff) < 0.001;
                const isPositive = diff > 0.001;
                return (
                  <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                    isZero 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : isPositive
                        ? 'bg-blue-50 border-blue-200 text-blue-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">
                        {isZero ? 'check_circle' : isPositive ? 'trending_up' : 'warning'}
                      </span>
                      <span>
                        {isZero ? 'Caisse Conforme (Aucun écart)' : isPositive ? 'Excédent constaté au comptage' : 'Manquant constaté au comptage'}
                      </span>
                    </div>
                    <span className="font-mono text-sm font-black">
                      {isZero ? 'Écart : 0.000 DT' : `Écart : ${isPositive ? '+' : ''}${diff.toFixed(3)} DT`}
                    </span>
                  </div>
                );
              })()}

              {/* Tableau de décomposition détaillée */}
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-amber-500">savings</span>
                    Fonds de caisse initial (Ouverture) :
                  </span>
                  <span className="font-mono font-bold text-slate-900">{activeSession.soldeInitial.toFixed(3)} DT</span>
                </div>

                <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-500">payments</span>
                    (+) Encaissements Ventes en Espèces :
                  </span>
                  <span className="font-mono font-bold text-emerald-600">+{totalVentesEspeces.toFixed(3)} DT</span>
                </div>

                {sessionReglementsManuels.encaissementsEspeces > 0 && (
                  <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-emerald-500">add_circle</span>
                      (+) Entrées d'espèces manuelles :
                    </span>
                    <span className="font-mono font-bold text-emerald-600">+{sessionReglementsManuels.encaissementsEspeces.toFixed(3)} DT</span>
                  </div>
                )}

                {sessionReglementsManuels.decaissementsEspeces > 0 && (
                  <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-rose-500">remove_circle</span>
                      (-) Décaissements / Dépenses espèces :
                    </span>
                    <span className="font-mono font-bold text-rose-600">-{sessionReglementsManuels.decaissementsEspeces.toFixed(3)} DT</span>
                  </div>
                )}

                {totalRetoursEspeces > 0 && (
                  <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-rose-600">assignment_return</span>
                      (-) Remboursements Retours Espèces ({sessionRetours.filter(r => r.modeRemboursement === 'Espèces').length}) :
                    </span>
                    <span className="font-mono font-bold text-rose-600">-{totalRetoursEspeces.toFixed(3)} DT</span>
                  </div>
                )}

                {totalRetoursAvoir > 0 && (
                  <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-amber-600">confirmation_number</span>
                      Bons d'Avoir émis (hors espèces) ({sessionRetours.filter(r => r.modeRemboursement === 'Avoir').length}) :
                    </span>
                    <span className="font-mono font-bold text-amber-700">{totalRetoursAvoir.toFixed(3)} DT</span>
                  </div>
                )}

                <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-purple-600">point_of_sale</span>
                    Chiffre d'Affaires Net Session :
                  </span>
                  <span className="font-mono font-bold text-purple-700">{caNetSession.toFixed(3)} DT</span>
                </div>

                <div className="flex justify-between items-center py-1 text-slate-600 font-semibold border-b border-slate-200/60">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-indigo-500">account_balance</span>
                    Chèques collectés (hors espèces) :
                  </span>
                  <span className="font-mono font-bold text-indigo-700">{totalVentesCheque.toFixed(3)} DT</span>
                </div>

                <div className="pt-1.5 flex justify-between items-center text-xs font-black text-slate-950 uppercase">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-purple-600">calculate</span>
                    Solde Théorique Attendu :
                  </span>
                  <span className="font-mono text-purple-700">{soldeFinalCalcule.toFixed(3)} DT</span>
                </div>
              </div>

              {/* Remarques / Observations de clôture */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Remarques / Justification éventuelle (facultatif)
                </label>
                <textarea
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-purple-500 min-h-[50px]"
                  placeholder="Ex: Clôture fin de shift, RAS, ou explication de l'écart..."
                />
              </div>

              {/* Boutons d'actions */}
              <div className="pt-1 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsClosingModalOpen(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleCloseSession}
                  className="flex-[2] py-3 bg-gradient-to-r from-rose-600 to-purple-600 hover:from-rose-700 hover:to-purple-700 text-white font-black text-xs rounded-xl shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                  <span>Confirmer la Clôture & Télécharger Ticket Z</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* MODAL GESTION DES RETOURS & AVOIRS DE CAISSE */}
      {isPosReturnModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 my-8 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-xl">assignment_return</span>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">
                    Gestion des Retours & Avoirs
                  </h2>
                  <p className="text-xs text-slate-500">
                    Session Caisse : <span className="font-semibold text-slate-700">{currentUser.nom}</span> • Boutique {currentProject?.nom || ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex bg-slate-100 p-1 rounded-xl text-xs">
                  <button
                    type="button"
                    onClick={() => setPosReturnActiveTab('nouveau')}
                    className={`px-3 py-1.5 font-bold rounded-lg transition-colors cursor-pointer ${
                      posReturnActiveTab === 'nouveau' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Nouveau Retour
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosReturnActiveTab('historique')}
                    className={`px-3 py-1.5 font-bold rounded-lg transition-colors cursor-pointer ${
                      posReturnActiveTab === 'historique' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Historique ({scopedRetours.length})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPosReturnModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg cursor-pointer"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>
            </div>

            {/* Tab: Nouveau Retour */}
            {posReturnActiveTab === 'nouveau' && (
              <form onSubmit={handlePosSubmitReturn} className="flex-1 overflow-y-auto py-4 space-y-4">
                {/* Mode: avec ticket vs sans ticket */}
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-max">
                  <button
                    type="button"
                    onClick={() => {
                      setPosReturnType('ticket');
                      setPosReturnLines([]);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      posReturnType === 'ticket' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    À partir d'un Ticket / Facture
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPosReturnType('libre');
                      setPosReturnSelectedSaleId('');
                      const defArt = articles[0];
                      if (defArt) {
                        const tvaRate = defArt.tva ?? 19;
                        const puTTC = Number((defArt.prixVenteHT * (1 + tvaRate / 100)).toFixed(3));
                        setPosReturnLines([{
                          articleId: defArt.id,
                          articleCode: defArt.code,
                          designation: defArt.designation,
                          quantiteVendue: 1,
                          quantiteRetournee: 1,
                          prixUnitaire: puTTC,
                          tauxTVA: tvaRate,
                          prixUnitaireHT: defArt.prixVenteHT,
                          motif: 'Changement d\'avis',
                          remettreEnStock: true
                        }]);
                      }
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      posReturnType === 'libre' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Retour direct sans ticket
                  </button>
                </div>

                {/* Recherche & Sélection de vente */}
                {posReturnType === 'ticket' && (
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Sélectionner le ticket ou la facture de vente
                    </label>
                    <input
                      type="text"
                      placeholder="Rechercher par N° ticket (V-...) ou nom du client..."
                      value={posReturnTicketSearch}
                      onChange={(e) => setPosReturnTicketSearch(e.target.value)}
                      className="w-full px-3 py-1.5 mb-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                    />

                    <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
                      {posAvailableSales.map(v => (
                        <div
                          key={v.id}
                          onClick={() => handlePosSelectSale(v)}
                          className={`p-2.5 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                            posReturnSelectedSaleId === v.id ? 'bg-indigo-50 border-l-4 border-indigo-600' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div>
                            <span className="font-mono font-bold text-slate-900">{v.numero}</span>
                            <span className="text-slate-400 mx-1.5">•</span>
                            <span className="text-slate-600">{v.clientNom}</span>
                            <span className="text-slate-400 mx-1.5">•</span>
                            <span className="text-slate-500">{v.date}</span>
                          </div>
                          <span className="font-mono font-bold text-indigo-600">
                            {v.montantTTC.toFixed(3)} DT
                          </span>
                        </div>
                      ))}
                      {posAvailableSales.length === 0 && (
                        <p className="p-3 text-center text-xs text-slate-400">Aucune vente trouvée.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Client selector if return is direct */}
                {posReturnType === 'libre' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Client</label>
                    <select
                      value={posReturnClientId}
                      onChange={(e) => setPosReturnClientId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                    >
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.nom} ({c.telephone || 'Client'})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Table of items to return */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800">Articles à retourner</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        TTC (TVA comprise)
                      </span>
                    </div>
                    {posReturnType === 'libre' && (
                      <button
                        type="button"
                        onClick={() => {
                          const defArt = articles[0];
                          if (defArt) {
                            const tvaRate = defArt.tva ?? 19;
                            const puTTC = Number((defArt.prixVenteHT * (1 + tvaRate / 100)).toFixed(3));
                            setPosReturnLines(prev => [...prev, {
                              articleId: defArt.id,
                              articleCode: defArt.code,
                              designation: defArt.designation,
                              quantiteVendue: 1,
                              quantiteRetournee: 1,
                              prixUnitaire: puTTC,
                              tauxTVA: tvaRate,
                              prixUnitaireHT: defArt.prixVenteHT,
                              motif: 'Changement d\'avis',
                              remettreEnStock: true
                            }]);
                          }
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">add</span>
                        Ajouter un article
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/60 text-slate-500 font-semibold text-[11px] border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">Article</th>
                          {posReturnType === 'ticket' && <th className="py-2 px-2 text-center">Qté Vendue</th>}
                          <th className="py-2 px-2 text-center w-28">Qté à Retourner</th>
                          <th className="py-2 px-2 text-right">P.U TTC (DT)</th>
                          <th className="py-2 px-3">Motif</th>
                          <th className="py-2 px-2 text-center">Remettre stock</th>
                          <th className="py-2 px-3 text-right">Total TTC (DT)</th>
                          {posReturnType === 'libre' && <th className="py-2 px-2 text-center w-8"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {posReturnLines.map((l, index) => (
                          <tr key={index} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3">
                              {posReturnType === 'libre' ? (
                                <select
                                  value={l.articleId}
                                  onChange={(e) => {
                                    const art = articles.find(a => a.id === e.target.value);
                                    if (art) {
                                      const tvaRate = art.tva ?? 19;
                                      const puTTC = Number((art.prixVenteHT * (1 + tvaRate / 100)).toFixed(3));
                                      setPosReturnLines(prev => prev.map((item, idx) => idx === index ? {
                                        ...item,
                                        articleId: art.id,
                                        articleCode: art.code,
                                        designation: art.designation,
                                        prixUnitaire: puTTC,
                                        tauxTVA: tvaRate,
                                        prixUnitaireHT: art.prixVenteHT
                                      } : item));
                                    }
                                  }}
                                  className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                                >
                                  {articles.map(a => (
                                    <option key={a.id} value={a.id}>
                                      {a.designation} ({(a.prixVenteHT * (1 + (a.tva ?? 19) / 100)).toFixed(3)} DT TTC)
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div>
                                  <p className="font-semibold text-slate-900">{l.designation}</p>
                                  {l.articleCode && <p className="text-[10px] text-slate-400 font-mono">{l.articleCode}</p>}
                                </div>
                              )}
                            </td>

                            {posReturnType === 'ticket' && (
                              <td className="py-2.5 px-2 text-center font-mono text-slate-500">
                                {l.quantiteVendue}
                              </td>
                            )}

                            <td className="py-2.5 px-2 text-center">
                              <input
                                type="number"
                                min="0"
                                max={posReturnType === 'ticket' ? l.quantiteVendue : 999}
                                value={l.quantiteRetournee}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  setPosReturnLines(prev => prev.map((item, idx) => idx === index ? {
                                    ...item,
                                    quantiteRetournee: posReturnType === 'ticket' ? Math.min(val, item.quantiteVendue) : val
                                  } : item));
                                }}
                                className="w-18 px-2 py-1 text-center font-mono font-bold text-xs bg-white border border-slate-200 rounded"
                              />
                            </td>

                            <td className="py-2.5 px-2 text-right font-mono text-slate-700">
                              <span className="font-semibold">{l.prixUnitaire.toFixed(3)}</span>
                              {l.tauxTVA !== undefined && (
                                <span className="block text-[10px] text-slate-400 font-sans">TVA {l.tauxTVA}%</span>
                              )}
                            </td>

                            <td className="py-2.5 px-3">
                              <select
                                value={l.motif}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPosReturnLines(prev => prev.map((item, idx) => idx === index ? { ...item, motif: val } : item));
                                }}
                                className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                              >
                                <option value="Changement d'avis">Changement d'avis</option>
                                <option value="Défectueux">Défectueux</option>
                                <option value="Erreur de référence">Erreur de référence</option>
                                <option value="Non conforme">Non conforme</option>
                                <option value="Article endommagé">Article endommagé</option>
                                <option value="Autre">Autre</option>
                              </select>
                            </td>

                            <td className="py-2.5 px-2 text-center">
                              <input
                                type="checkbox"
                                checked={l.remettreEnStock}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setPosReturnLines(prev => prev.map((item, idx) => idx === index ? { ...item, remettreEnStock: checked } : item));
                                }}
                                className="w-4 h-4 text-indigo-600 rounded cursor-pointer"
                              />
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {(l.quantiteRetournee * l.prixUnitaire).toFixed(3)} DT
                            </td>

                            {posReturnType === 'libre' && (
                              <td className="py-2.5 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setPosReturnLines(prev => prev.filter((_, idx) => idx !== index))}
                                  className="text-slate-400 hover:text-rose-600 cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-base">delete</span>
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}

                        {posReturnLines.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-6 text-slate-400">
                              Sélectionnez une vente ci-dessus pour charger ses articles.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mode de restitution & Récapitulatif */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Mode de restitution du montant
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer">
                        <input
                          type="radio"
                          name="posRefundMode"
                          value="Espèces"
                          checked={posReturnRefundMode === 'Espèces'}
                          onChange={() => setPosReturnRefundMode('Espèces')}
                          className="text-indigo-600"
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">Remboursement Espèces (Tiroir Caisse)</p>
                          <p className="text-[10px] text-slate-500">Déduit directement de la caisse (décaissement immédiat du tiroir)</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer">
                        <input
                          type="radio"
                          name="posRefundMode"
                          value="Avoir"
                          checked={posReturnRefundMode === 'Avoir'}
                          onChange={() => setPosReturnRefundMode('Avoir')}
                          className="text-indigo-600"
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">Avoir Client (Bon d'achat)</p>
                          <p className="text-[10px] text-slate-500">Génère un bon d'avoir pour un prochain achat (aucun décaissement)</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer">
                        <input
                          type="radio"
                          name="posRefundMode"
                          value="Échange"
                          checked={posReturnRefundMode === 'Échange'}
                          onChange={() => setPosReturnRefundMode('Échange')}
                          className="text-indigo-600"
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">Échange direct d'article</p>
                          <p className="text-[10px] text-slate-500">Échange en magasin sans sortie de fonds</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Motif général / Remarque
                      </label>
                      <textarea
                        rows={2}
                        value={posReturnMotif}
                        onChange={(e) => setPosReturnMotif(e.target.value)}
                        placeholder="Observation sur le retour..."
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                      />
                    </div>

                    <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-100 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
                          Montant à Rembourser / Avoir (TTC)
                        </p>
                        <p className="text-[11px] text-indigo-600">
                          {posReturnRefundMode === 'Espèces' ? 'Espèces TTC à retirer du tiroir (TVA comprise)' : 'Montant TTC du bon d\'avoir (TVA comprise)'}
                        </p>
                      </div>
                      <span className="text-xl font-black font-mono text-indigo-700 tabular-nums">
                        {posReturnLines.reduce((acc, l) => acc + (l.quantiteRetournee * l.prixUnitaire), 0).toFixed(3)} DT
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsPosReturnModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={posReturnLines.filter(l => l.quantiteRetournee > 0).length === 0}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-lg">check</span>
                    <span>Valider le Retour</span>
                  </button>
                </div>
              </form>
            )}

            {/* Tab: Historique des Retours */}
            {posReturnActiveTab === 'historique' && (
              <div className="flex-1 overflow-y-auto py-4">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">N° Retour</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Ticket Vente</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-2 text-right">Montant</th>
                        <th className="py-2.5 px-3 text-center">Restitution</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scopedRetours.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">{r.numero}</td>
                          <td className="py-2.5 px-3 text-slate-600">{r.date}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">{r.venteNumero || 'Direct'}</td>
                          <td className="py-2.5 px-3 text-slate-900 font-medium">{r.clientNom}</td>
                          <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                            {r.montantTotal.toFixed(3)} DT
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                              {r.modeRemboursement}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setPosViewingReturn(r)}
                                className="p-1 text-slate-400 hover:text-indigo-600 rounded cursor-pointer"
                                title="Voir détails"
                              >
                                <span className="material-symbols-outlined text-base">visibility</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => generateReturnSlipPdf(r, currentProject)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                                title="Imprimer Bon de Retour (PDF)"
                              >
                                <span className="material-symbols-outlined text-base">picture_as_pdf</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {scopedRetours.length === 0 && (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-400">
                            Aucun retour enregistré pour cette boutique.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL VOIR DETAIL RETOUR */}
      {posViewingReturn && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">
                Détail Bon de Retour {posViewingReturn.numero}
              </h3>
              <button
                type="button"
                onClick={() => setPosViewingReturn(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="py-3 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg">
                <div>
                  <span className="text-slate-400 block text-[10px]">Client</span>
                  <span className="font-semibold text-slate-900">{posViewingReturn.clientNom}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Mode de restitution</span>
                  <span className="font-bold text-indigo-700">{posViewingReturn.modeRemboursement}</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="py-1.5 px-2">Article</th>
                      <th className="py-1.5 px-2 text-center">Qté</th>
                      <th className="py-1.5 px-2 text-right">P.U TTC (DT)</th>
                      <th className="py-1.5 px-2 text-right">Total TTC (DT)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {posViewingReturn.lignes.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-2 font-medium">{l.designation}</td>
                        <td className="py-1.5 px-2 text-center font-mono">{l.quantiteRetournee}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{l.prixUnitaire.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold">{(l.quantiteRetournee * l.prixUnitaire).toFixed(3)} DT</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
                <span className="font-bold text-slate-700">Total :</span>
                <span className="font-mono font-bold text-rose-600">{posViewingReturn.montantTotal.toFixed(3)} DT</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => generateReturnSlipPdf(posViewingReturn, currentProject)}
                className="px-3 py-1.5 bg-slate-900 text-white font-bold text-xs rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
                <span>Imprimer (PDF)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TICKET DE PANIER MODAL */}


      {selectedTicketVente && (
        <TicketPanierModal
          vente={selectedTicketVente}
          client={clients.find(c => c.id === selectedTicketVente.clientId || c.nom === selectedTicketVente.clientNom)}
          projet={projets.find(p => p.id === selectedTicketVente.projetId) || currentProject || projets[0]}
          currentUser={currentUser}
          onClose={() => setSelectedTicketVente(null)}
        />
      )}
    </div>
  );
}
