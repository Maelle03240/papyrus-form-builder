'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkMediaFile, uploadMedia, type UploadOptions } from '@/lib/storage/upload-client';
import { toast } from '@/components/ui/Toast';

/**
 * Hook partagé par tous les points d'envoi de média du builder.
 *
 * Centralise : pré-validation, barre de progression, annulation au démontage et
 * remontée d'erreur. Le résultat est l'URL publique R2 à stocker dans le formulaire.
 */
export interface MediaUploadState {
  /** Téléverse le fichier et renvoie son URL publique, ou `null` si l'envoi a échoué. */
  upload: (file: File) => Promise<string | null>;
  uploading: boolean;
  /** Progression 0-100. */
  progress: number;
  error: string | null;
}

export function useMediaUpload(options: UploadOptions = {}): MediaUploadState {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const { context, formSlug } = options;

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const invalid = checkMediaFile(file);
      if (invalid) {
        setError(invalid);
        toast.error(invalid);
        return null;
      }

      // Un nouvel envoi annule celui en cours.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        const url = await uploadMedia(file, {
          context,
          formSlug,
          signal: controller.signal,
          onProgress: (percent) => {
            if (mountedRef.current) setProgress(percent);
          }
        });
        return url;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null;
        const message = err instanceof Error ? err.message : "Échec de l'envoi du fichier.";
        if (mountedRef.current) setError(message);
        toast.error(message);
        return null;
      } finally {
        if (mountedRef.current) setUploading(false);
      }
    },
    [context, formSlug]
  );

  return { upload, uploading, progress, error };
}
