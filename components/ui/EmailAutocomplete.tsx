'use client';

import { useState, useEffect, useRef } from 'react';
import { Mail, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmailSuggestion {
  email: string;
  name?: string;
  isExisting: boolean;
}

interface EmailAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  suggestions?: EmailSuggestion[];
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function EmailAutocomplete({
  value,
  onChange,
  suggestions = [],
  placeholder = "nom@exemple.com",
  label = "Adresse email",
  className,
  disabled = false
}: EmailAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<EmailSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filtrer les suggestions basées sur la valeur saisie
  useEffect(() => {
    if (!value.trim() || !isOpen) {
      setFilteredSuggestions([]);
      return;
    }

    const filtered = suggestions.filter(suggestion =>
      suggestion.email.toLowerCase().includes(value.toLowerCase()) ||
      suggestion.name?.toLowerCase().includes(value.toLowerCase())
    );

    setFilteredSuggestions(filtered);
    setSelectedIndex(-1);
  }, [value, suggestions, isOpen]);

  // Gérer la fermeture en cliquant dehors
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setIsOpen(true);
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filteredSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredSuggestions.length) {
          selectSuggestion(filteredSuggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const selectSuggestion = (suggestion: EmailSuggestion) => {
    onChange(suggestion.email);
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label && (
        <label className="block text-sm font-medium text-text-primary mb-2">
          {label}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="email"
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full px-3 py-2 pl-10 border border-border-strong rounded-lg",
            "focus:ring-2 focus:ring-blue-500 focus:border-transparent",
            "disabled:bg-bg-elevated disabled:text-text-secondary disabled:cursor-not-allowed",
            "text-sm placeholder:text-text-tertiary"
          )}
        />

        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary" />
      </div>

      {/* Dropdown des suggestions */}
      {isOpen && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.email}
              type="button"
              onClick={() => selectSuggestion(suggestion)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left text-sm",
                "hover:bg-bg-elevated focus:bg-bg-elevated focus:outline-none",
                "border-b border-border last:border-b-0",
                selectedIndex === index && "bg-blue-50"
              )}
            >
              <div className="w-8 h-8 bg-var(--mooove-navy) rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                {suggestion.name ?
                  suggestion.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) :
                  suggestion.email[0].toUpperCase()
                }
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary truncate">
                  {suggestion.name || 'Membre de l\'équipe'}
                </div>
                <div className="text-text-secondary truncate">
                  {suggestion.email}
                </div>
              </div>

              {suggestion.isExisting && (
                <div className="flex items-center gap-1 text-green-600">
                  <Check className="w-3 h-3" />
                  <span className="text-xs font-medium">Membre</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Message si nouvelle adresse */}
      {value.includes('@') && !suggestions.find(s => s.email === value) && (
        <p className="mt-1 text-xs text-blue-600">
          ✨ Nouvelle invitation - cette personne rejoindra votre équipe
        </p>
      )}
    </div>
  );
}