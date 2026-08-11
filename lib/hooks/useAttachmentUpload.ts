'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAttachment, uploadAttachment } from '@/lib/storage/attachments-client';
import type { UploadOptions } from '@/lib/storage/upload-client';
import { toast } from '@/components/ui/Toast';

/**
 * Variante de `useMediaUpload` qui accepte aussi les documents.
 *
 * Le routage R2 / Supabase Storage est décidé par `uploadAttachment` : ce hook
 * ne s'occupe que de l'état d'interface (progression, erreur, annulation).
 */
export interface AttachmentUploadState {
  upload: (file: File) => Promise<string | null>;
  uploading: boolean;
  progress: number;
  error: string | null;
}

export function useAttachmentUpload(options: UploadOptions = {}): AttachmentUploadState {
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
      const invalid = checkAttachment(file);
      if (invalid) {
        setError(invalid);
        toast.error(invalid);
        return null;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        const result = await uploadAttachment(file, {
          context,
          formSlug,
          signal: controller.signal,
          onProgress: (percent) => {
            if (mountedRef.current) setProgress(percent);
          }
        });
        return result.url;
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
