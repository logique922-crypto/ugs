import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatWidget } from './components/ChatWidget';
import { Dashboard } from './components/Dashboard';
import { Projets } from './components/Projets';
import { Articles } from './components/Articles';
import { Categories } from './components/Categories';
import { Clients } from './components/Clients';
import { Fournisseurs } from './components/Fournisseurs';
import { Stock } from './components/Stock';
import { Ventes } from './components/Ventes';
import { Achats } from './components/Achats';
import { Credits } from './components/Credits';
import { Caisse } from './components/Caisse';
import { Login } from './components/Login';
import { AdminUsers } from './components/AdminUsers';
import { AdminStatistics } from './components/AdminStatistics';
import { AdminAuditLogs } from './components/AdminAuditLogs';
import { GlobalSearch } from './components/GlobalSearch';
import { Rapports } from './components/Rapports';
import { PredictiveAnalytics } from './components/PredictiveAnalytics';
import { Objectifs } from './components/Objectifs';
import GestionStocks from './components/GestionStocks';
import { NotificationsPanel } from './components/NotificationsPanel';
import BonsDeLivraison from './components/BonsDeLivraison';
import BonsDAchat from './components/BonsDAchat';
import BonsDeSortie from './components/BonsDeSortie';
import Retours from './components/Retours';
import { OfflineIndicator } from './components/OfflineIndicator';
import { 
  mockProjets as initialProjets, 
  mockArticles as initialArticles, 
  mockMouvements as initialMouvements, 
  mockClients as initialClients, 
  mockFournisseurs as initialFournisseurs,
  mockVentes as initialVentes,
  mockAchats as initialAchats,
  mockReglements as initialReglements,
  mockRelances as initialRelances,
  mockObjectifs as initialObjectifs,
  mockBonsDeLivraison as initialBonsDeLivraison,
  mockStockOperations as initialStockOperations,
  mockRetoursMarchandise as initialRetoursMarchandise,
  mockRetoursVente,
  mockBonsDAchat as initialBonsDAchat,
  mockBonsDeSortie as initialBonsDeSortie,
  mockUsers,
  mockSessionsCaisse as initialSessionsCaisse,
  mockActionLogsCaisse as initialActionLogsCaisse
} from './data';
import { 
  Projet, 
  Article, 
  MouvementStock, 
  Client, 
  Fournisseur, 
  Vente, 
  Achat, 
  Reglement, 
  RelanceClient, 
  SessionActionLog,
  SessionCaisse,
  BonDeLivraison,
  StockOperation,
  RetourMarchandise,
  RetourVente,
  BonDAchat,
  BonDeSortie,
  AuditLog,
  TabType, 
  Utilisateur,
  Role
} from './types';

