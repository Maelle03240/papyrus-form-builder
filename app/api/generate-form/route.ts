import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { getOpenRouterApiKey } from '@/lib/env';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Taille maximale d'un document soumis à l'extraction de texte. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    // 1. Authentification — cette route consomme un quota d'API tierce payante,
    //    elle ne doit jamais être atteignable sans session.
    const supabase = createClient();
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    // Un appel IA coûte : on borne la cadence par utilisateur.
    const limit = rateLimit(`generate-form:${user.id}`, 10, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Trop de générations lancées. Patientez une minute.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    // 2. Récupérer le FormData
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const textDraft = formData.get('draft') as string | null;

    let draftText = '';

    // 3. Extraction du texte selon le type de fichier
    if (file) {
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `Fichier trop volumineux (max ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo).` },
          { status: 413 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = file.name.toLowerCase();

      if (filename.endsWith('.pdf') || file.type === 'application/pdf') {
        try {
          // pdf-parse charge son worker depuis node_modules : en build standalone
          // il faut lui donner un chemin absolu résolu à l'exécution.
          const workerPath = path.join(
            process.cwd(),
            'node_modules',
            'pdfjs-dist',
            'legacy',
            'build',
            'pdf.worker.mjs'
          );
          PDFParse.setWorker(pathToFileURL(workerPath).toString());
        } catch (workerError) {
          console.warn('Failed to set local PDF worker:', workerError);
        }

        const parser = new PDFParse({ data: buffer });
        const parsedPdf = await parser.getText();
        draftText = parsedPdf.text || '';
      } else if (filename.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer });
        draftText = result.value || '';
      } else if (filename.endsWith('.txt') || filename.endsWith('.md') || filename.endsWith('.rtf') || file.type.startsWith('text/')) {
        draftText = buffer.toString('utf-8');
      } else {
        return NextResponse.json(
          { error: 'Format de fichier non supporté. Veuillez utiliser un fichier PDF, DOCX, TXT ou MD.' },
          { status: 400 }
        );
      }
    } else if (textDraft) {
      draftText = textDraft;
    }

    if (!draftText || !draftText.trim()) {
      return NextResponse.json({ error: 'Le contenu du brouillon est vide.' }, { status: 400 });
    }

    if (draftText.length > 3000) {
      return NextResponse.json(
        { 
          error: `Votre brouillon est trop long (${draftText.length} caractères). La limite pour l'IA gratuite de notre site est de 3000 caractères. Veuillez raccourcir le document ou utiliser l'option "Créer avec mon IA" ci-dessus.` 
        }, 
        { status: 400 }
      );
    }

    const apiKey = getOpenRouterApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "La génération par IA n'est pas configurée sur cette instance." },
        { status: 503 }
      );
    }

    // 4. Appel OpenRouter avec le prompt système optimisé
    const promptSystem = `Tu es un expert en structure de données pour formulaires Papyrus.
Ta tâche est de transformer un brouillon de formulaire en objet JSON valide compatible avec l'application.

Voici la structure JSON stricte à respecter :
{
  "title": "Titre du formulaire",
  "description": "Description du formulaire",
  "display_mode": "sections",
  "scoring_enabled": true, // Mettre à true si le formulaire contient des questions notées (avec des points pour les réponses)
  "show_score_to_respondent": false, // Toujours false
  "fields": [
    {
      "id": "generer_un_id_temporaire_unique_1",
      "type": "single_choice", // 'short_text', 'long_text', 'email', 'phone', 'number', 'url', 'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps', 'date', 'file', 'section_break', 'statement', 'image', 'video', 'matrix'
      "label": {
        "fr": "Libellé de la question en français"
      },
      "description": {
        "fr": "Description ou aide optionnelle en français"
      },
      "placeholder": {
        "fr": "Texte d'exemple optionnel"
      },
      "required": false,
      "options": [
        {
          "id": "opt_1",
          "label": {
            "fr": "Option 1"
          },
          "points": 5 // Optionnel: Nombre de points positif ou négatif (ex: 10, -5, etc.) si notation
        }
      ]
    }
  ],
  "logic_rules": [
    // Renseigne ici les conditions de redirection (branchements) si indiquées dans le brouillon
    {
      "id": "rule_1",
      "conditions": [
        {
          "source_field_id": "id_de_la_question_source",
          "operator": "equals", // ou 'not_equals', 'contains', 'greater_than', 'less_than'
          "value": "id_de_l_option_selectionnee"
        }
      ],
      "conditions_operator": "AND",
      "action_type": "show_field", // ou 'hide_field', 'jump_to', 'end_form'
      "target_field_id": "id_de_la_question_cible",
      "rule_order": 0
    }
  ]
}

Consignes importantes :
1. Les champs textuels 'label', 'description' et 'placeholder' doivent être des objets avec la clé "fr" (ex: "label": {"fr": "Nom"}).
2. Les types de champs autorisés sont uniquement : 'short_text', 'long_text', 'email', 'phone', 'number', 'url', 'single_choice', 'multiple_choice', 'dropdown', 'rating', 'nps', 'date', 'file', 'section_break', 'statement', 'image', 'video', 'matrix'.
3. Si le brouillon indique des règles de logique (ex: "si Oui, afficher Q9") ou de notation (ex: "Oui = +10 pts"), intègre-les de manière rigoureuse dans les propriétés "points" et le tableau "logic_rules" en veillant à la correspondance des IDs.
4. Génère UNIQUEMENT l'objet JSON brut valide. Pas d'introduction, pas de balises de code Markdown.`;

    const MODELS = [
      'meta-llama/llama-3.3-70b-instruct:free',
      'openrouter/free',
      'meta-llama/llama-3.2-3b-instruct:free',
    ];

    const callOpenRouter = async (model: string) =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Papyrus',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: promptSystem },
            { role: 'user', content: draftText },
          ],
          response_format: { type: 'json_object' },
        }),
      });

    let openRouterResponse: Response | null = null;
    let lastErrorDetail = '';

    for (const model of MODELS) {
      try {
        console.log(`Calling OpenRouter with model: ${model}`);
        openRouterResponse = await callOpenRouter(model);
        if (openRouterResponse.ok) {
          break;
        } else {
          lastErrorDetail = await openRouterResponse.text();
          console.warn(`Model ${model} failed with status ${openRouterResponse.status}:`, lastErrorDetail);
        }
      } catch (err: any) {
        lastErrorDetail = err.message || String(err);
        console.error(`Error calling model ${model}:`, err);
      }
    }

    if (!openRouterResponse || !openRouterResponse.ok) {
      console.error('All OpenRouter models failed. Last error:', lastErrorDetail);
      try {
        const errorJson = JSON.parse(lastErrorDetail);
        if (errorJson.error?.code === 429) {
          return NextResponse.json(
            { error: 'Le service IA est temporairement surchargé. Réessaie dans quelques secondes.' },
            { status: 429 }
          );
        }
      } catch {}
      return NextResponse.json(
        { error: 'Erreur lors de l\'appel à l\'IA : les serveurs d\'OpenRouter sont actuellement surchargés. Veuillez réessayer.' },
        { status: openRouterResponse?.status ?? 503 }
      );
    }

    const completion = await openRouterResponse.json();
    const messageContent = completion.choices?.[0]?.message?.content;
    
    if (!messageContent) {
      return NextResponse.json({ error: 'L\'IA a renvoyé une réponse vide' }, { status: 500 });
    }

    let parsedJson: any = null;
    let extractedContent = '';
    try {
      extractedContent = extractJson(messageContent);
      const sanitizedContent = sanitizeJsonString(extractedContent);
      parsedJson = JSON.parse(sanitizedContent);
    } catch (parseError: any) {
      console.error('Failed to parse AI response as JSON.', parseError);
      console.error('Raw AI response was:', messageContent);
      console.error('Extracted content was:', extractedContent);
      return NextResponse.json(
        { 
          error: 'Le format du formulaire généré par l\'IA est invalide. Veuillez réessayer.',
          details: parseError.message
        }, 
        { status: 500 }
      );
    }

    return NextResponse.json(parsedJson);

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Une erreur serveur est survenue' }, { status: 500 });
  }
}

function extractJson(str: string): string {
  let cleaned = str.trim();
  
  // 1. Enlever les blocs de code markdown
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  
  cleaned = cleaned.trim();
  
  // 2. Extraire la première accolade ouvrante et la dernière accolade fermante
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }
  
  return cleaned;
}

function sanitizeJsonString(str: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    
    if (inString) {
      const code = char.charCodeAt(0);
      if (code < 32) {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += '\\u' + code.toString(16).padStart(4, '0');
        }
        continue;
      }
    }
    
    result += char;
  }
  
  return result;
}
