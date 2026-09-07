'use client';

import { useState, useEffect, useRef } from 'react';
import { formatPhoneNumber, validatePhoneNumber, getPhonePlaceholder } from '@/lib/constants/phone-formats';

const COUNTRIES = [
  { code: 'MU', name: 'Maurice',           dial: '+230', flag: '🇲🇺' },
  { code: 'FR', name: 'France',            dial: '+33',  flag: '🇫🇷' },
  { code: 'BE', name: 'Belgique',          dial: '+32',  flag: '🇧🇪' },
  { code: 'CH', name: 'Suisse',            dial: '+41',  flag: '🇨🇭' },
  { code: 'CA', name: 'Canada',            dial: '+1',   flag: '🇨🇦' },
  { code: 'US', name: 'États-Unis',        dial: '+1',   flag: '🇺🇸' },
  { code: 'GB', name: 'Royaume-Uni',       dial: '+44',  flag: '🇬🇧' },
  { code: 'DE', name: 'Allemagne',         dial: '+49',  flag: '🇩🇪' },
  { code: 'ES', name: 'Espagne',           dial: '+34',  flag: '🇪🇸' },
  { code: 'IT', name: 'Italie',            dial: '+39',  flag: '🇮🇹' },
  { code: 'PT', name: 'Portugal',          dial: '+351', flag: '🇵🇹' },
  { code: 'NL', name: 'Pays-Bas',          dial: '+31',  flag: '🇳🇱' },
  { code: 'AT', name: 'Autriche',          dial: '+43',  flag: '🇦🇹' },
  { code: 'LU', name: 'Luxembourg',        dial: '+352', flag: '🇱🇺' },
  { code: 'IE', name: 'Irlande',           dial: '+353', flag: '🇮🇪' },
  { code: 'DK', name: 'Danemark',          dial: '+45',  flag: '🇩🇰' },
  { code: 'SE', name: 'Suède',             dial: '+46',  flag: '🇸🇪' },
  { code: 'NO', name: 'Norvège',           dial: '+47',  flag: '🇳🇴' },
  { code: 'FI', name: 'Finlande',          dial: '+358', flag: '🇫🇮' },
  { code: 'IS', name: 'Islande',           dial: '+354', flag: '🇮🇸' },
  { code: 'PL', name: 'Pologne',           dial: '+48',  flag: '🇵🇱' },
  { code: 'CZ', name: 'Tchéquie',          dial: '+420', flag: '🇨🇿' },
  { code: 'HU', name: 'Hongrie',           dial: '+36',  flag: '🇭🇺' },
  { code: 'SK', name: 'Slovaquie',         dial: '+421', flag: '🇸🇰' },
  { code: 'SI', name: 'Slovénie',          dial: '+386', flag: '🇸🇮' },
  { code: 'HR', name: 'Croatie',           dial: '+385', flag: '🇭🇷' },
  { code: 'RO', name: 'Roumanie',          dial: '+40',  flag: '🇷🇴' },
  { code: 'BG', name: 'Bulgarie',          dial: '+359', flag: '🇧🇬' },
  { code: 'GR', name: 'Grèce',             dial: '+30',  flag: '🇬🇷' },
  { code: 'TR', name: 'Turquie',           dial: '+90',  flag: '🇹🇷' },
  { code: 'RU', name: 'Russie',            dial: '+7',   flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine',           dial: '+380', flag: '🇺🇦' },
  { code: 'MA', name: 'Maroc',             dial: '+212', flag: '🇲🇦' },
  { code: 'DZ', name: 'Algérie',           dial: '+213', flag: '🇩🇿' },
  { code: 'TN', name: 'Tunisie',           dial: '+216', flag: '🇹🇳' },
  { code: 'EG', name: 'Égypte',            dial: '+20',  flag: '🇪🇬' },
  { code: 'SN', name: 'Sénégal',           dial: '+221', flag: '🇸🇳' },
  { code: 'CI', name: "Côte d'Ivoire",     dial: '+225', flag: '🇨🇮' },
  { code: 'GH', name: 'Ghana',             dial: '+233', flag: '🇬🇭' },
  { code: 'NG', name: 'Nigeria',           dial: '+234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya',             dial: '+254', flag: '🇰🇪' },
  { code: 'ET', name: 'Éthiopie',          dial: '+251', flag: '🇪🇹' },
  { code: 'TZ', name: 'Tanzanie',          dial: '+255', flag: '🇹🇿' },
  { code: 'UG', name: 'Ouganda',           dial: '+256', flag: '🇺🇬' },
  { code: 'RW', name: 'Rwanda',            dial: '+250', flag: '🇷🇼' },
  { code: 'ZM', name: 'Zambie',            dial: '+260', flag: '🇿🇲' },
  { code: 'ZW', name: 'Zimbabwe',          dial: '+263', flag: '🇿🇼' },
  { code: 'BW', name: 'Botswana',          dial: '+267', flag: '🇧🇼' },
  { code: 'ZA', name: 'Afrique du Sud',    dial: '+27',  flag: '🇿🇦' },
  { code: 'MG', name: 'Madagascar',        dial: '+261', flag: '🇲🇬' },
  { code: 'MZ', name: 'Mozambique',        dial: '+258', flag: '🇲🇿' },
  { code: 'AO', name: 'Angola',            dial: '+244', flag: '🇦🇴' },
  { code: 'CM', name: 'Cameroun',          dial: '+237', flag: '🇨🇲' },
  { code: 'GA', name: 'Gabon',             dial: '+241', flag: '🇬🇦' },
  { code: 'CG', name: 'Congo',             dial: '+242', flag: '🇨🇬' },
  { code: 'CD', name: 'Congo (RDC)',       dial: '+243', flag: '🇨🇩' },
  { code: 'ML', name: 'Mali',              dial: '+223', flag: '🇲🇱' },
  { code: 'BF', name: 'Burkina Faso',      dial: '+226', flag: '🇧🇫' },
  { code: 'NE', name: 'Niger',             dial: '+227', flag: '🇳🇪' },
  { code: 'TD', name: 'Tchad',             dial: '+235', flag: '🇹🇩' },
  { code: 'RE', name: 'La Réunion',        dial: '+262', flag: '🇷🇪' },
  { code: 'IN', name: 'Inde',              dial: '+91',  flag: '🇮🇳' },
  { code: 'CN', name: 'Chine',             dial: '+86',  flag: '🇨🇳' },
  { code: 'JP', name: 'Japon',             dial: '+81',  flag: '🇯🇵' },
  { code: 'KR', name: 'Corée du Sud',      dial: '+82',  flag: '🇰🇷' },
  { code: 'TH', name: 'Thaïlande',         dial: '+66',  flag: '🇹🇭' },
  { code: 'VN', name: 'Viêt Nam',          dial: '+84',  flag: '🇻🇳' },
  { code: 'MY', name: 'Malaisie',          dial: '+60',  flag: '🇲🇾' },
  { code: 'SG', name: 'Singapour',         dial: '+65',  flag: '🇸🇬' },
  { code: 'PH', name: 'Philippines',       dial: '+63',  flag: '🇵🇭' },
  { code: 'ID', name: 'Indonésie',         dial: '+62',  flag: '🇮🇩' },
  { code: 'PK', name: 'Pakistan',          dial: '+92',  flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh',        dial: '+880', flag: '🇧🇩' },
  { code: 'LK', name: 'Sri Lanka',         dial: '+94',  flag: '🇱🇰' },
  { code: 'NP', name: 'Népal',             dial: '+977', flag: '🇳🇵' },
  { code: 'AF', name: 'Afghanistan',       dial: '+93',  flag: '🇦🇫' },
  { code: 'IR', name: 'Iran',              dial: '+98',  flag: '🇮🇷' },
  { code: 'IQ', name: 'Irak',              dial: '+964', flag: '🇮🇶' },
  { code: 'SA', name: 'Arabie saoudite',   dial: '+966', flag: '🇸🇦' },
  { code: 'AE', name: 'Émirats arabes unis', dial: '+971', flag: '🇦🇪' },
  { code: 'QA', name: 'Qatar',             dial: '+974', flag: '🇶🇦' },
  { code: 'KW', name: 'Koweït',            dial: '+965', flag: '🇰🇼' },
  { code: 'BH', name: 'Bahreïn',           dial: '+973', flag: '🇧🇭' },
  { code: 'OM', name: 'Oman',              dial: '+968', flag: '🇴🇲' },
  { code: 'JO', name: 'Jordanie',          dial: '+962', flag: '🇯🇴' },
  { code: 'LB', name: 'Liban',             dial: '+961', flag: '🇱🇧' },
  { code: 'SY', name: 'Syrie',             dial: '+963', flag: '🇸🇾' },
  { code: 'IL', name: 'Israël',            dial: '+972', flag: '🇮🇱' },
  { code: 'AU', name: 'Australie',         dial: '+61',  flag: '🇦🇺' },
  { code: 'NZ', name: 'Nouvelle-Zélande',  dial: '+64',  flag: '🇳🇿' },
  { code: 'FJ', name: 'Fidji',             dial: '+679', flag: '🇫🇯' },
  { code: 'BR', name: 'Brésil',            dial: '+55',  flag: '🇧🇷' },
  { code: 'AR', name: 'Argentine',         dial: '+54',  flag: '🇦🇷' },
  { code: 'CL', name: 'Chili',             dial: '+56',  flag: '🇨🇱' },
  { code: 'PE', name: 'Pérou',             dial: '+51',  flag: '🇵🇪' },
  { code: 'CO', name: 'Colombie',          dial: '+57',  flag: '🇨🇴' },
  { code: 'VE', name: 'Venezuela',         dial: '+58',  flag: '🇻🇪' },
  { code: 'EC', name: 'Équateur',          dial: '+593', flag: '🇪🇨' },
  { code: 'BO', name: 'Bolivie',           dial: '+591', flag: '🇧🇴' },
  { code: 'PY', name: 'Paraguay',          dial: '+595', flag: '🇵🇾' },
  { code: 'UY', name: 'Uruguay',           dial: '+598', flag: '🇺🇾' },
  { code: 'MX', name: 'Mexique',           dial: '+52',  flag: '🇲🇽' },
  { code: 'GT', name: 'Guatemala',         dial: '+502', flag: '🇬🇹' },
  { code: 'CR', name: 'Costa Rica',        dial: '+506', flag: '🇨🇷' },
  { code: 'PA', name: 'Panama',            dial: '+507', flag: '🇵🇦' },
  { code: 'CU', name: 'Cuba',              dial: '+53',  flag: '🇨🇺' },
  { code: 'DO', name: 'République dominicaine', dial: '+1809', flag: '🇩🇴' },
  { code: 'JM', name: 'Jamaïque',          dial: '+1876', flag: '🇯🇲' },
  { code: 'TT', name: 'Trinité-et-Tobago', dial: '+1868', flag: '🇹🇹' },
];

interface PhoneFieldProps {
  name?: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (val: string) => void;
}

export function PhoneField({ name, required, placeholder, value, onChange }: PhoneFieldProps) {
  const [selected, setSelected] = useState(COUNTRIES[0]); // Maurice par défaut
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localPhone, setLocalPhone] = useState('');
  const phone = value !== undefined ? value : localPhone;
  const [rawPhone, setRawPhone] = useState(''); // Numéro brut pour la validation
  const [touched, setTouched] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Validation du numéro selon le pays
  const isValidPhone = !touched || !rawPhone || validatePhoneNumber(rawPhone, selected.code);
  const errorMessage = touched && rawPhone && !isValidPhone
    ? `Format invalide pour ${selected.name}. Exemple: ${getPhonePlaceholder(selected.code)}`
    : null;

  // Formatage en temps réel
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const digitsOnly = val.replace(/\D/g, '');
    setRawPhone(digitsOnly);
    const formatted = formatPhoneNumber(digitsOnly, selected.code);
    if (onChange) {
      onChange(formatted);
    } else {
      setLocalPhone(formatted);
    }
  };

  // Reset du numéro quand le pays change
  useEffect(() => {
    if (rawPhone) {
      const formatted = formatPhoneNumber(rawPhone, selected.code);
      if (onChange) {
        onChange(formatted);
      } else {
        setLocalPhone(formatted);
      }
    }
  }, [selected.code, rawPhone]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current &&
          !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div style={{ position: 'relative' }}>

      {/* CHAMP PRINCIPAL */}
      <div style={{
        display: 'flex',
        border: `1px solid ${errorMessage ? 'var(--error-border, #dc2626)' : 'var(--papyrus-border)'}`,
        borderRadius: '8px',
        overflow: 'visible',
        background: 'var(--papyrus-surface)'
      }}>

        {/* BADGE PAYS — cliquable */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 12px',
            borderRight: '1px solid var(--papyrus-border)',
            background: 'transparent',
            cursor: 'pointer',
            minWidth: '90px',
            fontSize: '14px'
          }}
        >
          <img
            src={`https://flagcdn.com/w20/${selected.code.toLowerCase()}.png`}
            width={20}
            height={15}
            alt={selected.name}
            style={{ borderRadius: '2px', flexShrink: 0 }}
          />
          <span style={{ color: 'var(--fg-secondary)' }}>{selected.dial}</span>
          <span style={{ fontSize: '10px', color: 'var(--fg-tertiary)' }}>▼</span>
        </button>

        {/* INPUT NUMÉRO */}
        <input
          name={name}
          type="tel"
          value={phone}
          onChange={handlePhoneChange}
          onBlur={() => setTouched(true)}
          placeholder={placeholder || getPhonePlaceholder(selected.code)}
          required={required}
          style={{
            flex: 1,
            padding: '10px 12px',
            border: 'none',
            background: 'transparent',
            fontSize: '16px',
            outline: 'none',
            color: 'var(--fg-primary)',
            ...(errorMessage && { borderColor: 'red' })
          }}
        />
      </div>

      {/* MESSAGE D'ERREUR */}
      {errorMessage && (
        <p style={{
          color: 'var(--error-text, #dc2626)',
          fontSize: '12px',
          marginTop: '4px',
          marginLeft: '2px'
        }}>
          {errorMessage}
        </p>
      )}

      {/* DROPDOWN PAYS */}
      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '280px',
            background: 'var(--papyrus-surface)',
            border: '1px solid var(--papyrus-border)',
            borderRadius: '10px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 9999,
            overflow: 'hidden'
          }}
        >
          {/* INPUT RECHERCHE */}
          <div style={{ padding: '8px' }}>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pays, code ou indicatif..."
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--papyrus-border)',
                borderRadius: '6px',
                fontSize: '16px',
                outline: 'none',
                background: 'var(--bg-base)',
                color: 'var(--fg-primary)'
              }}
            />
          </div>

          {/* LISTE PAYS */}
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {COUNTRIES
              .filter(c =>
                c.name.toLowerCase().includes(search.toLowerCase()) ||
                c.dial.includes(search) ||
                c.code.toLowerCase().includes(search.toLowerCase())
              )
              .map(country => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => {
                    setSelected(country);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    background: selected.code === country.code
                      ? 'var(--bg-overlay)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: 'var(--fg-primary)',
                    textAlign: 'left'
                  }}
                >
                  <img
                    src={`https://flagcdn.com/w20/${country.code.toLowerCase()}.png`}
                    width={20}
                    height={15}
                    alt={country.name}
                    style={{ borderRadius: '2px', flexShrink: 0 }}
                  />
                  <span style={{ flex: 1 }}>{country.name}</span>
                  <span style={{ color: 'var(--fg-secondary)' }}>{country.dial}</span>
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}