export default function App() {
  const [currentUser, setCurrentUser] = useState<Utilisateur | null>(() => {
    try {
      const saved = localStorage.getItem('ugs_current_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [impersonatorAdmin, setImpersonatorAdmin] = useState<Utilisateur | null>(() => {
    try {
      const saved = localStorage.getItem('ugs_impersonator');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem('ugs_active_tab');
    return (saved as TabType) || 'dashboard';
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return localStorage.getItem('ugs_selected_project') || 'all';
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  React.useEffect(() => {
    localStorage.setItem('ugs_active_tab', activeTab);
  }, [activeTab]);

  React.useEffect(() => {
    localStorage.setItem('ugs_selected_project', selectedProjectId);
  }, [selectedProjectId]);

  React.useEffect(() => {
    if (currentUser) {
      localStorage.setItem('ugs_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('ugs_current_user');
    }
  }, [currentUser]);

  React.useEffect(() => {
    if (impersonatorAdmin) {
      localStorage.setItem('ugs_impersonator', JSON.stringify(impersonatorAdmin));
    } else {
      localStorage.removeItem('ugs_impersonator');
    }
  }, [impersonatorAdmin]);

  React.useEffect(() => {
    localStorage.setItem('ugs_active_tab', activeTab);
  }, [activeTab]);

  // Global State for ERP Entities with rich default mock data
  const [projets, setProjets] = useState<Projet[]>(initialProjets);
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [mouvements, setMouvements] = useState<MouvementStock[]>(initialMouvements);
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>(initialFournisseurs);
  const [ventes, setVentes] = useState<Vente[]>(initialVentes);
  const [achats, setAchats] = useState<Achat[]>(initialAchats);
  const [reglements, setReglements] = useState<Reglement[]>(initialReglements);
  const [relances, setRelances] = useState<RelanceClient[]>(initialRelances);
  const [objectifs, setObjectifs] = useState<any[]>(initialObjectifs);
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[]>(mockUsers);
  const [sessionsCaisse, setSessionsCaisse] = useState<SessionCaisse[]>(() => {
    try {
      const saved = localStorage.getItem('ugs_sessions_caisse');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return initialSessionsCaisse;
    } catch {
      return initialSessionsCaisse;
    }
  });
  const [actionLogs, setActionLogs] = useState<SessionActionLog[]>(initialActionLogsCaisse);

  // Bon de Livraison (BL), Bon d'Achat (BA), Bon de Sortie (BS) States
  const [bonsDeLivraison, setBonsDeLivraison] = useState<BonDeLivraison[]>(initialBonsDeLivraison);
  const [bonsDAchat, setBonsDAchat] = useState<BonDAchat[]>(initialBonsDAchat);
  const [bonsDeSortie, setBonsDeSortie] = useState<BonDeSortie[]>(initialBonsDeSortie);
  const [stockOperations, setStockOperations] = useState<StockOperation[]>(initialStockOperations);
  const [retoursMarchandise, setRetoursMarchandise] = useState<RetourMarchandise[]>(initialRetoursMarchandise);
  const [retoursVente, setRetoursVente] = useState<RetourVente[]>(mockRetoursVente);

  const [isLoading, setIsLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // On mount, load actual data from the live server/database
  React.useEffect(() => {
    async function fetchDBData() {
      try {
        const response = await fetch('/api/initial-data');
        const json = await response.json();
        if (json.success && json.data) {
          const d = json.data;
          if (d.projets && d.projets.length > 0) setProjets(d.projets);
          if (d.articles && d.articles.length > 0) setArticles(d.articles);
          if (d.clients && d.clients.length > 0) setClients(d.clients);
          if (d.fournisseurs && d.fournisseurs.length > 0) setFournisseurs(d.fournisseurs);
          if (d.utilisateurs && d.utilisateurs.length > 0) setUtilisateurs(d.utilisateurs);
          if (d.mouvements && d.mouvements.length > 0) setMouvements(d.mouvements);
          if (d.ventes && d.ventes.length > 0) setVentes(d.ventes);
          if (d.achats && d.achats.length > 0) setAchats(d.achats);
          if (d.reglements && d.reglements.length > 0) setReglements(d.reglements);
          if (d.bonsDeLivraison && d.bonsDeLivraison.length > 0) setBonsDeLivraison(d.bonsDeLivraison);
          if (d.bonsDAchat && d.bonsDAchat.length > 0) setBonsDAchat(d.bonsDAchat);
          if (d.bonsDeSortie && d.bonsDeSortie.length > 0) setBonsDeSortie(d.bonsDeSortie);
          if (d.sessionsCaisse && Array.isArray(d.sessionsCaisse) && d.sessionsCaisse.length > 0) {
            setSessionsCaisse(prev => {
              const map = new Map<string, SessionCaisse>();
              d.sessionsCaisse.forEach((s: SessionCaisse) => map.set(s.id, s));
              prev.forEach((s: SessionCaisse) => {
                if (!map.has(s.id) && s.statut === 'Ouverte') {
                  map.set(s.id, s);
                }
              });
              const merged = Array.from(map.values());
              try {
                localStorage.setItem('ugs_sessions_caisse', JSON.stringify(merged));
              } catch {}
              return merged;
            });
          }
          if (d.stockOperations && d.stockOperations.length > 0) setStockOperations(d.stockOperations);
          if (d.retoursMarchandise && d.retoursMarchandise.length > 0) setRetoursMarchandise(d.retoursMarchandise);
          if (d.retoursVente && d.retoursVente.length > 0) setRetoursVente(d.retoursVente);
          if (d.auditLogs && d.auditLogs.length > 0) setAuditLogs(d.auditLogs);
        }
      } catch (error) {
        console.error("Erreur de chargement des données depuis MySQL:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchDBData();
  }, []);

  // Real-Time WebSocket Synchronization Hook for Cache & Multi-User State
  React.useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    let socket: WebSocket | null = null;
    let reconnectTimeout: any = null;

    function connectWs() {
      try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          console.log("⚡ [App WS] Connecté au serveur de synchronisation temps réel.");
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'stock_change' && data.payload) {
              const { articleId, stockGlobal, stocks } = data.payload;
              setArticles(prev => prev.map(a => {
                if (a.id === articleId) {
                  return {
                    ...a,
                    stock: stockGlobal !== undefined ? stockGlobal : a.stock,
                    stockGlobal: stockGlobal !== undefined ? stockGlobal : a.stockGlobal,
                    stocks: stocks ? { ...a.stocks, ...stocks } : a.stocks
                  };
                }
                return a;
              }));
            } else if (data.type === 'new_order' && data.payload) {
              const newVente = data.payload;
              setVentes(prev => {
                if (prev.some(v => v.id === newVente.id)) return prev;
                return [newVente, ...prev];
              });
            } else if (data.type === 'notification' && data.payload) {
              const notif = data.payload;
              window.dispatchEvent(new CustomEvent('erp_notification_ws', { detail: notif }));
              setAuditLogs(prev => [
                {
                  id: notif.id || `notif-${Date.now()}`,
                  timestamp: new Date().toLocaleString('fr-FR'),
                  utilisateurNom: 'Système',
                  utilisateurEmail: 'system@erp.tn',
                  projetId: '1',
                  action: notif.title || 'Notification Système',
                  categorie: 'Système',
                  nouvelleValeur: notif.message || ''
                },
                ...prev
              ]);
            } else if (data.type === 'session_caisse_update' && data.payload) {
              const updatedSession = data.payload;
              setSessionsCaisse(prev => {
                const exists = prev.some(s => s.id === updatedSession.id);
                if (exists) {
                  return prev.map(s => s.id === updatedSession.id ? { ...s, ...updatedSession } : s);
                }
                return [updatedSession, ...prev];
              });
            } else if (data.type === 'pos_cart_update') {
              window.dispatchEvent(new CustomEvent('pos_cart_update_ws', { detail: data.payload }));
            }
          } catch (err) {
            console.error("Erreur de parsing du message WebSocket:", err);
          }
        };

        socket.onclose = () => {
          reconnectTimeout = setTimeout(connectWs, 3000);
        };

        socket.onerror = () => {
          if (socket) socket.close();
        };
      } catch (e) {
        console.error("Erreur de connexion WebSocket:", e);
      }
    }

    connectWs();

    return () => {
      if (socket) socket.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Automated live state persistence sync handlers to keep the MySQL database perfectly in sync in real-time
  const handleArticlesChange = async (newArticles: Article[] | ((prev: Article[]) => Article[])) => {
    const nextVal = typeof newArticles === 'function' ? newArticles(articles) : newArticles;
    setArticles(nextVal);
    
    // Find if something was added/updated
    const updatedItems = nextVal.filter(n => {
      const old = articles.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    
    for (const updated of updatedItems) {
      await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    // Find if something was deleted
    const deleted = articles.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/articles/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleClientsChange = async (newClients: Client[] | ((prev: Client[]) => Client[])) => {
    const nextVal = typeof newClients === 'function' ? newClients(clients) : newClients;
    setClients(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = clients.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = clients.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/clients/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleFournisseursChange = async (newFournisseurs: Fournisseur[] | ((prev: Fournisseur[]) => Fournisseur[])) => {
    const nextVal = typeof newFournisseurs === 'function' ? newFournisseurs(fournisseurs) : newFournisseurs;
    setFournisseurs(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = fournisseurs.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/fournisseurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = fournisseurs.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/fournisseurs/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleVentesChange = async (newVentes: Vente[] | ((prev: Vente[]) => Vente[])) => {
    const nextVal = typeof newVentes === 'function' ? newVentes(ventes) : newVentes;
    setVentes(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = ventes.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      try {
        const res = await fetch('/api/ventes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated)
        });
        if (res.ok) {
          const resData = await res.json();
          if (resData && (resData.id !== updated.id || resData.numero !== updated.numero)) {
            setVentes(prev => prev.map(v => v.id === updated.id ? { ...v, id: resData.id, numero: resData.numero } : v));
          }
        }
      } catch (err) {
        console.error('Erreur sauvegarde vente:', err);
      }
    }

    const deleted = ventes.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/ventes/${deleted.id}`, { method: 'DELETE' });
    }
  };

  // Application locale (sans ré-envoi API) d'un encaissement caisse déjà confirmé par le serveur
  const handlePosSaleRecorded = (r: { vente: Vente; reglement: Reglement; mouvements: MouvementStock[]; stocks: Array<{ articleId: string; stockGlobal: number; stocks: Record<string, number> }> }) => {
    setVentes(prev => [r.vente, ...prev.filter(v => v.id !== r.vente.id)]);
    setReglements(prev => [r.reglement, ...prev.filter(x => x.id !== r.reglement.id)]);
    if (r.mouvements?.length) {
      const ids = new Set(r.mouvements.map(m => m.id));
      setMouvements(prev => [...r.mouvements, ...prev.filter(m => !ids.has(m.id))]);
    }
    if (r.stocks?.length) {
      setArticles(prev => prev.map(a => {
        const s = r.stocks.find(x => x.articleId === a.id);
        return s ? { ...a, stock: s.stockGlobal, stockGlobal: s.stockGlobal, stocks: { ...(a.stocks || {}), ...s.stocks } } : a;
      }));
    }
  };

  const handleAchatsChange = async (newAchats: Achat[] | ((prev: Achat[]) => Achat[])) => {
    const nextVal = typeof newAchats === 'function' ? newAchats(achats) : newAchats;
    setAchats(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = achats.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/achats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = achats.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/achats/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleReglementsChange = async (newReglements: Reglement[] | ((prev: Reglement[]) => Reglement[])) => {
    const nextVal = typeof newReglements === 'function' ? newReglements(reglements) : newReglements;
    setReglements(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = reglements.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/reglements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = reglements.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/reglements/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleProjetsChange = async (newProjets: Projet[] | ((prev: Projet[]) => Projet[])) => {
    const nextVal = typeof newProjets === 'function' ? newProjets(projets) : newProjets;
    setProjets(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = projets.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/projets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }
  };

  const handleUtilisateursChange = async (newUsers: Utilisateur[] | ((prev: Utilisateur[]) => Utilisateur[])) => {
    const nextVal = typeof newUsers === 'function' ? newUsers(utilisateurs) : newUsers;
    setUtilisateurs(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = utilisateurs.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/utilisateurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = utilisateurs.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/utilisateurs/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleMouvementsChange = async (newMouvements: MouvementStock[] | ((prev: MouvementStock[]) => MouvementStock[])) => {
    const nextVal = typeof newMouvements === 'function' ? newMouvements(mouvements) : newMouvements;
    setMouvements(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = mouvements.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/mouvements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }
  };

  const handleSessionsChange = async (newSessions: SessionCaisse[] | ((prev: SessionCaisse[]) => SessionCaisse[])) => {
    const nextVal = typeof newSessions === 'function' ? newSessions(sessionsCaisse) : newSessions;
    setSessionsCaisse(nextVal);
    try {
      localStorage.setItem('ugs_sessions_caisse', JSON.stringify(nextVal));
    } catch (e) {
      console.warn("Erreur sauvegarde sessions caisse dans localStorage:", e);
    }

    const updatedItems = nextVal.filter(n => {
      const old = sessionsCaisse.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });

    for (const updated of updatedItems) {
      fetch('/api/sessions-caisse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      }).catch(err => console.error("Erreur sauvegarde session caisse:", err));
    }
  };

  const handleBonsDeLivraisonChange = async (newDocs: BonDeLivraison[] | ((prev: BonDeLivraison[]) => BonDeLivraison[])) => {
    const nextVal = typeof newDocs === 'function' ? newDocs(bonsDeLivraison) : newDocs;
    setBonsDeLivraison(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = bonsDeLivraison.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/documents-logistiques/BL', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = bonsDeLivraison.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/documents-logistiques/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleBonsDAchatChange = async (newDocs: BonDAchat[] | ((prev: BonDAchat[]) => BonDAchat[])) => {
    const nextVal = typeof newDocs === 'function' ? newDocs(bonsDAchat) : newDocs;
    setBonsDAchat(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = bonsDAchat.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/documents-logistiques/BA', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = bonsDAchat.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/documents-logistiques/${deleted.id}`, { method: 'DELETE' });
    }
  };

  const handleBonsDeSortieChange = async (newDocs: BonDeSortie[] | ((prev: BonDeSortie[]) => BonDeSortie[])) => {
    const nextVal = typeof newDocs === 'function' ? newDocs(bonsDeSortie) : newDocs;
    setBonsDeSortie(nextVal);
    
    const updatedItems = nextVal.filter(n => {
      const old = bonsDeSortie.find(o => o.id === n.id);
      return !old || JSON.stringify(old) !== JSON.stringify(n);
    });
    for (const updated of updatedItems) {
      await fetch('/api/documents-logistiques/BS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    }

    const deleted = bonsDeSortie.find(o => !nextVal.some(n => n.id === o.id));
    if (deleted) {
      await fetch(`/api/documents-logistiques/${deleted.id}`, { method: 'DELETE' });
    }
  };


  // Règle d'accès stricte : Le rôle caissier ne travaille pas avec les documents commerciaux
  React.useEffect(() => {
    if (currentUser?.role === 'caissier') {
      const commercialDocTabs: TabType[] = ['factures', 'devis', 'livraisons', 'bons_achat', 'bons_sortie', 'achats'];
      if (commercialDocTabs.includes(activeTab)) {
        setActiveTab('caisse');
      }
    }
  }, [currentUser, activeTab]);

  const handleLogout = () => {
    setCurrentUser(null);
    setImpersonatorAdmin(null);
  };

  const handleLogin = (user: Utilisateur) => {
    setCurrentUser(user);
    
    const affectations = user.projetsAffectes || [];
    
    if (user.role === 'super_admin' || user.role === 'directeur') {
      setSelectedProjectId('all');
      setActiveTab('dashboard');
    } else if (user.role === 'admin') {
      // L'administrateur a l'accès sur Société UGS seulement ('1')
      setSelectedProjectId('1');
      setActiveTab('dashboard');
    } else if (user.role === 'comptable') {
      setSelectedProjectId('all');
      setActiveTab('dashboard');
    } else if (user.role === 'caissier') {
      setSelectedProjectId(affectations[0] || user.projetId || '2');
      setActiveTab('caisse');
    } else {
      // Agent commercial
      setSelectedProjectId(affectations[0] || user.projetId || '1');
      setActiveTab('ventes');
    }
  };

  const handleQuickSwitchRole = (targetRole: Role, specificEmail?: string) => {
    let targetUser: Utilisateur | undefined;
    if (specificEmail) {
      targetUser = utilisateurs.find(u => u.email.toLowerCase() === specificEmail.toLowerCase());
    }
    if (!targetUser) {
      targetUser = utilisateurs.find(u => u.role === targetRole);
    }
    if (targetUser) {
      if (currentUser && currentUser.role !== targetRole) {
        if (currentUser.role === 'super_admin' || currentUser.role === 'admin') {
          setImpersonatorAdmin(currentUser);
        }
      }
      setIsProfileMenuOpen(false);
      handleLogin(targetUser);
    }
  };

  if (!currentUser) {
    return <Login onLogin={handleLogin} users={utilisateurs} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard articles={articles} 
            currentUser={currentUser} selectedProjectId={selectedProjectId} 
            projets={projets}

            ventes={ventes}
            achats={achats}
            clients={clients}
            fournisseurs={fournisseurs}
    
            reglements={reglements}
            relances={relances}
            mouvements={mouvements}
            onTabChange={setActiveTab}
            onVentesChange={handleVentesChange}
            onAchatsChange={handleAchatsChange}
            onArticlesChange={handleArticlesChange}
            onReglementsChange={handleReglementsChange}
            onMouvementsChange={handleMouvementsChange}
          />
        );
      case 'admin':
      case 'projets':
        if (currentUser?.role !== 'super_admin') {
          return (
            <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-slate-200 m-6 max-w-2xl mx-auto">
              <span className="material-symbols-outlined text-5xl text-amber-500 mb-3">lock</span>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Accès Réseau & Système Restreint</h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                L'administrateur de la société ERP Management n'a pas accès au module Réseau & Système (Gestion des boutiques et points de vente du réseau). Cet accès est strictement réservé au Super Administrateur du groupe.
              </p>
              <button 
                onClick={() => setActiveTab('dashboard')}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Retour au Tableau de bord
              </button>
            </div>
          );
        }
        return (
          <Projets 
            projets={projets}
            onProjetsChange={handleProjetsChange} 
            currentUser={currentUser}
            onSelectProject={(id) => { setSelectedProjectId(id); setActiveTab('dashboard'); }} 
            ventes={ventes}
            achats={achats}
            articles={articles}
            clients={clients}
            utilisateurs={utilisateurs}
          />
        );
      case 'utilisateurs':
        if (currentUser?.role !== 'super_admin') {
          return (
            <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-slate-200 m-6 max-w-2xl mx-auto">
              <span className="material-symbols-outlined text-5xl text-amber-500 mb-3">lock</span>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Accès Réseau & Système Restreint</h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                L'administrateur de la société ERP Management n'a pas accès à la gestion des équipes, comptes d'accès et droits système. Cette fonction est réservée exclusivement au Super Administrateur.
              </p>
              <button 
                onClick={() => setActiveTab('dashboard')}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Retour au Tableau de bord
              </button>
            </div>
          );
        }
        return (
          <AdminUsers 
            projets={projets} 
            users={utilisateurs} 
            onUsersChange={handleUtilisateursChange} 
            currentUser={currentUser} 
            onSwitchUser={(user) => {
              setImpersonatorAdmin(currentUser);
              handleLogin(user);
            }}
          />
        );
      case 'statistiques':
        if (currentUser?.role !== 'super_admin') {
          return (
            <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-slate-200 m-6 max-w-2xl mx-auto">
              <span className="material-symbols-outlined text-5xl text-amber-500 mb-3">lock</span>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Accès Analyses Groupe Restreint</h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Les analyses financières consolidées du groupe sont réservées exclusivement au Super Administrateur.
              </p>
              <button 
                onClick={() => setActiveTab('dashboard')}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Retour au Tableau de bord
              </button>
            </div>
          );
        }
        return (
          <AdminStatistics projets={projets} ventes={ventes} achats={achats} />
        );
      case 'audit':
        return (
          <AdminAuditLogs projets={projets} auditLogs={auditLogs} />
        );
      case 'articles':
      case 'categories':
        return (
          <GestionStocks 
            currentUser={currentUser} 
            articles={articles} 
            selectedProjectId={selectedProjectId} 
            onArticlesChange={handleArticlesChange}
            mouvements={mouvements}
            onMouvementsChange={handleMouvementsChange}
            projets={projets}
            ventes={ventes}
            fournisseurs={fournisseurs}
            onGenerateAchat={(nouvelAchat) => handleAchatsChange(prev => [nouvelAchat as any, ...prev])}
            onNavigate={setActiveTab}
            initialSubTab="catalogue"
          />
        );
      case 'clients':
        return (
          <Clients currentUser={currentUser} selectedProjectId={selectedProjectId} 
            clients={clients}
            onClientsChange={handleClientsChange}
            projets={projets}

            ventes={ventes}
            onVentesChange={handleVentesChange}
            reglements={reglements}
            onReglementsChange={handleReglementsChange}
            onTabChange={setActiveTab}
          />
        );
      case 'stock':
        return (
          <GestionStocks 
            currentUser={currentUser} 
            articles={articles} 
            selectedProjectId={selectedProjectId} 
            onArticlesChange={handleArticlesChange}
            mouvements={mouvements}
            onMouvementsChange={handleMouvementsChange}
            projets={projets}
            ventes={ventes}
            fournisseurs={fournisseurs}
            onGenerateAchat={(nouvelAchat) => handleAchatsChange(prev => [nouvelAchat as any, ...prev])}
            onNavigate={setActiveTab}
            initialSubTab="catalogue"
          />
        );
      case 'fournisseurs':
        return (
          <Fournisseurs currentUser={currentUser} articles={articles} 
            selectedProjectId={selectedProjectId}
            fournisseurs={fournisseurs}
            onFournisseursChange={handleFournisseursChange}
            projets={projets}

            achats={achats}
            onAchatsChange={handleAchatsChange}
            reglements={reglements}
            onReglementsChange={handleReglementsChange}
    
            onTabChange={setActiveTab}
          />
        );
      case 'rapports':
        return (
          <Rapports 
            ventes={ventes}
            projets={projets}
            articles={articles}
            clients={clients}
            fournisseurs={fournisseurs}
            selectedProjectId={selectedProjectId}
            sessions={sessionsCaisse}
            actionLogs={actionLogs}
            bonsDeLivraison={bonsDeLivraison}
            users={utilisateurs}
            currentUser={currentUser}
          />
        );
      case 'predictive':
        return (
          <PredictiveAnalytics
            articles={articles}
            ventes={ventes}
            projets={projets}
            fournisseurs={fournisseurs}
            selectedProjectId={selectedProjectId}
            onNavigate={setActiveTab}
            onGenerateAchat={(nouvelAchat) => {
              setAchats(prev => [nouvelAchat as Achat, ...prev]);
            }}
          />
        );
      case 'objectifs':
        return (
          <Objectifs 
            objectifs={objectifs}
            setObjectifs={setObjectifs}
            ventes={ventes}
            projets={projets}
            utilisateurs={utilisateurs}
          />
        );
      case 'ventes':
        return (
          <Ventes currentUser={currentUser} articles={articles} 
            selectedProjectId={selectedProjectId}
            ventes={ventes}
            clients={clients}
            projets={projets}
            reglements={reglements}
            mouvements={mouvements}
            onVentesChange={handleVentesChange}
            onReglementsChange={handleReglementsChange}
            onClientsChange={handleClientsChange}
            onArticlesChange={handleArticlesChange}
            onMouvementsChange={handleMouvementsChange}
            activeDocType="All"
            onNavigateToCaisse={() => setActiveTab('caisse')}
          />
        );
      case 'factures':
        return (
          <Ventes currentUser={currentUser} articles={articles} 
            selectedProjectId={selectedProjectId}
            ventes={ventes}
            clients={clients}
            projets={projets}
            reglements={reglements}
            mouvements={mouvements}
            onVentesChange={handleVentesChange}
            onReglementsChange={handleReglementsChange}
            onClientsChange={handleClientsChange}
            onArticlesChange={handleArticlesChange}
            onMouvementsChange={handleMouvementsChange}
            activeDocType="Facture"
            onNavigateToCaisse={() => setActiveTab('caisse')}
          />
        );
      case 'devis':
        return (
          <Ventes currentUser={currentUser} articles={articles} 
            selectedProjectId={selectedProjectId}
            ventes={ventes}
            clients={clients}
            projets={projets}
            reglements={reglements}
            mouvements={mouvements}
            onVentesChange={handleVentesChange}
            onReglementsChange={handleReglementsChange}
            onClientsChange={handleClientsChange}
            onArticlesChange={handleArticlesChange}
            onMouvementsChange={handleMouvementsChange}
            activeDocType="Devis"
            onNavigateToCaisse={() => setActiveTab('caisse')}
          />
        );
      case 'achats':
        return (
          <Achats currentUser={currentUser} articles={articles} 
            selectedProjectId={selectedProjectId}
            achats={achats}
            fournisseurs={fournisseurs}
            onFournisseursChange={handleFournisseursChange}
            projets={projets}
            reglements={reglements}
            onAchatsChange={handleAchatsChange}
            onReglementsChange={handleReglementsChange}
            onArticlesChange={handleArticlesChange}
            mouvements={mouvements}
            onMouvementsChange={handleMouvementsChange}
          />
        );
      case 'credits':
        return (
          <Credits currentUser={currentUser} articles={articles} 
            selectedProjectId={selectedProjectId} 
            clients={clients}
            ventes={ventes}
            reglements={reglements}
            relances={relances}
            projets={projets}
            onVentesChange={handleVentesChange}
            onReglementsChange={handleReglementsChange}
            onRelancesChange={setRelances}
            onClientsChange={handleClientsChange}
          />
        );
      case 'caisse':
        return (
          <Caisse
            currentUser={currentUser!}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            reglements={reglements}
            projets={projets}
            ventes={ventes}
            achats={achats}
            clients={clients}
            fournisseurs={fournisseurs}
            articles={articles}
            mouvements={mouvements}
            sessions={sessionsCaisse}
            actionLogs={actionLogs}
            retours={retoursVente}
            onRetoursChange={setRetoursVente}
            onReglementsChange={handleReglementsChange}
            onVentesChange={handleVentesChange}
            onPosSaleRecorded={handlePosSaleRecorded}
            onArticlesChange={handleArticlesChange}
            onClientsChange={handleClientsChange}
            onMouvementsChange={handleMouvementsChange}
            onSessionsChange={handleSessionsChange}
            onActionLogsChange={setActionLogs}
          />
        );
      case 'retours':
        return (
          <Retours
            retours={retoursVente}
            onRetoursChange={setRetoursVente}
            ventes={ventes}
            articles={articles}
            onArticlesChange={handleArticlesChange}
            mouvements={mouvements}
            onMouvementsChange={handleMouvementsChange}
            reglements={reglements}
            onReglementsChange={handleReglementsChange}
            clients={clients}
            projets={projets}
            selectedProjectId={selectedProjectId}
            currentUser={currentUser!}
            sessions={sessionsCaisse}
          />
        );
      case 'livraisons':
        return (
          <BonsDeLivraison
            bonsDeLivraison={bonsDeLivraison}
            setBonsDeLivraison={handleBonsDeLivraisonChange}
            clients={clients}
            onClientsChange={handleClientsChange}
            articles={articles}
            setArticles={handleArticlesChange}
            ventes={ventes}
            setVentes={handleVentesChange}
            stockOperations={stockOperations}
            setStockOperations={setStockOperations}
            retoursMarchandise={retoursMarchandise}
            setRetoursMarchandise={setRetoursMarchandise}
            projets={projets}
            selectedProjectId={selectedProjectId}
            currentUser={currentUser}
            auditLogs={auditLogs}
            setAuditLogs={setAuditLogs}
            onNavigateToInvoice={() => setActiveTab('ventes')}
          />
        );
      case 'bons_achat':
        return (
          <BonsDAchat
            bonsDAchat={bonsDAchat}
            setBonsDAchat={handleBonsDAchatChange}
            fournisseurs={fournisseurs}
            articles={articles}
            setArticles={handleArticlesChange}
            stockOperations={stockOperations}
            setStockOperations={setStockOperations}
            projets={projets}
            selectedProjectId={selectedProjectId}
            currentUser={currentUser}
            auditLogs={auditLogs}
            setAuditLogs={setAuditLogs}
            onNavigateToAchats={() => setActiveTab('achats')}
          />
        );
      case 'bons_sortie':
        return (
          <BonsDeSortie
            bonsDeSortie={bonsDeSortie}
            setBonsDeSortie={handleBonsDeSortieChange}
            articles={articles}
            setArticles={handleArticlesChange}
            stockOperations={stockOperations}
            setStockOperations={setStockOperations}
            projets={projets}
            selectedProjectId={selectedProjectId}
            currentUser={currentUser}
            auditLogs={auditLogs}
            setAuditLogs={setAuditLogs}
          />
        );
      case 'transferts':
        return (
          <BonsDeSortie
            bonsDeSortie={bonsDeSortie}
            setBonsDeSortie={handleBonsDeSortieChange}
            articles={articles}
            setArticles={handleArticlesChange}
            stockOperations={stockOperations}
            setStockOperations={setStockOperations}
            projets={projets}
            selectedProjectId={selectedProjectId}
            currentUser={currentUser}
            auditLogs={auditLogs}
            setAuditLogs={setAuditLogs}
            forceMotif="Transfert"
          />
        );
      default:
        return (
          <Dashboard articles={articles} 
            currentUser={currentUser} selectedProjectId={selectedProjectId} 
            projets={projets}

            ventes={ventes}
            achats={achats}
            clients={clients}
            fournisseurs={fournisseurs}
    
            reglements={reglements}
            relances={relances}
            mouvements={mouvements}
            onTabChange={setActiveTab}
            onVentesChange={handleVentesChange}
            onAchatsChange={handleAchatsChange}
            onArticlesChange={handleArticlesChange}
            onReglementsChange={handleReglementsChange}
            onMouvementsChange={handleMouvementsChange}
          />
        );
    }
  };

  return (
    <div className="flex w-full h-screen overflow-hidden bg-background">
      <OfflineIndicator />
      <GlobalSearch 
        articles={articles} 
        clients={clients} 
        ventes={ventes} 
        projets={projets} 
        onNavigate={setActiveTab} 
      />
      {/* Sidebar Pro per Project Workspace */}
      <Sidebar 
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedProjectId={selectedProjectId}
        onSelectProject={(id) => {
          setSelectedProjectId(id);
        }}
        projets={projets}
        articles={articles}
        currentUser={currentUser}
        onLogout={handleLogout}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Impersonation / Test Session Banner */}
        {impersonatorAdmin && (
          <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-bold px-4 py-2 flex items-center justify-between text-xs z-30 shadow-md shrink-0 border-b border-amber-600">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-slate-950">visibility</span>
              <span>
                Mode Simulation Actif : Vous naviguez sous le compte de <strong>{currentUser?.nom}</strong> ({currentUser?.role}).
              </span>
            </div>
            <button
              onClick={() => {
                const original = impersonatorAdmin;
                setImpersonatorAdmin(null);
                handleLogin(original);
                setActiveTab('utilisateurs');
              }}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
            >
              <span className="material-symbols-outlined text-[15px]">undo</span>
              Quitter la simulation & Revenir au Super-Admin
            </button>
          </div>
        )}

        {/* Enterprise SaaS Workspace Header */}
        <header className="flex justify-between items-center h-16 px-4 md:px-6 bg-white border-b border-slate-200 z-10 shrink-0 shadow-sm">
          {/* Left section: Hamburger, Home, Project */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-slate-500">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="md:hidden p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Ouvrir le menu"
              >
                <span className="material-symbols-outlined text-[20px]">menu</span>
              </button>
            </div>
          </div>

          {/* Center section: Global Search */}
          <div className="hidden lg:flex flex-1 max-w-2xl mx-8">
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="w-full flex items-center justify-between gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 rounded-xl transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">search</span>
                <span className="text-sm font-medium">Rechercher (produits, clients, factures...)</span>
              </div>
              <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-mono text-slate-500 font-bold shadow-sm">
                Ctrl + K
              </kbd>
            </button>
          </div>

          {/* Right section: Notifications, Profile */}
          <div className="flex items-center gap-3">
            {/* Quick Mobile Search */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">search</span>
            </button>

            <NotificationsPanel 
              articles={articles} 
              ventes={ventes} 
              achats={achats} 
              objectifs={objectifs} 
              projets={projets} 
              bonsDeLivraison={bonsDeLivraison}
              bonsDeSortie={bonsDeSortie}
              currentUser={currentUser}
              onNavigate={setActiveTab} 
            />
            
            <div className="h-6 w-px bg-slate-200 mx-1"></div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="flex items-center gap-2.5 pl-1.5 pr-2.5 py-1 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer border border-transparent hover:border-slate-200"
              >
                <div className={`w-9 h-9 rounded-full font-black text-sm flex items-center justify-center border shadow-xs shrink-0 ${
                  currentUser?.role === 'caissier'
                    ? 'bg-purple-100 text-purple-700 border-purple-300'
                    : currentUser?.role === 'super_admin'
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                    : 'bg-blue-100 text-blue-700 border-blue-200'
                }`}>
                  {currentUser?.nom?.charAt(0) || 'U'}
                </div>
                <div className="hidden sm:flex flex-col items-start text-left">
                  <span className="font-bold text-xs text-slate-800 leading-tight truncate max-w-[130px]">{currentUser?.nom || 'Utilisateur'}</span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider leading-tight flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${currentUser?.role === 'caissier' ? 'bg-purple-500' : 'bg-emerald-500'}`}></span>
                    {currentUser?.role === 'caissier' ? 'Caissier' : currentUser?.role === 'super_admin' ? 'Super Admin' : currentUser?.role === 'admin' ? 'Admin Dépôt' : 'Comptable'}
                  </span>
                </div>
                <span className="material-symbols-outlined text-[16px] text-slate-400">expand_more</span>
              </button>

              {/* Dropdown Menu */}
              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Connecté en tant que</p>
                    <p className="font-extrabold text-sm text-slate-900 truncate mt-0.5">{currentUser?.nom}</p>
                    <p className="text-xs text-slate-500 font-mono truncate">{currentUser?.email}</p>
                    <span className="mt-1.5 inline-block px-2.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10.5px] font-black rounded-md uppercase tracking-wider border border-indigo-200">
                      Rôle : {currentUser?.role}
                    </span>
                  </div>

                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      Déconnexion
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 pb-24 md:pb-8 bg-surface-container-lowest/50">
          {renderContent()}
        </main>

        {/* Mobile Native-Style Ergonomic Bottom Navigation Bar (md:hidden) */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-2 py-1.5 flex items-center justify-around shadow-2xl safe-area-pb">
          {(() => {
            const role = currentUser?.role;
            let navItems: { tab: TabType; label: string; icon: string; activeColor: string }[] = [];

            if (role === 'caissier') {
              navItems = [
                { tab: 'caisse', label: 'Caisse', icon: 'point_of_sale', activeColor: 'text-purple-400 bg-purple-950/60 ring-purple-500/30' },
                { tab: 'articles', label: 'Articles', icon: 'inventory_2', activeColor: 'text-indigo-400 bg-indigo-950/60 ring-indigo-500/30' },
                { tab: 'clients', label: 'Clients', icon: 'group', activeColor: 'text-emerald-400 bg-emerald-950/60 ring-emerald-500/30' },
                { tab: 'ventes', label: 'Historique', icon: 'receipt_long', activeColor: 'text-amber-400 bg-amber-950/60 ring-amber-500/30' },
              ];
            } else if (role === 'comptable') {
              navItems = [
                { tab: 'dashboard', label: 'Accueil', icon: 'space_dashboard', activeColor: 'text-blue-400 bg-blue-950/60 ring-blue-500/30' },
                { tab: 'factures', label: 'Factures', icon: 'receipt_long', activeColor: 'text-indigo-400 bg-indigo-950/60 ring-indigo-500/30' },
                { tab: 'achats', label: 'Achats', icon: 'shopping_bag', activeColor: 'text-amber-400 bg-amber-950/60 ring-amber-500/30' },
                { tab: 'credits', label: 'Créances', icon: 'account_balance_wallet', activeColor: 'text-emerald-400 bg-emerald-950/60 ring-emerald-500/30' },
              ];
            } else if (role === 'agent') {
              navItems = [
                { tab: 'dashboard', label: 'Accueil', icon: 'space_dashboard', activeColor: 'text-blue-400 bg-blue-950/60 ring-blue-500/30' },
                { tab: 'articles', label: 'Catalogue', icon: 'inventory_2', activeColor: 'text-indigo-400 bg-indigo-950/60 ring-indigo-500/30' },
                { tab: 'clients', label: 'Clients', icon: 'group', activeColor: 'text-emerald-400 bg-emerald-950/60 ring-emerald-500/30' },
                { tab: 'ventes', label: 'Commandes', icon: 'receipt_long', activeColor: 'text-amber-400 bg-amber-950/60 ring-amber-500/30' },
              ];
            } else {
              // Default for super_admin, admin, chef_projet
              navItems = [
                { tab: 'dashboard', label: 'Accueil', icon: 'space_dashboard', activeColor: 'text-blue-400 bg-blue-950/60 ring-blue-500/30' },
                { tab: 'caisse', label: 'Caisse', icon: 'point_of_sale', activeColor: 'text-purple-400 bg-purple-950/60 ring-purple-500/30' },
                { tab: 'stock', label: 'Stock', icon: 'warehouse', activeColor: 'text-indigo-400 bg-indigo-950/60 ring-indigo-500/30' },
                { tab: 'clients', label: 'Clients', icon: 'group', activeColor: 'text-emerald-400 bg-emerald-950/60 ring-emerald-500/30' },
              ];
            }

            return navItems.map((item) => {
              const isActive = activeTab === item.tab || (item.tab === 'stock' && activeTab === 'articles') || (item.tab === 'articles' && activeTab === 'stock') || (item.tab === 'factures' && activeTab === 'ventes');
              return (
                <button
                  key={item.tab}
                  type="button"
                  onClick={() => setActiveTab(item.tab)}
                  className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
                    isActive 
                      ? `${item.activeColor} font-bold ring-1 shadow-xs` 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
                  <span className="text-[10px] font-semibold tracking-tight mt-0.5">{item.label}</span>
                </button>
              );
            });
          })()}

          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center py-1 px-2.5 rounded-xl text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">menu</span>
            <span className="text-[10px] font-semibold tracking-tight mt-0.5">Plus</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
