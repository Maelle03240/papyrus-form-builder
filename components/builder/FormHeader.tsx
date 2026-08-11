'use client';

import { Layout, Circle, Move } from 'lucide-react';
import { useRef, useEffect, useState } from 'react';
import type { FormTheme } from '@/types';
import { cn } from '@/lib/utils';

type HandleId = 'tl' | 'tm' | 'tr' | 'ml' | 'mr' | 'bl' | 'bm' | 'br';

interface Props {
  theme: FormTheme;
  selectedElement: 'banner' | 'logo' | null;
  onSelectBanner: () => void;
  onSelectLogo: () => void;
  onThemeChange?: (patch: Partial<FormTheme>) => void;
  preview?: boolean;
}

// Composant ResizeHandles — 8 poignées hors du overflow:hidden
interface ResizeHandlesProps {
  onResizeStart: (e: React.MouseEvent, handle: HandleId) => void;
}

function ResizeHandles({ onResizeStart }: ResizeHandlesProps) {
  const handleStyle = {
    position: 'absolute' as const,
    width: '12px',
    height: '12px',
    background: 'white',
    border: '2.5px solid var(--mooove-cyan)',
    borderRadius: '3px',
    zIndex: 30
  };

  return (
    <>
      {/* Top row */}
      <div
        onMouseDown={(e) => onResizeStart(e, 'tl')}
        className="cursor-nwse-resize"
        style={{ ...handleStyle, top: '-6px', left: '-6px' }}
      />
      <div
        onMouseDown={(e) => onResizeStart(e, 'tm')}
        className="cursor-ns-resize"
        style={{ ...handleStyle, top: '-6px', left: 'calc(50% - 6px)' }}
      />
      <div
        onMouseDown={(e) => onResizeStart(e, 'tr')}
        className="cursor-nesw-resize"
        style={{ ...handleStyle, top: '-6px', right: '-6px' }}
      />

      {/* Middle row */}
      <div
        onMouseDown={(e) => onResizeStart(e, 'ml')}
        className="cursor-ew-resize"
        style={{ ...handleStyle, top: 'calc(50% - 6px)', left: '-6px' }}
      />
      <div
        onMouseDown={(e) => onResizeStart(e, 'mr')}
        className="cursor-ew-resize"
        style={{ ...handleStyle, top: 'calc(50% - 6px)', right: '-6px' }}
      />

      {/* Bottom row */}
      <div
        onMouseDown={(e) => onResizeStart(e, 'bl')}
        className="cursor-nesw-resize"
        style={{ ...handleStyle, bottom: '-6px', left: '-6px' }}
      />
      <div
        onMouseDown={(e) => onResizeStart(e, 'bm')}
        className="cursor-ns-resize"
        style={{ ...handleStyle, bottom: '-6px', left: 'calc(50% - 6px)' }}
      />
      <div
        onMouseDown={(e) => onResizeStart(e, 'br')}
        className="cursor-nwse-resize"
        style={{ ...handleStyle, bottom: '-6px', right: '-6px' }}
      />
    </>
  );
}

