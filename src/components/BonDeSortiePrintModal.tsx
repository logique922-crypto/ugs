import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { BonDeSortie, Projet } from '../types';
import { numberToFrenchWords } from './FacturePrintModal';

interface BonDeSortiePrintModalProps {
  bs: BonDeSortie;
  projet?: Projet | null;
  projets?: Projet[];
  onClose: () => void;
}

export function BonDeSortiePrintModal({ bs, projet, projets = [], onClose }: BonDeSortiePrintModalProps) {
  const [showPrices, setShowPrices] = useState<boolean>(true);
  const [showStamp, setShowStamp] = useState<boolean>(true);
  const isTransfert = bs.motif === 'Transfert';

  const [notes, setNotes] = useState<string>(
    bs.observations || bs.motifJustification || (isTransfert ? 'Transfert de stock inter-sites sous réserve de réception conforme.' : 'Sortie de stock validée et conforme aux procédures internes.')
  );
  const [isEditingNotes, setIsEditingNotes] = useState<boolean>(false);

  // Clean document number
  const cleanNumber = bs.numero.replace(/^(BS|TR)-/, '');

  // Document Title
  const docTitle = isTransfert ? 'BON DE TRANSFERT' : 'BON DE SORTIE';

  // Company Profile
  const cName = projet?.entrepriseNom || 'SOCIETE UNIVERS GSM DE SUD';
  const cAddress = projet?.adresse || '112, OMAR IBN KHATAB ZRIG, GABES S3';
  const cMF = projet?.matriculeFiscal || '1532846 G/A/M/000';
  const cRib = projet?.rib 
    ? `${projet.rib}${projet.banque ? ` - ${projet.banque}` : ''}`
    : '04 705 012 0051487155 82 - Attijari Bank';
  const cPhone = projet?.telephone || '75 655 555';
  const cVille = projet?.ville || 'Gabes - Tunisie';

  // Destination info
  const destBoutique = projets.find(p => p.id === bs.destinationBoutiqueId);
  const destNom = isTransfert 
    ? (destBoutique?.nom || bs.destinationBoutiqueNom || 'Boutique Réceptrice')
    : (bs.demandeur || 'Service Interne');
  const destAdresse = isTransfert ? (destBoutique?.adresse || 'Tunisie') : (bs.serviceDepartement || 'Service Technique');
  const destTel = isTransfert ? (destBoutique?.telephone || '') : '';

  const dateFormatted = bs.dateCreation 
    ? bs.dateCreation.split('-').reverse().join('/') 
    : new Date().toLocaleDateString('fr-FR');

  // Lines
  const rawLignes = bs.lignes || [];
  const lines = rawLignes.map((ligne, idx) => {
    const qte = typeof ligne.qteSortie === 'number' && ligne.qteSortie > 0 
      ? ligne.qteSortie 
      : (typeof ligne.qteDemandee === 'number' ? ligne.qteDemandee : 1);
    const puHT = typeof ligne.prixUnitaireHT === 'number' ? ligne.prixUnitaireHT : 0;
    const tauxTVA = 19;
    const totalHT = typeof ligne.totalHT === 'number' && ligne.totalHT > 0 ? ligne.totalHT : qte * puHT;
    const montantTVA = totalHT * (tauxTVA / 100);
    const totalTTC = totalHT + montantTVA;

    return {
      code: ligne.code || `ART-${String(idx + 1).padStart(3, '0')}`,
      designation: ligne.designation || 'Article',
      unite: ligne.unite || 'PCS',
      quantite: qte,
      prixUnitaireHT: puHT,
      tauxTVA,
      totalHT,
      montantTVA,
      totalTTC,
    };
  });

  const computedHT = lines.reduce((acc, l) => acc + l.totalHT, 0);
  const computedTVA = lines.reduce((acc, l) => acc + l.montantTVA, 0);
  const montantHT = computedHT;
  const montantTVA = computedTVA;
  const montantTTC = montantHT + montantTVA;

  const montantEnLettres = numberToFrenchWords(montantTTC);

  // Estimation stricte du nombre de pages basée sur le nombre de lignes
  const totalPages = lines.length <= 12 ? 1 : Math.ceil((lines.length - 12) / 22) + 1;

  return createPortal(
    <div id="print-modal-backdrop" className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-[9999] flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media screen {
          #print-modal-backdrop {
            position: fixed !important;
            inset: 0 !important;
            background: rgba(15, 23, 42, 0.75) !important;
            backdrop-filter: blur(4px) !important;
            z-index: 9999 !important;
            display: flex !important;
            align-items: flex-start !important;
            justify-content: center !important;
            overflow-y: auto !important;
            padding: 1.5rem 1rem !important;
          }
        }
        @media print {
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden !important;
          }
          #print-modal-backdrop,
          #print-modal-backdrop * {
            visibility: visible !important;
          }
          .no-print {
            display: none !important;
          }
          #print-modal-backdrop {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            opacity: 1 !important;
            pointer-events: auto !important;
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            overflow: visible !important;
          }
          .print-document {
            position: relative !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
        }
      
        /* Footer on every page: nothing above it may create a containing block for position:fixed */
        @media print {
          body > *:not(#print-modal-backdrop) {
            display: none !important;
          }
          #print-modal-backdrop,
          #print-modal-backdrop .print-document {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            filter: none !important;
            transform: none !important;
            perspective: none !important;
            contain: none !important;
            will-change: auto !important;
          }
        }
      `}</style>

      <div className="print-document bg-white text-[#172033] rounded-sm max-w-[210mm] w-full shadow-2xl my-4 print:my-0 font-sans border border-[#DCE5F0] block">
        
        {/* ACTION BAR (Non imprimée) */}
        <div className="flex flex-col gap-2.5 print:hidden border-b border-[#DCE5F0] px-6 py-3 bg-[#F5F8FC] no-print">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-[#DCE5F0] shadow-xs">
              <span className="text-[10px] font-black text-[#64748B] uppercase px-2">Affichage :</span>
              <button
                type="button"
                onClick={() => setShowPrices(true)}
                className={`px-3 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer ${
                  showPrices
                    ? 'bg-[#102F57] text-white shadow-xs'
                    : 'text-[#64748B] hover:text-[#102F57] hover:bg-[#F5F8FC]'
                }`}
              >
                Avec Valorisation HT
              </button>
              <button
                type="button"
                onClick={() => setShowPrices(false)}
                className={`px-3 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer ${
                  !showPrices
                    ? 'bg-[#102F57] text-white shadow-xs'
                    : 'text-[#64748B] hover:text-[#102F57] hover:bg-[#F5F8FC]'
                }`}
              >
                Quantités seules
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                id="btn-imprimer-bs"
                onClick={() => window.print()}
                className="px-5 py-2 bg-[#102F57] hover:bg-[#173F73] text-white rounded-lg text-xs font-bold shadow-md flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[17px]">print</span>
                Imprimer Document
              </button>
              <button 
                id="btn-fermer-bs-modal"
                onClick={onClose} 
                className="px-3.5 py-2 text-[#64748B] hover:text-[#172033] hover:bg-[#DCE5F0]/40 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                Fermer
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#64748B] font-medium pt-1 border-t border-[#DCE5F0]/60">
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showStamp}
                  onChange={(e) => setShowStamp(e.target.checked)}
                  className="rounded text-[#102F57] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                />
                <span>Afficher le cachet / signature</span>
              </label>

              <span className="flex items-center gap-1 text-[10.5px] text-[#102F57] font-bold">
                <span className="material-symbols-outlined text-xs">category</span>
                Motif : {bs.motif}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-[#102F57]">check_circle</span>
              <span className="text-[10px] text-[#64748B]">{docTitle} N° {cleanNumber}</span>
            </div>
          </div>
        </div>

        {/* TOP ACCENT BAR */}

        {/* DOCUMENT MAIN BODY */}
        <table className="w-full border-none">
          <thead className="table-header-group">
            <tr>
              <td className="p-0 border-none">
                <div className="h-2.5 bg-[#102F57] relative overflow-hidden shrink-0"> <div className="absolute top-0 right-0 w-32 h-full bg-[#D41468] -skew-x-12 translate-x-12"></div> </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-0 border-none align-top">
                <div className="flex flex-col print:min-h-[270mm]">
                <div className="p-0 bg-white block">
          
          <div className="block">
            {/* HEADER */}
            <div className="pt-8 pb-5 px-10 flex justify-between items-start">
              <div className="space-y-4 flex-1 pr-6">
                <h1 className="text-2xl font-black text-[#102F57] uppercase tracking-tight leading-none">
                  {cName}
                </h1>
                
                <div className="space-y-1.5 text-[10.5px] font-medium text-[#64748B]">
                  <p className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[15px] text-[#102F57]">location_on</span>
                    <span>Adresse : {cAddress}</span>
                  </p>
                  <p className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[15px] text-[#102F57]">badge</span>
                    <span>M.F : {cMF}</span>
                  </p>
                  <p className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[15px] text-[#102F57]">account_balance</span>
                    <span>RIB : {cRib}</span>
                  </p>
                </div>
              </div>

              {/* LOGO */}
              <div className="w-80 flex flex-col items-end shrink-0">
                <div className="rounded-lg border-2 border-[#DCE5F0] bg-white shadow-sm flex items-center justify-center min-h-[120px] min-w-[200px] p-2">
                  <img 
                    src={projet?.logoUrl || '/image.png'} 
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== `${window.location.origin}/logo.png`) {
                        target.src = '/logo.png';
                      }
                    }}
                    alt="Logo" 
                    className="max-h-[140px] w-auto object-contain" 
                    referrerPolicy="no-referrer" 
                  />
                </div>
                <div className="w-20 h-0.5 bg-[#D41468] mt-2 rounded-full"></div>
              </div>
            </div>

            <div className="px-10 space-y-6">
              {/* DOCUMENT TITLE */}
              <div className="flex justify-between items-end border-b-2 border-[#102F57]/10 pb-4">
                <div className="space-y-1.5">
                  <h2 className="text-3xl font-black tracking-tighter uppercase leading-none">
                    <span className="text-[#102F57]">{docTitle}</span>
                    <span className="text-[#D41468] ml-3">N° {cleanNumber}</span>
                  </h2>
                  <div className="flex items-center gap-2 text-[#64748B] font-bold text-[11px] uppercase tracking-wider pt-1">
                    <span className="material-symbols-outlined text-[15px] text-[#D41468]">calendar_month</span>
                    <span>Émis le : {dateFormatted}</span>
                  </div>
                </div>
                <p className="text-[10px] font-black text-[#64748B] uppercase tracking-[0.2em]">
                  Page : 1 / {totalPages}
                </p>
              </div>

              {/* TWO INFO CARDS */}
              <div className="grid grid-cols-2 gap-8">
                {/* LEFT CARD */}
                <div className="space-y-3">
                  <h3 className="text-[10px] font-black text-[#102F57] uppercase tracking-widest flex items-center gap-1.5 border-b border-[#DCE5F0] pb-1.5 w-fit">
                    <span className="material-symbols-outlined text-xs text-[#102F57]">
                      {isTransfert ? 'swap_horiz' : 'outbox'}
                    </span>
                    {isTransfert ? 'Informations transfert' : 'Informations sortie'}
                  </h3>
                  <div className="grid grid-cols-[90px_1fr] gap-y-1.5 text-[11px]">
                    <span className="text-[#64748B] font-bold uppercase">Demandeur</span>
                    <span className="text-[#172033] font-black">: {bs.demandeur}</span>
                    
                    <span className="text-[#64748B] font-bold uppercase">Service</span>
                    <span className="text-[#172033] font-black">: {bs.serviceDepartement || 'Service Technique'}</span>
                    
                    <span className="text-[#64748B] font-bold uppercase">Dépôt Source</span>
                    <span className="text-[#172033] font-black">: {bs.entrepotSource || projet?.nom || 'Stock Central UGS'}</span>
                  </div>
                </div>

                {/* RIGHT CARD */}
                <div className="bg-[#F5F8FC] border border-[#DCE5F0] p-4 rounded-lg relative overflow-hidden shadow-xs">
                  <div className="absolute top-0 right-0 w-1 h-full bg-[#D41468]"></div>
                  <div className="flex gap-3.5 items-start">
                    <div className="w-8 h-8 bg-[#102F57] rounded-md flex items-center justify-center shrink-0 text-white">
                      <span className="material-symbols-outlined text-base">
                        {isTransfert ? 'store' : 'account_circle'}
                      </span>
                    </div>
                    <div className="space-y-1 flex-1">
                      <p className="text-[9.5px] font-black text-[#D41468] uppercase tracking-widest leading-none">
                        {isTransfert ? 'DESTINATION DU TRANSFERT' : 'BÉNÉFICIAIRE / VALIDATION'}
                      </p>
                      <h3 className="font-black text-sm uppercase tracking-tight text-[#102F57] leading-tight pt-0.5">
                        {destNom}
                      </h3>
                      <p className="uppercase text-[10.5px] font-semibold text-[#64748B] leading-snug">
                        {destAdresse}
                      </p>
                      {destTel && (
                        <p className="uppercase text-[10.5px] font-bold text-[#172033] tracking-wide">
                          Tél: {destTel}
                        </p>
                      )}
                      {!isTransfert && bs.responsableValidation && (
                        <p className="text-[10px] font-bold text-[#102F57] pt-1">
                          Validé par : {bs.responsableValidation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* PRODUCTS TABLE */}
              <div className="border border-[#DCE5F0] rounded-sm overflow-hidden print:overflow-visible shadow-xs">
                <table className="w-full text-left border-collapse text-[10px]">
                  <thead className="print:table-header-group">
                    <tr className="bg-[#102F57] text-white">
                      <th className="py-2.5 px-3.5 font-black uppercase text-left w-24">Code</th>
                      <th className="py-2.5 px-3.5 font-black uppercase text-left">Désignation</th>
                      <th className="py-2.5 px-3.5 font-black uppercase text-center w-14">Qté</th>
                      {showPrices && (
                        <>
                          <th className="py-2.5 px-3.5 font-black uppercase text-right w-24">P.U.H.T</th>
                          <th className="py-2.5 px-3.5 font-black uppercase text-right w-28">Montant H.T</th>
                          <th className="py-2.5 px-3.5 font-black uppercase text-center w-16 border-r border-[#DCE5F0]/10">TVA %</th>
                        </>
                      )}
                      {!showPrices && (
                        <th className="py-2.5 px-3.5 font-black uppercase text-center w-36 border-r border-[#DCE5F0]/10">Statut</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DCE5F0]">
                    {lines.map((l, i) => (
                      <tr key={i} className={`transition-colors break-inside-avoid print:break-inside-avoid ${i % 2 === 0 ? 'bg-[#FFFFFF]' : 'bg-[#F5F8FC]'}`}>
                        <td className="px-3.5 py-2 text-[#64748B] font-medium text-left">{l.code}</td>
                        <td className="px-3.5 py-2 font-bold uppercase text-[#102F57] text-left">{l.designation}</td>
                        <td className="px-3.5 py-2 text-center font-black text-[#172033]">{l.quantite}</td>
                        {showPrices && (
                          <>
                            <td className="px-3.5 py-2 text-right font-semibold text-[#102F57]">{l.prixUnitaireHT.toFixed(3)}</td>
                            <td className="px-3.5 py-2 text-right font-black text-[#172033]">{l.totalHT.toFixed(3)}</td>
                            <td className="px-3.5 py-2 text-center font-bold text-[#64748B]">{l.tauxTVA.toFixed(2)}</td>
                          </>
                        )}
                        {!showPrices && (
                          <td className="px-3.5 py-2 text-center text-[#64748B] italic">Validé / Transféré</td>
                        )}
                      </tr>
                    ))}
                    {/* No dynamic blank rows - flow layout strictly depends on content */}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

            <div className="mt-auto block w-full bg-white break-inside-avoid print:break-inside-avoid" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div className="w-full px-10 space-y-6 pb-4 pt-6">
              {/* TOTALS SECTION */}
              {showPrices ? (
                <div className="grid grid-cols-[1.2fr_1fr] gap-8 pt-1 break-inside-avoid print:break-inside-avoid">
                  <div className="space-y-4">
                    <div className="bg-[#F5F8FC] border border-[#DCE5F0] rounded-lg overflow-hidden shadow-xs">
                      <table className="w-full text-[10px]">
                        <thead className="bg-[#DCE5F0]/40 text-[#102F57] font-black uppercase text-[9px] tracking-widest border-b border-[#DCE5F0]">
                          <tr>
                            <th className="py-1.5 px-3.5 text-left">T.V.A. %</th>
                            <th className="py-1.5 px-3.5 text-right">Assiette</th>
                            <th className="py-1.5 px-3.5 text-right">Montant</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DCE5F0]">
                          <tr>
                            <td className="py-2 px-3.5 font-black text-[#102F57]">19.00</td>
                            <td className="py-2 px-3.5 text-right font-semibold text-[#172033]">{montantHT.toFixed(3)}</td>
                            <td className="py-2 px-3.5 text-right font-black text-[#D41468]">{montantTVA.toFixed(3)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    
                    <div className="space-y-1">
                      <p className="text-[9.5px] text-[#64748B] font-black uppercase tracking-widest">
                        Arrêté le présent {docTitle.toLowerCase()} à la somme de :
                      </p>
                      <div className="bg-[#102F57] text-white px-4 py-2.5 rounded-md font-bold text-[10.5px] uppercase tracking-wide leading-relaxed shadow-xs">
                        {montantEnLettres}
                      </div>
                    </div>
                  </div>

                  {/* FINANCIAL RECAP */}
                  <div className="bg-[#F5F8FC] border border-[#DCE5F0] rounded-lg p-4 space-y-2 shadow-xs">
                    <div className="flex justify-between items-center text-[11px] uppercase tracking-wider font-bold">
                      <span className="text-[#64748B]">Total HT Brut</span>
                      <span className="text-[#102F57] font-black">{montantHT.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] uppercase tracking-wider font-bold">
                      <span className="text-[#64748B]">Total HT Net</span>
                      <span className="text-[#102F57] font-black">{montantHT.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] uppercase tracking-wider font-bold pb-2.5 border-b border-[#DCE5F0]">
                      <span className="text-[#64748B]">Total TVA</span>
                      <span className="text-[#102F57] font-black">{montantTVA.toFixed(3)}</span>
                    </div>
                    
                    <div className="pt-1.5 flex justify-between items-center">
                      <div className="space-y-0.5">
                        <span className="text-[12px] font-black uppercase tracking-widest text-[#102F57] block">
                          Net Total
                        </span>
                        <div className="h-1 w-12 bg-[#D41468] rounded-full"></div>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black tracking-tighter text-[#102F57]">
                          {montantTTC.toFixed(3)}
                        </span>
                        <span className="text-[#64748B] text-[10px] font-black ml-1 uppercase">TND</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#F5F8FC] border border-[#DCE5F0] rounded-lg p-4 flex items-center justify-between text-[11px]">
                  <span className="text-[#102F57] font-bold uppercase">{docTitle} — Mouvements et sorties de stock validés</span>
                  <span className="text-[#64748B] font-semibold">Total articles : {lines.reduce((acc, l) => acc + l.quantite, 0)} pièces</span>
                </div>
              )}

              {/* SIGNATURES */}
              <div className="grid grid-cols-3 gap-6 pt-2 pb-6">
                {/* 1. NOTES */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <h4 className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest text-[#102F57]">
                      <span className="material-symbols-outlined text-sm text-[#D41468]">notes</span>
                      NOTES & MOTIF
                    </h4>
                    <button
                      type="button"
                      onClick={() => setIsEditingNotes(!isEditingNotes)}
                      className="text-[9px] text-[#64748B] hover:text-[#102F57] font-bold print:hidden no-print"
                    >
                      {isEditingNotes ? 'Valider' : 'Modifier'}
                    </button>
                  </div>
                  {isEditingNotes ? (
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full h-24 border border-[#DCE5F0] bg-white rounded-md p-2 text-[9.5px] text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#102F57] resize-none"
                    />
                  ) : (
                    <div className="h-24 border border-[#DCE5F0] bg-white rounded-md p-2.5 text-[9.5px] text-[#64748B] italic leading-relaxed overflow-hidden">
                      {notes}
                    </div>
                  )}
                </div>
                
                {/* 2. SIGNATURE DEMANDEUR */}
                <div className="space-y-1.5 text-center">
                  <h4 className="flex justify-center items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest text-[#102F57]">
                    <span className="material-symbols-outlined text-sm text-[#D41468]">edit</span>
                    {isTransfert ? 'MAGASINIER EXPÉDITEUR' : 'VISA DEMANDEUR'}
                  </h4>
                  <div className="h-24 border border-[#DCE5F0] bg-white rounded-md"></div>
                </div>

                {/* 3. SIGNATURE & CACHET */}
                <div className="space-y-1.5 text-center">
                  <h4 className="flex justify-center items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest text-[#102F57]">
                    <span className="material-symbols-outlined text-sm text-[#D41468]">verified</span>
                    {isTransfert ? 'RÉCEPTEUR & CACHET' : 'RESPONSABLE DÉPÔT & CACHET'}
                  </h4>
                  <div className="h-24 border border-[#DCE5F0] bg-white rounded-md flex items-center justify-center relative overflow-hidden">
                    {showStamp && (
                      <div className="absolute inset-0 opacity-[0.05] flex items-center justify-center pointer-events-none transform -rotate-12">
                        <img src="/image.png" alt="Cachet" className="w-32 grayscale" />
                      </div>
                    )}
                  
</div>
</div>
</div>
</div>
</div>
                </div>
              </td>
            </tr>
          </tbody>
          <tfoot className="hidden print:table-footer-group">
            <tr>
              <td className="border-none p-0">
                <div className="h-[20mm]"></div>
              </td>
            </tr>
          </tfoot>
        </table>

        

          {/* FOOTER */}
          <div className="w-full bg-[#102F57] py-4 px-10 relative overflow-hidden shrink-0 mt-6 print:fixed print:bottom-0 print:left-0 print:m-0 print:w-[210mm] print:z-50">
            <div className="absolute top-0 right-0 h-full w-24 bg-[#D41468] -skew-x-12 translate-x-10"></div>
            
            <div className="flex justify-between items-center relative z-10 text-white/90">
              <div className="flex gap-8 text-[9.5px] font-bold uppercase tracking-widest">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#D41468]">call</span>
                  {cPhone}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#D41468]">print</span>
                  75 655 509
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#D41468]">location_on</span>
                  {cVille}
                </span>
              </div>
              
              <div className="flex flex-col items-end">
                <p className="text-[9.5px] font-black uppercase tracking-[0.25em] text-white">
                  Votre partenaire en solutions de sécurité
                </p>
                <p className="text-[8.5px] font-medium opacity-70 tracking-wider uppercase text-[#D41468] mt-0.5">
                  {cName}
                </p>
              
      


</div>
</div>
</div>
</div>
</div>,
    document.body
  );
}
