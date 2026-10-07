// Notion OAuth helpers — client-side only.
// The actual code-for-token exchange happens in the edge function,
// so the client secret never touches the browser.
// The access token is stored server-side; the frontend only holds
// a token row ID that references it.
//
// The Notion client ID is also kept server-side: the frontend redirects
// to the edge function, which builds the Notion authorize URL using the
// server-side NOTION_CLIENT_ID secret and redirects the browser there.

export const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';

/**
 * Redirect the user to the edge function, which in turn redirects
 * to Notion's OAuth consent page using the server-side client ID.
 */
export function startNotionOAuth(): void {
  const edgeUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notion-oauth`;
  const state = crypto.randomUUID();
  sessionStorage.setItem('notion_oauth_state', state);
  window.location.href = `${edgeUrl}?action=authorize&state=${state}`;
}

export interface NotionConnection {
  tokenId: string;
  workspaceName: string;
}

export function parseCallbackParams(
  search: string,
): { ok: true; data: NotionConnection } | { ok: false; error: string; description?: string } {
  const params = new URLSearchParams(search);

  if (params.get('error')) {
    return {
      ok: false,
      error: params.get('error') ?? 'unknown',
      description: params.get('error_description') ?? undefined,
    };
  }

  const tokenId = params.get('token_id');
  if (!tokenId) {
    return { ok: false, error: 'no_token' };
  }

  return {
    ok: true,
    data: {
      tokenId,
      workspaceName: params.get('workspace_name') ?? '',
    },
  };
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const edgeHeaders: Record<string, string> = {
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

export interface NotionPageSummary {
  id: string;
  title: string;
  lastEdited: string;
}

export async function fetchNotionPages(tokenId: string): Promise<NotionPageSummary[]> {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/notion-pages?token_id=${encodeURIComponent(tokenId)}`,
    { headers: edgeHeaders },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();
  if (!data.pages || !Array.isArray(data.pages)) {
    throw new Error('Unexpected response from server.');
  }

  return data.pages as NotionPageSummary[];
}

export interface NotionPageContent {
  id: string;
  title: string;
  lastEdited: string;
  blocks: import('./notionTypes').NotionBlock[];
}

export async function fetchNotionPageContent(
  tokenId: string,
  pageId: string,
): Promise<NotionPageContent> {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/notion-page-content?token_id=${encodeURIComponent(tokenId)}&page_id=${encodeURIComponent(pageId)}`,
    { headers: edgeHeaders },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();
  if (!data.blocks || !Array.isArray(data.blocks)) {
    throw new Error('Unexpected response from server.');
  }

  return data as NotionPageContent;
}