export function FormHeader({ theme, selectedElement, onSelectBanner, onSelectLogo, onThemeChange, preview = false }: Props) {
  const hasBanner = !!theme.banner_url;
  const hasLogo = !!theme.logo_url;
  const logoShape = theme.logo_shape ?? 'circle';

  // Deux refs
  const outerRef = useRef<HTMLDivElement>(null);       // div externe — pour positionner les poignées
  const containerRef = useRef<HTMLDivElement>(null);   // div interne — pour les calculs de drag pan

  // Local states to handle drag fluidly without triggering parent DB save on every pixel
  const [localPosX, setLocalPosX] = useState(theme.banner_position_x ?? 50);
  const [localPosY, setLocalPosY] = useState(theme.banner_position_y ?? 50);
  const [localScale, setLocalScale] = useState(theme.banner_scale ?? 1);

  const dragPositionRef = useRef({ x: theme.banner_position_x ?? 50, y: theme.banner_position_y ?? 50 });
  const dragScaleRef = useRef(theme.banner_scale ?? 1);

  useEffect(() => {
    setLocalPosX(theme.banner_position_x ?? 50);
    dragPositionRef.current.x = theme.banner_position_x ?? 50;
  }, [theme.banner_position_x]);

  useEffect(() => {
    setLocalPosY(theme.banner_position_y ?? 50);
    dragPositionRef.current.y = theme.banner_position_y ?? 50;
  }, [theme.banner_position_y]);

  useEffect(() => {
    setLocalScale(theme.banner_scale ?? 1);
    dragScaleRef.current = theme.banner_scale ?? 1;
  }, [theme.banner_scale]);

  // State pour stocker les dimensions natives de l'image
  const [natSize, setNatSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });

  // State pour stocker la largeur dynamique du conteneur (pour la réactivité mobile / redimensionnement)
  const [containerW, setContainerW] = useState<number>(600);
  const containerH = 160;

  // ResizeObserver pour garder containerW parfaitement synchronisé en temps réel
  useEffect(() => {
    if (!containerRef.current) return;

    setContainerW(containerRef.current.offsetWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerW(entry.contentRect.width);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [hasBanner]);

  // Réinitialise le cadrage si l'URL de la bannière change (nouvelle image téléversée ou configurée)
  const lastUrlRef = useRef<string | null | undefined>(theme.banner_url);
  useEffect(() => {
    if (theme.banner_url !== lastUrlRef.current) {
      lastUrlRef.current = theme.banner_url;
      setNatSize({ w: 1, h: 1 });
      if (onThemeChange && theme.banner_url) {
        onThemeChange({
          banner_scale: undefined,
          banner_position_x: undefined,
          banner_position_y: undefined,
        });
      }
    }
  }, [theme.banner_url, onThemeChange]);

  const scale = localScale;
  const posXpct = localPosX;
  const posYpct = localPosY;

  const aspectRatio = natSize.w / natSize.h;
  const imgW = containerW * scale;
  const imgH = imgW / aspectRatio;  // hauteur proportionnelle au ratio natif
  const imgX = (containerW * posXpct / 100) - (imgW / 2);
  const imgY = (containerH * posYpct / 100) - (imgH / 2);

  // Fonction utilitaire clamp
  const _clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  // Initialisation du theme au mount si valeurs manquantes
  useEffect(() => {
    if (hasBanner && onThemeChange &&
        (theme.banner_scale === undefined ||
         theme.banner_position_x === undefined ||
         theme.banner_position_y === undefined)) {
      onThemeChange({
        banner_scale: 1,
        banner_position_x: 50,
        banner_position_y: 50,
      });
    }
  }, [hasBanner, theme.banner_scale, theme.banner_position_x, theme.banner_position_y, onThemeChange]);

  // Recalcule le cadrage optimal quand le mode d'affichage (fit) change
  const lastFitRef = useRef<string | undefined>(theme.banner_fit);
  useEffect(() => {
    if (!hasBanner || !onThemeChange || natSize.w === 1 || !containerRef.current) return;

    if (lastFitRef.current !== theme.banner_fit) {
      lastFitRef.current = theme.banner_fit;
      
      const cw = containerRef.current.offsetWidth;
      const ch = containerRef.current.offsetHeight;
      const nw = natSize.w;
      const nh = natSize.h;
      const fit = theme.banner_fit ?? 'cover';

      if (fit === 'cover') {
        const scaleX = cw / nw;
        const scaleY = ch / nh;
        const coverRatio = Math.max(scaleX, scaleY);
        const imgW = Math.round(nw * coverRatio);
        const imgH = Math.round(nh * coverRatio);
        const posY = Math.round((ch - imgH) / 2);
        const posX = Math.round((cw - imgW) / 2);
        const scale = Math.round((imgW / cw) * 100) / 100;
        onThemeChange({
          banner_scale: scale,
          banner_position_x: Math.round(((posX + imgW / 2) / cw) * 100),
          banner_position_y: Math.round(((posY + imgH / 2) / ch) * 100),
        });
      } else if (fit === 'contain') {
        // Pour "voir entière", l'image doit rentrer intégralement (largeur ET hauteur) sans rognage.
        // On calcule les échelles pour la largeur et la hauteur, et on prend le minimum.
        const scaleX = cw / nw;
        const scaleY = ch / nh;
        const containRatio = Math.min(scaleX, scaleY);
        const imgW = Math.round(nw * containRatio);
        const imgH = Math.round(nh * containRatio);
        
        // Centrage de l'image
        const posX = Math.round((cw - imgW) / 2);
        const posY = Math.round((ch - imgH) / 2);
        
        // Convertit la largeur d'affichage en scale (comme imgW = cw * scale)
        const scale = Math.round((imgW / cw) * 100) / 100;
        
        onThemeChange({
          banner_scale: Math.max(0.05, scale),
          banner_position_x: Math.round(((posX + imgW / 2) / cw) * 100),
          banner_position_y: Math.round(((posY + imgH / 2) / ch) * 100),
        });
      }
    }
  }, [theme.banner_fit, hasBanner, natSize, onThemeChange]);

  // Logique drag PAN (déplacer l'image)
  const handlePanStart = (e: React.MouseEvent) => {
    if (!onThemeChange || !containerRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const sx = e.clientX;
    const sy = e.clientY;
    const ox = imgX;
    const oy = imgY;
    
    dragPositionRef.current = { x: localPosX, y: localPosY };

    const onMove = (ev: MouseEvent) => {
      const newX = ox + (ev.clientX - sx);
      const newY = oy + (ev.clientY - sy);

      // Conversion px → % (source de vérité)
      // posX% = ((imgX + imgW/2) / containerW) * 100
      const newPosX = Math.round(((newX + imgW / 2) / containerW) * 100);
      const newPosY = Math.round(((newY + imgH / 2) / containerH) * 100);

      const finalPosX = Math.min(100, Math.max(0, newPosX));
      const finalPosY = Math.min(100, Math.max(0, newPosY));

      dragPositionRef.current = { x: finalPosX, y: finalPosY };
      setLocalPosX(finalPosX);
      setLocalPosY(finalPosY);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (onThemeChange) {
        onThemeChange({
          banner_position_x: dragPositionRef.current.x,
          banner_position_y: dragPositionRef.current.y,
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Logique RESIZE (poignées)
  const handleResizeStart = (e: React.MouseEvent, handle: HandleId) => {
    if (!onThemeChange || !containerRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const sx = e.clientX;
    const sy = e.clientY;
    const snap = { x: imgX, y: imgY, w: imgW, h: imgH };
    
    dragScaleRef.current = localScale;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      // Seules la largeur et la hauteur sont exploitées : le redimensionnement se
      // traduit en facteur d'échelle, pas en repositionnement. Les x/y calculés
      // ici n'étaient jamais lus.
      let { w, h } = snap;

      switch (handle) {
        case 'tl': w -= dx; h -= dy; break;
        case 'tm':          h -= dy; break;
        case 'tr': w += dx; h -= dy; break;
        case 'ml': w -= dx;          break;
        case 'mr': w += dx;          break;
        case 'bl': w -= dx; h += dy; break;
        case 'bm':          h += dy; break;
        case 'br': w += dx; h += dy; break;
      }

      // Taille minimum
      if (w < 100 || h < 80) return;

      // Conversion taille → scale avant onThemeChange
      const newScale = Math.round((w / containerW) * 100) / 100;  // arrondi 2 décimales
      const finalScale = Math.min(3, Math.max(0.05, newScale));
      
      dragScaleRef.current = finalScale;
      setLocalScale(finalScale);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (onThemeChange) {
        onThemeChange({
          banner_scale: dragScaleRef.current
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // En mode preview, si aucune image n'est définie, le header est invisible
  if (preview && !hasBanner && !hasLogo) {
    return null;
  }

  // Gestion de l'espacement : si logo seul en preview, on garde un espace pour le logo
  const needsLogoSpace = preview && hasLogo && !hasBanner;

  // État d'édition pour la bannière
  const isEditing = !preview && selectedElement === 'banner' && hasBanner;

  return (
    <div className={cn("relative", needsLogoSpace ? "mb-12 pt-24" : "mb-12")}>
      {/* Zone Bannière - ne se rend qu'en mode éditeur OU si elle a une URL */}
      {(!preview || hasBanner) && (
        <div
          ref={outerRef}
          onClick={!preview ? onSelectBanner : undefined}
          className={cn(
            'h-40 relative transition-colors',
            theme.banner_full_width
              ? 'w-screen ml-[calc(-50vw+50%)] mr-[calc(-50vw+50%)]'
              : 'w-full rounded-lg',
            !preview && 'cursor-pointer',
            selectedElement === 'banner' && 'ring-2 ring-accent',
            !hasBanner && 'border-2 border-dashed border-border-strong bg-bg-surface',
            !theme.banner_full_width && !hasBanner && 'rounded-lg'
          )}
        >
          {hasBanner ? (
            <>
              {/* Div interne — overflow:hidden, clip de l'image */}
              <div
                ref={containerRef}
                className={cn(!theme.banner_full_width && 'rounded-lg')}
                style={{
                  overflow: 'hidden',
                  position: 'relative',
                  height: '160px'
                }}
              >
                {preview ? (
                  // Mode preview/public : object-fit pour un rendu responsive cohérent
                  // indépendant de la largeur du container (fix décalage builder vs publié)
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={theme.banner_url!}
                    alt="Bannière"
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: `${posXpct}% ${posYpct}%`,
                      display: 'block',
                      userSelect: 'none',
                      pointerEvents: 'none',
                    }}
                  />
                ) : (
                  <>
                    {/* Mode éditeur : positionnement pixel pour contrôle précis */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={theme.banner_url!}
                      alt="Bannière"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        left: imgX + 'px',
                        top: imgY + 'px',
                        width: imgW + 'px',
                        height: imgH + 'px',
                        objectFit: 'fill',
                        userSelect: 'none',
                        pointerEvents: 'none',
                      }}
                      onLoad={(e) => {
                        const el = e.currentTarget;
                        const nw = el.naturalWidth;
                        const nh = el.naturalHeight;
                        setNatSize({ w: nw, h: nh });
                        const cw = containerRef.current?.offsetWidth ?? 600;
                        const ch = containerRef.current?.offsetHeight ?? 160;

                        const isFirstLoad = !theme.banner_scale || theme.banner_scale === 1;
                        if (!isFirstLoad || !onThemeChange) return;

                        const fit = theme.banner_fit ?? 'cover';

                        if (fit === 'cover') {
                          const scaleX = cw / nw;
                          const scaleY = ch / nh;
                          const coverRatio = Math.max(scaleX, scaleY);
                          const imgW = Math.round(nw * coverRatio);
                          const imgH = Math.round(nh * coverRatio);
                          const posY = Math.round((ch - imgH) / 2);
                          const posX = Math.round((cw - imgW) / 2);
                          const scale = Math.round((imgW / cw) * 100) / 100;
                          onThemeChange({
                            banner_scale: scale,
                            banner_position_x: Math.round(((posX + imgW / 2) / cw) * 100),
                            banner_position_y: Math.round(((posY + imgH / 2) / ch) * 100),
                          });
                        }

                        if (fit === 'contain') {
                          const scaleX = cw / nw;
                          const scaleY = ch / nh;
                          const containRatio = Math.min(scaleX, scaleY);
                          const imgW = Math.round(nw * containRatio);
                          const imgH = Math.round(nh * containRatio);
                          const posX = Math.round((cw - imgW) / 2);
                          const posY = Math.round((ch - imgH) / 2);
                          const scale = Math.round((imgW / cw) * 100) / 100;
                          onThemeChange({
                            banner_scale: Math.max(0.05, scale),
                            banner_position_x: Math.round(((posX + imgW / 2) / cw) * 100),
                            banner_position_y: Math.round(((posY + imgH / 2) / ch) * 100),
                          });
                        }
                      }}
                    />

                    {/* Zone de drag centrale */}
                    {isEditing && (
                      <div
                        onMouseDown={handlePanStart}
                        className="absolute inset-0 cursor-grab active:cursor-grabbing"
                        style={{ zIndex: 5 }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div
                            className="flex items-center justify-center"
                            style={{
                              width: '36px',
                              height: '36px',
                              backgroundColor: 'rgba(0,0,0,0.4)',
                              borderRadius: '50%'
                            }}
                          >
                            <Move className="h-5 w-5 text-white" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Overlay de sélection en mode éditeur (non sélectionnée) */}
                    {selectedElement !== 'banner' && (
                      <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                        <div className="opacity-0 hover:opacity-100 bg-white/90 px-3 py-1 rounded-md text-sm text-text-primary">
                          Cliquer pour modifier la bannière
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Poignées ICI — en dehors du overflow:hidden */}
              {isEditing && (
                <ResizeHandles onResizeStart={handleResizeStart} />
              )}
            </>
          ) : (
            !preview && (
              <div className="flex items-center justify-center h-full text-text-tertiary">
                <div className="flex flex-col items-center gap-2">
                  <Layout className="h-8 w-8" />
                  <span className="text-sm font-medium">Ajouter une bannière</span>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Zone Logo - ne se rend qu'en mode éditeur OU si elle a une URL */}
      {(!preview || hasLogo) && (
        <div
          onClick={!preview ? onSelectLogo : undefined}
          className={cn(
            'absolute transition-colors',
            // Positionnement adaptatif selon la présence de bannière
            preview && !hasBanner
              ? 'top-4 left-8' // Logo en haut avec espace en preview sans bannière
              : 'bottom-[-25%] left-8', // Position à cheval normale : 50% sur bannière, 50% sur fond blanc
            'w-20 h-20', // Taille fixe du conteneur (80px x 80px)
            'overflow-hidden', // Confine l'image zoomée dans le cercle
            'border-4 border-white shadow-lg', // Bordure blanche style LinkedIn
            !preview && 'cursor-pointer',
            selectedElement === 'logo' && 'ring-2 ring-accent ring-offset-2'
          )}
          style={{
            borderRadius: logoShape === 'circle' ? '50%' : logoShape === 'rounded' ? '12px' : '8px'
          }}
        >
          {hasLogo ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={theme.logo_url!}
                alt="Logo"
                className={cn(
                  'w-full h-full object-cover transition-transform',
                  logoShape === 'circle' ? 'rounded-full' : logoShape === 'rounded' ? 'rounded-xl' : 'rounded'
                )}
                style={{
                  transform: `scale(${theme.logo_size ?? 1})`, // Zoom appliqué uniquement sur l'image
                  transformOrigin: 'center center' // Centre le zoom sur l'image
                }}
              />
              {/* Overlay de sélection en mode éditeur */}
              {!preview && (
                <div className={cn(
                  'absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center',
                  logoShape === 'circle' ? 'rounded-full' : logoShape === 'rounded' ? 'rounded-xl' : 'rounded'
                )}>
                  <div className="opacity-0 hover:opacity-100 bg-white/90 px-2 py-1 rounded text-xs text-text-primary whitespace-nowrap">
                    Modifier logo
                  </div>
                </div>
              )}
            </div>
          ) : (
            !preview && (
              <div
                className={cn(
                  "w-full h-full border-2 border-dashed border-border-strong bg-bg-surface flex items-center justify-center text-text-tertiary",
                  logoShape === 'circle' ? 'rounded-full' : logoShape === 'rounded' ? 'rounded-xl' : 'rounded'
                )}
              >
                <div className="flex flex-col items-center gap-1">
                  <Circle className="h-6 w-6" />
                  <span className="text-[10px] font-medium">Logo</span>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}