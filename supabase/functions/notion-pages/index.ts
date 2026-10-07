import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const NOTION_VERSION = "2022-06-28";

function extractTitle(page: any): string {
  const prop = page.properties;
  if (!prop) return "Untitled";
  // Find the title property
  for (const key of Object.keys(prop)) {
    if (prop[key].type === "title") {
      const parts = prop[key].title ?? [];
      return parts.map((p: any) => p.plain_text).join("") || "Untitled";
    }
  }
  return "Untitled";
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server is not configured." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const tokenId = url.searchParams.get("token_id");

    if (!tokenId) {
      return new Response(JSON.stringify({ error: "Missing token_id." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the stored access token
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: tokenRow, error: dbError } = await supabase
      .from("notion_tokens")
      .select("access_token")
      .eq("id", tokenId)
      .single();

    if (dbError || !tokenRow) {
      return new Response(JSON.stringify({ error: "Token not found. Please reconnect." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query Notion for shared pages — only pages the integration can access
    const notionRes = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
      }),
    });

    if (!notionRes.ok) {
      const errBody = await notionRes.text();
      return new Response(JSON.stringify({ error: `Notion API error: ${errBody}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notionData = await notionRes.json();
    const pages = (notionData.results ?? []).map((page: any) => ({
      id: page.id,
      title: extractTitle(page),
      lastEdited: formatDate(page.last_edited_time),
    }));

    return new Response(JSON.stringify({ pages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
