import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listPages,
  getPageContent,
  updateSeoMeta,
  updateElementorText,
  searchContent,
  deletePost,
  updatePostContent,
  updatePostDetails,
  createRedirect,
  listRedirects,
  deleteRedirect,
  restoreLastEdit,
  updateTaxonomies,
  setFeaturedImage,
  searchMedia,
  setAttachmentAlt,
  auditSite,
  listTerms,
  updateTermSeo,
  checkBrokenLinks,
  bulkUpdateSeoMeta,
  getNoindexStatus,
  setNoindex,
  WpError,
} from "./wpClient.js";

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text:
          err instanceof WpError
            ? `WordPress request failed: ${message}`
            : `Error: ${message}`,
      },
    ],
  };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_pages",
    {
      title: "List pages and posts",
      description:
        "List posts and pages on this site (id, title, type, status, slug, link, last modified). Use this to find a post_id when the user names a page by title or URL.",
      inputSchema: {},
    },
    async () => {
      try {
        const pages = await listPages();
        return textResult(pages);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_page_content",
    {
      title: "Get page SEO and Elementor content",
      description:
        "Get the current Rank Math SEO fields (title, description, focus keyword), categories, tags, featured image, and a flattened list of editable Elementor elements for one post_id. Always call this before proposing or making an edit — element field paths are opaque and only this tool returns valid, current ones. Each element carries a confidence field: \"control\" means it was found via Elementor's own live widget control schema (a verified, safe-to-edit field, including widgets from any theme or plugin — not just a fixed list of core Elementor widgets). \"heuristic\" means Elementor's registry couldn't resolve that widget type (e.g. it's from a deactivated theme/plugin), so the field was guessed by scanning setting names for likely text content — double-check a heuristic field's current value looks right before overwriting it, since it wasn't verified against a real control definition. Each element also carries a field_type: \"text\" is ordinary copy (headings, paragraphs, buttons, repeater items, and image alt text — alt fields have a field path ending in \".alt\"); \"tag\" is an HTML-tag/heading-level select (e.g. a heading widget's H1-H6 choice) whose value is one of the control's option keys like \"h2\", not text content — don't propose an SEO/copy rewrite for a \"tag\" field, and don't treat a blank \".alt\" field's current empty value as \"nothing to fix\" — a missing alt text is itself the issue to flag. categories/tags come back as an empty array when this post type doesn't support that taxonomy at all (most sites only use them on posts, not pages) — that's normal, not an error. featured_image is null when none is set.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
      },
    },
    async ({ post_id }) => {
      try {
        const content = await getPageContent(post_id);
        return textResult(content);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_seo_meta",
    {
      title: "Update Rank Math SEO fields",
      description:
        "Update the Rank Math SEO title, meta description, and/or focus keyword for one post_id. Only pass the fields you want to change.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        title: z
          .string()
          .optional()
          .describe("New Rank Math SEO title (~50-60 characters recommended)"),
        description: z
          .string()
          .optional()
          .describe("New Rank Math meta description (~120-155 characters recommended)"),
        focus_keyword: z
          .string()
          .optional()
          .describe("New Rank Math focus keyword"),
      },
    },
    async ({ post_id, title, description, focus_keyword }) => {
      try {
        const result = await updateSeoMeta(post_id, {
          title,
          description,
          focus_keyword,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_elementor_text",
    {
      title: "Update one Elementor text field",
      description:
        "Update a single Elementor widget text field on one post_id, identified by the exact 'field' path returned by get_page_content (e.g. 'abc123::title' or 'abc123::icon_list[2].text'). One field per call. Always fetch get_page_content first to get a current, valid field path — for a field marked confidence: \"heuristic\" there, double-check its current value looks right before overwriting it, since that field wasn't verified against Elementor's own control schema. This is saved through Elementor's Document API, and a snapshot of the previous version is taken automatically before the write — call restore_last_edit with the same post_id right after this if the edit needs to be undone (only the single most recent edit to a post can be undone this way; a second edit overwrites the snapshot).",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        field: z
          .string()
          .describe("The exact field path from get_page_content's elements list"),
        value: z.string().describe("The new text value"),
      },
    },
    async ({ post_id, field, value }) => {
      try {
        const result = await updateElementorText(post_id, field, value);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "search_content",
    {
      title: "Search site content",
      description:
        "Search post/page titles, body content, and Elementor widget text across the whole site for a keyword or phrase. Use this to find where a keyword currently appears (or doesn't) before proposing a keyword fix.",
      inputSchema: {
        query: z.string().min(1).describe("Keyword or phrase to search for"),
      },
    },
    async ({ query }) => {
      try {
        const results = await searchContent(query);
        return textResult(results);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_post",
    {
      title: "Trash or permanently delete a post/page",
      description:
        "Remove a post or page. Two-step by design so nothing is permanently destroyed in one call: without force (the default), this only moves the post to the WordPress trash — fully recoverable from wp-admin, same as clicking 'Trash'. Calling it again with force=true permanently deletes it, but ONLY works once the post is already in the trash (it will refuse to permanently delete something that isn't trashed yet, to prevent a one-shot destructive mistake). Typical flow for removing a confirmed duplicate: call once with force=false/omitted to trash it, confirm that's the right post, then call again with force=true to finish. Always confirm the exact post_id and title (via get_page_content or list_pages) before calling this — deletion cannot be un-done once force=true succeeds.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID to trash or delete"),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "false or omitted (default): move to trash (recoverable). true: permanently delete — only succeeds if this post is already in the trash."
          ),
      },
    },
    async ({ post_id, force }) => {
      try {
        const result = await deletePost(post_id, force ?? false);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_post_content",
    {
      title: "Replace the body content of a classic/Gutenberg post",
      description:
        "Replace the entire post_content of a classic or Gutenberg post or page. This is a FULL REPLACE, not a patch — always call get_page_content first, read the current post_content, and send back the complete new body including any part you are keeping. Refuses with a clear error on Elementor-built pages (they render from _elementor_data and ignore post_content, so a write here would silently do nothing on the front end) — use update_elementor_text for those instead.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        content: z
          .string()
          .describe(
            "The complete new post body (HTML, or Gutenberg block markup including its <!-- wp:... --> delimiters). Replaces the existing content entirely."
          ),
      },
    },
    async ({ post_id, content }) => {
      try {
        const result = await updatePostContent(post_id, content);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_post_details",
    {
      title: "Update a post's title, slug, status, or publish date",
      description:
        "Set the post_title, URL slug, publishing status, and/or publish date of a post or page. Pass only the fields you want to change. WARNING: changing the slug changes the page's public URL and WordPress does NOT redirect the old one — if the response comes back with slug_changed, pair it with a create_redirect call from the old path to the new one, or the old URL will 404 and lose whatever rankings and inbound links it had. Note the title here is the post title (the <h1>/page title), separate from the Rank Math SEO title set by update_seo_meta. status must be one of draft, publish, pending, private, future — to schedule a post, pass status: \"publish\" together with a future publish_date; WordPress's own core logic will store it as status \"future\" (its scheduled-post state) and the response will reflect that.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        title: z.string().optional().describe("New post title"),
        slug: z
          .string()
          .optional()
          .describe(
            "New URL slug (the last segment of the permalink, e.g. 'luxury-safari-experiences'). WordPress may adjust it if it collides with an existing one."
          ),
        status: z
          .enum(["draft", "publish", "pending", "private", "future"])
          .optional()
          .describe(
            "New publishing status. Use \"publish\" to publish a draft immediately, or pair with a future publish_date to schedule it."
          ),
        publish_date: z
          .string()
          .optional()
          .describe(
            "New publish date/time, e.g. '2026-09-15 09:00:00' or an ISO 8601 string. Combine with status: \"publish\" to schedule a future post."
          ),
      },
    },
    async ({ post_id, title, slug, status, publish_date }) => {
      try {
        const result = await updatePostDetails(post_id, {
          title,
          slug,
          status,
          publish_date,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_taxonomies",
    {
      title: "Set a post's categories and/or tags",
      description:
        "Set the categories and/or tags on a post or page, by plain name rather than ID. Pass only the one(s) you want to change — omitting categories leaves categories untouched, and likewise for tags; pass an empty array to clear one out entirely. This is a full replace of whichever list you pass, not an add-to. Category and tag names that don't already exist are created automatically. Refuses clearly if this post type doesn't support the taxonomy at all (most sites only use categories/tags on posts, not pages).",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        categories: z
          .array(z.string())
          .optional()
          .describe("Full replacement list of category names, e.g. ['Safari Tips', 'Destinations']."),
        tags: z
          .array(z.string())
          .optional()
          .describe("Full replacement list of tag names, e.g. ['kilimanjaro', 'budget-travel']."),
      },
    },
    async ({ post_id, categories, tags }) => {
      try {
        const result = await updateTaxonomies(post_id, { categories, tags });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "set_featured_image",
    {
      title: "Set or remove a post's featured image",
      description:
        "Set a post's featured image (thumbnail) to an existing media library attachment, or remove it entirely. Use search_media first to find the attachment_id — this does not accept a URL and cannot upload a new image, only point at something already in the media library.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        attachment_id: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .describe("The media library attachment ID to use, from search_media. Pass 0 or null to remove the current featured image instead."),
      },
    },
    async ({ post_id, attachment_id }) => {
      try {
        const result = await setFeaturedImage(post_id, attachment_id);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "search_media",
    {
      title: "Search the media library for images",
      description:
        "Search the WordPress media library for images by filename, title, or alt text. Use this to find an attachment_id for set_featured_image, since nothing else on this site exposes the media library. Images only — returns id, title, filename, url, and current alt text for each match.",
      inputSchema: {
        query: z.string().min(1).describe("Keyword to search for, e.g. part of a filename or title"),
      },
    },
    async ({ query }) => {
      try {
        const result = await searchMedia(query);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "create_redirect",
    {
      title: "Create a 301/302 redirect",
      description:
        "Create a redirect from an old path to a new URL, stored in this bridge plugin's own redirect table (independent of Rank Math or any other SEO plugin). Use after trashing a page or changing a slug, so the old URL keeps its link equity instead of 404ing. By default the redirect only fires when the source path would otherwise 404, so it can never shadow a page that still exists — set always=true only when you deliberately want to redirect a URL that still resolves. Requires an administrator, since this affects site-wide routing.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .describe(
            "The old path to redirect FROM, e.g. '/old-page' or a full URL on this site (query strings and trailing slashes are normalised away)."
          ),
        target: z
          .string()
          .min(1)
          .describe(
            "Where to send visitors: a site-relative path like '/new-page', or a full http(s) URL for off-site."
          ),
        type: z
          .union([z.literal(301), z.literal(302)])
          .optional()
          .default(301)
          .describe("301 = permanent (the SEO default), 302 = temporary."),
        always: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "false (default): only redirect when the source would 404 — safe, can't shadow a live page. true: always redirect, even if something still lives there."
          ),
      },
    },
    async ({ source, target, type, always }) => {
      try {
        const result = await createRedirect({
          source,
          target,
          type: type ?? 301,
          always: always ?? false,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_redirects",
    {
      title: "List all redirects",
      description:
        "List every redirect in this bridge plugin's store, with its id, source, target, type, and hit count. Use this to audit what's in place, to find the id needed by delete_redirect, or to check whether a redirect is actually being used before removing it.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await listRedirects();
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_redirect",
    {
      title: "Delete a redirect",
      description:
        "Remove one redirect by its id (get ids from list_redirects). Takes effect immediately: the source path will 404 again unless something else lives there. Requires an administrator.",
      inputSchema: {
        redirect_id: z
          .string()
          .min(1)
          .describe("The redirect's id, as returned by list_redirects or create_redirect"),
      },
    },
    async ({ redirect_id }) => {
      try {
        const result = await deleteRedirect(redirect_id);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "restore_last_edit",
    {
      title: "Undo a recent Elementor element edit",
      description:
        "Restore a post's Elementor element tree to what it was before a recent update_elementor_text call. Keeps up to the last 5 edits per post — omit steps_back (or pass 0) to undo just the most recent edit; pass 1 to undo back two edits, etc. Restoring to a given point discards it and every edit newer than it, so this is a shallow, capped undo stack, not a full version history. Fails with a clear error if there's no snapshot to restore, or if steps_back asks for more history than is actually saved.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        steps_back: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("How many edits back to restore to. 0 (default) = undo the single most recent edit."),
      },
    },
    async ({ post_id, steps_back }) => {
      try {
        const result = await restoreLastEdit(post_id, steps_back ?? 0);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "set_alt_text",
    {
      title: "Set an image's alt text directly",
      description:
        "Set (or clear) an attachment's own alt text in the media library, independent of any Elementor widget. Use this for images get_page_content's elements list can't reach — gallery images, CSS background images, or any image on a non-Elementor page — none of which have an alt-text path through update_elementor_text. Use search_media first to find the attachment_id. Pass an empty string to clear the alt text; that's valid, not an error.",
      inputSchema: {
        attachment_id: z.number().int().positive().describe("The media library attachment ID, from search_media"),
        alt: z.string().describe("New alt text. Pass \"\" to clear it."),
      },
    },
    async ({ attachment_id, alt }) => {
      try {
        const result = await setAttachmentAlt(attachment_id, alt);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "audit_site",
    {
      title: "Audit every page's SEO in one call",
      description:
        "Scan every post/page on the site in a single call and return, per page: SEO title (and length), meta description (and length), focus keyword, whether a featured image is set, and a flags array (missing_seo_title, seo_title_too_long, missing_meta_description, meta_description_too_long, missing_focus_keyword, missing_featured_image, featured_image_missing_alt). Use this instead of calling get_page_content once per page when scanning the whole site for problems — it's read-only and much cheaper. This does NOT walk each page's Elementor element tree (no per-widget alt-text or content checks) — call get_page_content for that level of detail on a specific page. Capped at 500 posts/pages; the response's truncated flag says if the site has more than that.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await auditSite();
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_terms",
    {
      title: "List category or tag archive pages with their SEO meta",
      description:
        "List every term in a taxonomy (category or tag) with its current Rank Math archive-page SEO title/description. Category and tag archive pages are invisible to every other tool here (they all work on post_id, and an archive page isn't a post) — use this to find a term_id for update_term_seo.",
      inputSchema: {
        taxonomy: z.enum(["category", "post_tag"]).describe("Which taxonomy to list"),
      },
    },
    async ({ taxonomy }) => {
      try {
        const result = await listTerms(taxonomy);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_term_seo",
    {
      title: "Update a category or tag archive page's SEO",
      description:
        "Set the Rank Math SEO title and/or description for a category or tag archive page. Pass only the field(s) you want to change. Get term_id from list_terms.",
      inputSchema: {
        term_id: z.number().int().positive().describe("The category or tag's term ID, from list_terms"),
        taxonomy: z.enum(["category", "post_tag"]).describe("Which taxonomy this term belongs to"),
        title: z.string().optional().describe("New archive-page SEO title"),
        description: z.string().optional().describe("New archive-page meta description"),
      },
    },
    async ({ term_id, taxonomy, title, description }) => {
      try {
        const result = await updateTermSeo(term_id, { taxonomy, title, description });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "check_broken_links",
    {
      title: "Check a page's internal links",
      description:
        "Best-effort scan of one page's internal links (Elementor link controls plus any href in HTML content) against WordPress's own URL resolver. Three statuses: \"ok\" (resolves to a live page), \"broken (target is ...)\" (resolves to a real post that's trashed/draft/private — a confident finding), and \"unresolved\" (WordPress's resolver couldn't match it — this does NOT mean the link is dead; custom rewrites, plugin-generated archives, and static asset URLs often show as unresolved even though they work fine, so treat unresolved as \"a human should glance at this,\" not proof of a broken link). External links (a different domain) are skipped entirely.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID to check"),
      },
    },
    async ({ post_id }) => {
      try {
        const result = await checkBrokenLinks(post_id);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_noindex_status",
    {
      title: "Get noindex status of a page",
      description:
        "Check whether a post or page is set to noindex in Rank Math. Returns the current robots array so you can see the full directive (noindex, nofollow, etc.).",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
      },
    },
    async ({ post_id }) => {
      try {
        const result = await getNoindexStatus(post_id);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "set_noindex",
    {
      title: "Set noindex on a page",
      description:
        "Set or clear the Rank Math noindex directive on a post or page. " +
        "Pass noindex: true to tell search engines not to index this page; " +
        "false to make it indexable. This writes directly to the rank_math_robots post meta.",
      inputSchema: {
        post_id: z.number().int().positive().describe("The WordPress post or page ID"),
        noindex: z.boolean().describe("true = noindex (hide from search engines), false = index (allow indexing)"),
      },
    },
    async ({ post_id, noindex }) => {
      try {
        const result = await setNoindex(post_id, noindex);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "bulk_update_seo_meta",
    {
      title: "Bulk update Rank Math SEO fields",
      description:
        "Update Rank Math SEO title, meta description, and/or focus keyword for " +
        "multiple posts in a single API call. Use this instead of calling " +
        "update_seo_meta once per post — far more efficient and avoids hitting " +
        "rate limits. Each item must include post_id and at least one field to change.",
      inputSchema: {
        updates: z
          .array(
            z.object({
              post_id: z.number().int().positive().describe("The WordPress post or page ID"),
              title: z.string().optional().describe("New Rank Math SEO title (~50-60 chars recommended)"),
              description: z.string().optional().describe("New Rank Math meta description (~120-155 chars recommended)"),
              focus_keyword: z.string().optional().describe("New Rank Math focus keyword"),
            })
          )
          .min(1)
          .max(100)
          .describe("Array of updates. Each item needs post_id plus at least one field."),
      },
    },
    async ({ updates }) => {
      try {
        const result = await bulkUpdateSeoMeta(updates);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
