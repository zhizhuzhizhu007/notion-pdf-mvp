import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const NOTION_VERSION = "2022-06-28";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "";
  const NOTION_CLIENT_ID = Deno.env.get("NOTION_CLIENT_ID") ?? "";
  const NOTION_CLIENT_SECRET = Deno.env.get("NOTION_CLIENT_SECRET") ?? "";
  const REDIRECT_URI = Deno.env.get("NOTION_REDIRECT_URI") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const buildRedirect = (params: URLSearchParams) => {
    if (!APP_ORIGIN) return null;
    return `${APP_ORIGIN}/#callback?${params.toString()}`;
  };

  // -- Action: authorize — redirect browser to Notion's consent page --
  // The frontend calls this instead of building the Notion URL itself,
  // so the client ID stays server-side and no VITE_ env var is needed.
  if (action === "authorize") {
    if (!NOTION_CLIENT_ID) {
      const target = buildRedirect(new URLSearchParams({ error: "server_config", error_description: "NOTION_CLIENT_ID is not set" }));
      if (target) return Response.redirect(target, 302);
      return new Response(JSON.stringify({ error: "server_config", message: "NOTION_CLIENT_ID is not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      client_id: NOTION_CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      state: state ?? "",
    });
    return Response.redirect(`https://api.notion.com/v1/oauth/authorize?${params.toString()}`, 302);
  }

  // -- OAuth cancellation / failure from Notion --
  if (error) {
    const errorDesc = url.searchParams.get("error_description") ?? "";
    const p = new URLSearchParams({ error, error_description: errorDesc });
    const target = buildRedirect(p);
    if (target) return Response.redirect(target, 302);
    return new Response(JSON.stringify({ error, error_description: errorDesc }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // -- Missing authorization code --
  if (!code) {
    const target = buildRedirect(new URLSearchParams({ error: "missing_code" }));
    if (target) return Response.redirect(target, 302);
    return new Response(JSON.stringify({ error: "missing_code" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // -- Configuration check --
  const missingConfigs: string[] = [];
  if (!NOTION_CLIENT_ID) missingConfigs.push("NOTION_CLIENT_ID");
  if (!NOTION_CLIENT_SECRET) missingConfigs.push("NOTION_CLIENT_SECRET");
  if (!REDIRECT_URI) missingConfigs.push("NOTION_REDIRECT_URI");
  if (!SUPABASE_URL) missingConfigs.push("SUPABASE_URL");
  if (!SERVICE_ROLE_KEY) missingConfigs.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missingConfigs.length > 0) {
    console.error("[notion-oauth] Missing config:", missingConfigs.join(", "));
    const target = buildRedirect(new URLSearchParams({ error: "server_config", error_description: `Missing: ${missingConfigs.join(", ")}` }));
    if (target) return Response.redirect(target, 302);
    return new Response(JSON.stringify({ error: "server_config", missing: missingConfigs }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("[notion-oauth] Starting token exchange. code length:", code.length, "redirect_uri:", REDIRECT_URI);

  // -- Exchange authorization code for access token --
  try {
    const credentials = `${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`;
    const authHeader = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(credentials)))}`;
    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("[notion-oauth] Token exchange failed:", tokenRes.status, errBody);
      const target = buildRedirect(new URLSearchParams({ error: "token_exchange", error_description: `${tokenRes.status}: ${errBody}` }));
      if (target) return Response.redirect(target, 302);
      return new Response(JSON.stringify({ error: "token_exchange", detail: errBody }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token as string;
    const workspaceName = (tokenData.workspace_name as string) ?? "";

    console.log("[notion-oauth] Token exchange succeeded. workspace:", workspaceName, "token length:", accessToken.length);

    // -- Store token securely in the database --
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error: dbError } = await supabase
      .from("notion_tokens")
      .insert({
        access_token: accessToken,
        workspace_name: workspaceName,
      })
      .select("id")
      .single();

    if (dbError || !data) {
      console.error("[notion-oauth] DB insert failed:", JSON.stringify(dbError));
      const target = buildRedirect(new URLSearchParams({ error: "server_error", error_description: `DB error: ${dbError?.message ?? "no data returned"}` }));
      if (target) return Response.redirect(target, 302);
      return new Response(JSON.stringify({ error: "server_error", message: dbError?.message ?? "Failed to store token" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[notion-oauth] Token stored successfully. row id:", data.id);

    // Redirect back to frontend with only the token row ID (never the access token)
    const p = new URLSearchParams({
      token_id: data.id,
      workspace_name: workspaceName,
      state: state ?? "",
    });
    const target = buildRedirect(p);
    if (target) return Response.redirect(target, 302);

    return new Response(JSON.stringify({ token_id: data.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notion-oauth] Unexpected error:", err);
    const errStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const target = buildRedirect(new URLSearchParams({ error: "server_error", error_description: errStr }));
    if (target) return Response.redirect(target, 302);
    return new Response(JSON.stringify({ error: "server_error", message: errStr }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
