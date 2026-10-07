import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const NOTION_VERSION = "2022-06-28";

interface ConvertedBlock {
  type: 'heading' | 'paragraph' | 'bullets' | 'table';
  text?: string;
  items?: string[];
  table?: { headers: string[]; rows: string[][] };
}

function richTextToPlainText(richText: any[]): string {
  if (!richText || richText.length === 0) return "";
  return richText.map((rt: any) => rt.plain_text ?? "").join("");
}

function convertBlock(block: any): ConvertedBlock | null {
  const type = block.type;
  const text = richTextToPlainText(block[type]?.rich_text ?? []);

  if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
    return { type: "heading", text: text || "Heading" };
  }

  if (type === "paragraph") {
    if (!text) return null;
    return { type: "paragraph", text };
  }

  if (type === "bulleted_list_item" || type === "numbered_list_item") {
    return { type: "bullets", items: [text] };
  }

  if (type === "to_do") {
    const checked = block.to_do?.checked ? "☑" : "☐";
    return { type: "bullets", items: [`${checked} ${text}`] };
  }

  if (type === "table") {
    const hasColumnHeader = block.table?.has_column_header ?? false;
    const hasRowHeader = block.table?.has_row_header ?? false;
    return {
      type: "table",
      table: { headers: [], rows: [], },
    };
  }

  return null;
}

function mergeBullets(blocks: ConvertedBlock[]): ConvertedBlock[] {
  const merged: ConvertedBlock[] = [];
  for (const b of blocks) {
    if (b.type === "bullets" && merged.length > 0 && merged[merged.length - 1].type === "bullets") {
      merged[merged.length - 1].items!.push(...b.items!);
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
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
    const pageId = url.searchParams.get("page_id");

    if (!tokenId || !pageId) {
      return new Response(JSON.stringify({ error: "Missing token_id or page_id." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Fetch page metadata for the title
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
        "Notion-Version": NOTION_VERSION,
      },
    });

    if (!pageRes.ok) {
      const errBody = await pageRes.text();
      return new Response(JSON.stringify({ error: `Notion API error: ${errBody}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pageData = await pageRes.json();
    let title = "Untitled";
    if (pageData.properties) {
      for (const key of Object.keys(pageData.properties)) {
        if (pageData.properties[key].type === "title") {
          title = richTextToPlainText(pageData.properties[key].title) || "Untitled";
          break;
        }
      }
    }
    const lastEdited = pageData.last_edited_time
      ? new Date(pageData.last_edited_time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";

    // Fetch all child blocks with pagination
    let allBlocks: any[] = [];
    let cursor: string | undefined = undefined;
    do {
      const blockUrl = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
      if (cursor) blockUrl.searchParams.set("start_cursor", cursor);
      blockUrl.searchParams.set("page_size", "100");

      const blocksRes = await fetch(blockUrl.toString(), {
        headers: {
          Authorization: `Bearer ${tokenRow.access_token}`,
          "Notion-Version": NOTION_VERSION,
        },
      });

      if (!blocksRes.ok) {
        const errBody = await blocksRes.text();
        return new Response(JSON.stringify({ error: `Notion API error: ${errBody}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const blocksData = await blocksRes.json();
      allBlocks = allBlocks.concat(blocksData.results ?? []);
      cursor = blocksData.has_more ? blocksData.next_cursor : undefined;
    } while (cursor);

    // Convert Notion blocks to our PDF block format
    const converted: ConvertedBlock[] = [];

    for (const block of allBlocks) {
      if (block.type === "table") {
        // Fetch table rows
        let tableRows: any[] = [];
        let tableCursor: string | undefined = undefined;
        do {
          const rowUrl = new URL(`https://api.notion.com/v1/blocks/${block.id}/children`);
          if (tableCursor) rowUrl.searchParams.set("start_cursor", tableCursor);
          rowUrl.searchParams.set("page_size", "100");

          const rowRes = await fetch(rowUrl.toString(), {
            headers: {
              Authorization: `Bearer ${tokenRow.access_token}`,
              "Notion-Version": NOTION_VERSION,
            },
          });

          if (!rowRes.ok) break;
          const rowData = await rowRes.json();
          tableRows = tableRows.concat(rowData.results ?? []);
          tableCursor = rowData.has_more ? rowData.next_cursor : undefined;
        } while (tableCursor);

        const hasColumnHeader = block.table?.has_column_header ?? false;
        const rows: string[][] = [];
        for (const row of tableRows) {
          const cells: string[] = [];
          const cellData = row.table_row?.cells ?? [];
          for (const cell of cellData) {
            cells.push(richTextToPlainText(cell));
          }
          rows.push(cells);
        }

        let headers: string[] = [];
        let dataRows = rows;
        if (hasColumnHeader && rows.length > 0) {
          headers = rows[0];
          dataRows = rows.slice(1);
        } else if (rows.length > 0) {
          // Generate generic column headers
          headers = rows[0].map((_, i) => `Column ${i + 1}`);
        }

        converted.push({ type: "table", table: { headers, rows: dataRows } });
      } else {
        const c = convertBlock(block);
        if (c) converted.push(c);
      }
    }

    const finalBlocks = mergeBullets(converted);

    return new Response(JSON.stringify({
      id: pageId,
      title,
      lastEdited,
      blocks: finalBlocks,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
