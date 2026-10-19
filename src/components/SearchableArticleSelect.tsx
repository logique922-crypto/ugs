import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Article } from '../types';
import { getArticleStock } from '../utils/stockUtils';

interface SearchableArticleSelectProps {
  articles: Article[];
  value: string;
  onChange: (articleId: string) => void;
  placeholder?: string;
  className?: string;
  projetId?: string;
}

export function SearchableArticleSelect({
  articles,
  value,
  onChange,
  placeholder = "Sélectionner un article...",
  className = "",
  projetId
}: SearchableArticleSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selectedArticle = useMemo(() => articles.find(a => a.id === value), [articles, value]);

  const filteredArticles = useMemo(() => {
    if (!search) return articles;
    const lowerSearch = search.toLowerCase();
    return articles.filter(a => 
      a.code.toLowerCase().includes(lowerSearch) || 
      a.designation.toLowerCase().includes(lowerSearch)
    );
  }, [articles, search]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Update position
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const updatePosition = () => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        
        // Check if there is space below, otherwise open above
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropdownHeight = 320; // estimated max height
        
        const style: React.CSSProperties = {
          position: 'fixed',
          left: rect.left,
          width: Math.max(rect.width, 360), // At least 360px wide for good UX
          zIndex: 9999,
        };

        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          // Open upwards
          style.bottom = window.innerHeight - rect.top + 6;
        } else {
          // Open downwards
          style.top = rect.bottom + 6;
        }

        setDropdownStyle(style);
      };
      
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Small timeout to ensure the portal is rendered
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const dropdownContent = isOpen ? (
    <div 
      ref={dropdownRef}
      style={dropdownStyle}
      className="bg-white border border-[#DCE5F0] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="p-2 border-b border-[#DCE5F0] bg-slate-50/80">
        <div className="relative flex items-center">
          <span className="material-symbols-outlined absolute left-3 text-slate-400 text-[18px]">
            search
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par code ou désignation..."
            className="w-full pl-9 pr-8 py-2.5 bg-white border border-[#DCE5F0] rounded-lg text-xs font-bold text-[#172033] focus:outline-none focus:border-[#102F57] focus:ring-1 focus:ring-[#102F57] transition-all shadow-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 transition-colors flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-[16px] block">close</span>
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-1.5 custom-scrollbar bg-white">
        {filteredArticles.length === 0 ? (
          <div className="py-8 px-4 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 bg-[#F5F8FC] rounded-full flex items-center justify-center mb-2 border border-[#DCE5F0]">
              <span className="material-symbols-outlined text-[#64748B] text-lg">search_off</span>
            </div>
            <p className="text-xs font-black text-[#102F57]">Aucun article trouvé</p>
            <p className="text-[10px] text-[#64748B] font-semibold mt-0.5">Essayez d'autres mots clés</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredArticles.map(a => {
              const isService = a.typeArticle === 'Service';
              const stock = isService ? 999 : getArticleStock(a, projetId);
              const isOutOfStock = !isService && stock <= 0;
              const isLowStock = !isService && stock > 0 && stock <= 5;
              const isSelected = a.id === value;
              
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onChange(a.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all group ${
                    isSelected 
                      ? 'bg-[#102F57] text-white shadow-md shadow-[#102F57]/10' 
                      : isOutOfStock
                        ? 'text-slate-600 bg-rose-50/30 hover:bg-rose-50 border border-rose-100'
                        : isLowStock
                          ? 'text-slate-700 bg-amber-50/30 hover:bg-amber-50 border border-amber-100'
                          : 'text-slate-700 hover:bg-[#F5F8FC] hover:border-[#DCE5F0] border border-transparent'
                  }`}
                >
                  <div className="flex flex-col flex-1 min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={`font-black text-[11px] ${isSelected ? 'text-white' : 'text-[#D41468]'}`}>
                        {a.code}
                      </span>
                      <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-[#172033] group-hover:text-[#102F57]'}`}>
                        {a.designation}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {a.famille && (
                        <span className={`text-[9px] uppercase tracking-wider font-bold ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                          {a.famille}
                        </span>
                      )}
                      <span className={`text-[9px] font-bold ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                        • Prix: {(a.prixVenteHT || 0).toFixed(3)} DT
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {isService ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-800 border border-purple-200'
                      }`}>
                        Service
                      </span>
                    ) : (
                      <span className={`text-[10.5px] font-black px-2 py-0.5 rounded border flex items-center gap-1 ${
                        isSelected 
                          ? 'bg-white/20 text-white border-white/30'
                          : isOutOfStock
                            ? 'bg-rose-100 text-rose-700 border-rose-300'
                            : isLowStock
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}>
                        <span className="material-symbols-outlined text-[13px]">
                          {isOutOfStock ? 'cancel' : isLowStock ? 'warning' : 'inventory_2'}
                        </span>
                        <span>
                          {isOutOfStock ? '0 en stock' : `${stock} restant${stock > 1 ? 's' : ''}`}
                        </span>
                      </span>
                    )}
                    {isSelected && (
                      <span className="material-symbols-outlined text-white text-[16px]">
                        check_circle
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setSearch("");
        }}
        className={`w-full flex items-center justify-between px-3 py-2.5 bg-white border ${
          isOpen ? 'border-[#102F57] ring-1 ring-[#102F57]/20 shadow-xs' : 'border-[#DCE5F0] hover:border-slate-300 shadow-xs'
        } rounded-lg text-xs transition-all focus:outline-none cursor-pointer`}
      >
        <div className="flex flex-col items-start truncate pr-2 min-w-0 w-full text-left">
          {selectedArticle ? (
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-1.5 truncate">
                <span className="font-black text-[11px] text-[#D41468] shrink-0">
                  {selectedArticle.code}
                </span>
                <span className="font-bold text-[#172033] truncate">
                  {selectedArticle.designation}
                </span>
              </div>
              {selectedArticle.typeArticle === 'Service' ? (
                <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 shrink-0">
                  Service
                </span>
              ) : (() => {
                const stock = getArticleStock(selectedArticle, projetId);
                return (
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded border shrink-0 flex items-center gap-1 ${
                    stock <= 0 
                      ? 'bg-rose-100 text-rose-700 border-rose-300' 
                      : stock <= 5 
                        ? 'bg-amber-100 text-amber-900 border-amber-300' 
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}>
                    <span className="material-symbols-outlined text-[12px]">
                      {stock <= 0 ? 'cancel' : stock <= 5 ? 'warning' : 'inventory_2'}
                    </span>
                    <span>{stock <= 0 ? 'Rupture (0)' : `Stock : ${stock}`}</span>
                  </span>
                );
              })()}
            </div>
          ) : (
            <span className="text-slate-400 font-bold">{placeholder}</span>
          )}
        </div>
        <span className={`material-symbols-outlined text-slate-400 text-[18px] transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180 text-[#102F57]' : ''}`}>
          expand_more
        </span>
      </button>

      {isOpen && createPortal(dropdownContent, document.body)}
    </div>
  );
}
