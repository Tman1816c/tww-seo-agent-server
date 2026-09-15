import { config } from "./config.js";

export class WpError extends Error {}

function authHeader(): string {
  const token = Buffer.from(
    `${config.wp.username}:${config.wp.appPassword}`
  ).toString("base64");
  return `Basic ${token}`;
}

async function wpFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${config.wp.siteUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `WordPress request failed with HTTP ${res.status} ${res.statusText}`;
    throw new WpError(`${message} (${init.method || "GET"} ${path})`);
  }

  return body as T;
}

export interface WpListedPost {
  id: number;
  title: { rendered: string };
  slug: string;
  status: string;
  link: string;
  modified: string;
  type: string;
}

export interface PageSummary {
  post_id: number;
  title: string;
  type: string;
  status: string;
  slug: string;
  link: string;
  modified: string;
}

export async function listPages(): Promise<PageSummary[]> {
  const query =
    "per_page=100&status=publish,draft,pending,future,private&context=edit&_fields=id,title,slug,status,link,modified,type";
  const [pages, posts] = await Promise.all([
    wpFetch<WpListedPost[]>(`/wp-json/wp/v2/pages?${query}`),
    wpFetch<WpListedPost[]>(`/wp-json/wp/v2/posts?${query}`),
  ]);

  const toSummary = (p: WpListedPost): PageSummary => ({
    post_id: p.id,
    title: p.title?.rendered ?? "(untitled)",
    type: p.type,
    status: p.status,
    slug: p.slug,
    link: p.link,
    modified: p.modified,
  });

  return [...pages, ...posts]
    .map(toSummary)
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

export interface ElementorField {
  element_id: string;
  widget_type: string;
  field: string;
  label: string;
  value: string;
  // "control": found via Elementor's own live widget control schema — safe
  // to treat as a real, verified editable field.
  // "heuristic": Elementor's registry couldn't resolve this widget type (e.g.
  // it's from a deactivated theme/plugin), so this was guessed by scanning
  // setting names — sanity-check the current value before overwriting it.
  confidence: "control" | "heuristic";
  // "text": ordinary copy (a heading/paragraph/button label, a repeater
  // item's text, or an image's alt text — alt fields use a field path
  // ending in ".alt" but are still field_type "text").
  // "tag": an HTML-tag/heading-level select (e.g. a heading widget's
  // header_size — value is one of the control's option keys, like "h2"),
  // not text content. Older bridge versions predate this key, so treat a
  // missing field_type the same as "text".
  field_type?: "text" | "tag";
}

export interface FeaturedImage {
  id: number;
  url: string | null;
  alt: string;
}

export interface PageContent {
  post_id: number;
  title: string;
  slug: string;
  status: string;
  link: string;
  post_content: string;
  seo: {
    title: string;
    description: string;
    focus_keyword: string;
  };
  // Empty array when this post type doesn't support the taxonomy at all
  // (e.g. a plain "page") rather than an error.
  categories: string[];
  tags: string[];
  featured_image: FeaturedImage | null;
  elements: ElementorField[];
  is_elementor: boolean;
}

export async function getPageContent(postId: number): Promise<PageContent> {
  return wpFetch<PageContent>(`/wp-json/tww-agent/v1/content/${postId}`);
}

export interface SeoUpdateFields {
  title?: string;
  description?: string;
  focus_keyword?: string;
}

export async function updateSeoMeta(
  postId: number,
  fields: SeoUpdateFields
): Promise<{ success: boolean; updated: SeoUpdateFields }> {
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/seo`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

export interface ElementorUpdateResult {
  success: boolean;
  post_id: number;
  field: string;
  value: string;
  note: string;
}

export async function updateElementorText(
  postId: number,
  field: string,
  value: string
): Promise<ElementorUpdateResult> {
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/element`, {
    method: "POST",
    body: JSON.stringify({ field, value }),
  });
}

export interface RestoreSnapshotResult {
  success: boolean;
  post_id: number;
  link: string;
  restored_from: string | null;
  remaining_history: number;
}

export async function restoreLastEdit(
  postId: number,
  stepsBack = 0
): Promise<RestoreSnapshotResult> {
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/restore-snapshot`, {
    method: "POST",
    body: JSON.stringify({ steps_back: stepsBack }),
  });
}

export interface DeleteResult {
  success: boolean;
  post_id: number;
  link: string;
  action: "trashed" | "permanently_deleted";
  note?: string;
}

export async function deletePost(
  postId: number,
  force: boolean
): Promise<DeleteResult> {
  const query = force ? "?force=true" : "";
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}${query}`, {
    method: "DELETE",
  });
}

export interface PostContentUpdateResult {
  success: boolean;
  post_id: number;
  link: string;
  changed: boolean;
  old_length: number;
  new_length: number;
}

export async function updatePostContent(
  postId: number,
  content: string
): Promise<PostContentUpdateResult> {
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/post-content`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export interface PostDetailsUpdateResult {
  success: boolean;
  post_id: number;
  title: string;
  slug: string;
  status: string;
  date: string;
  link: string;
  changed: { title: boolean; slug: boolean; status: boolean };
  slug_changed?: boolean;
  old_link?: string;
  note?: string;
  note_schedule?: string;
  slug_adjusted_by_wordpress?: boolean;
}

export type PostStatus = "draft" | "publish" | "pending" | "private" | "future";

export interface PostDetailsFields {
  title?: string;
  slug?: string;
  status?: PostStatus;
  publish_date?: string;
}

export async function updatePostDetails(
  postId: number,
  fields: PostDetailsFields
): Promise<PostDetailsUpdateResult> {
  const body: PostDetailsFields = {};
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.slug !== undefined) body.slug = fields.slug;
  if (fields.status !== undefined) body.status = fields.status;
  if (fields.publish_date !== undefined) body.publish_date = fields.publish_date;

  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/details`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface TaxonomyUpdateResult {
  success: boolean;
  post_id: number;
  categories?: string[];
  tags?: string[];
}

export async function updateTaxonomies(
  postId: number,
  fields: { categories?: string[]; tags?: string[] }
): Promise<TaxonomyUpdateResult> {
  const body: { categories?: string[]; tags?: string[] } = {};
  if (fields.categories !== undefined) body.categories = fields.categories;
  if (fields.tags !== undefined) body.tags = fields.tags;

  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/taxonomies`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface FeaturedImageUpdateResult {
  success: boolean;
  post_id: number;
  featured_image: FeaturedImage | null;
  action: "set" | "removed";
}

export async function setFeaturedImage(
  postId: number,
  attachmentId: number | null
): Promise<FeaturedImageUpdateResult> {
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/featured-image`, {
    method: "POST",
    body: JSON.stringify({ attachment_id: attachmentId }),
  });
}

export interface MediaSearchResult {
  id: number;
  title: string;
  filename: string;
  url: string | null;
  alt: string;
}

export async function searchMedia(
  query: string
): Promise<{ query: string; results: MediaSearchResult[] }> {
  return wpFetch(`/wp-json/tww-agent/v1/media?q=${encodeURIComponent(query)}`);
}

export interface AltTextUpdateResult {
  success: boolean;
  attachment_id: number;
  alt: string;
}

export async function setAttachmentAlt(
  attachmentId: number,
  alt: string
): Promise<AltTextUpdateResult> {
  return wpFetch(`/wp-json/tww-agent/v1/media/${attachmentId}/alt`, {
    method: "POST",
    body: JSON.stringify({ alt }),
  });
}

export interface AuditRow {
  post_id: number;
  title: string;
  type: string;
  status: string;
  link: string;
  seo_title: string;
  seo_title_length: number;
  meta_description: string;
  meta_description_length: number;
  focus_keyword: string;
  has_featured_image: boolean;
  flags: string[];
}

export interface AuditResult {
  count: number;
  total_found: number;
  truncated: boolean;
  pages: AuditRow[];
}

export async function auditSite(): Promise<AuditResult> {
  return wpFetch(`/wp-json/tww-agent/v1/audit`);
}

export type ArchiveTaxonomy = "category" | "post_tag";

export interface TermRow {
  term_id: number;
  name: string;
  slug: string;
  count: number;
  link: string;
  seo_title: string;
  seo_description: string;
}

export interface TermsListResult {
  taxonomy: ArchiveTaxonomy;
  count: number;
  terms: TermRow[];
}

export async function listTerms(
  taxonomy: ArchiveTaxonomy
): Promise<TermsListResult> {
  return wpFetch(
    `/wp-json/tww-agent/v1/terms?taxonomy=${encodeURIComponent(taxonomy)}`
  );
}

export interface TermSeoUpdateResult {
  success: boolean;
  term_id: number;
  taxonomy: ArchiveTaxonomy;
  link: string;
  updated: { title?: string; description?: string };
}

export async function updateTermSeo(
  termId: number,
  fields: { taxonomy: ArchiveTaxonomy; title?: string; description?: string }
): Promise<TermSeoUpdateResult> {
  const body: Record<string, unknown> = { taxonomy: fields.taxonomy };
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.description !== undefined) body.description = fields.description;

  return wpFetch(`/wp-json/tww-agent/v1/terms/${termId}/seo`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface BrokenLinkRow {
  url: string;
  status: string;
}

export interface BrokenLinksResult {
  post_id: number;
  link: string;
  count: number;
  links: BrokenLinkRow[];
}

export async function checkBrokenLinks(
  postId: number
): Promise<BrokenLinksResult> {
  return wpFetch(`/wp-json/tww-agent/v1/content/${postId}/broken-links`);
}

export interface Redirect {
  id: string;
  source: string;
  target: string;
  type: 301 | 302;
  always: boolean;
  hits: number;
  created: string;
}

export async function listRedirects(): Promise<{
  redirects: Redirect[];
  count: number;
}> {
  return wpFetch(`/wp-json/tww-agent/v1/redirects`);
}

export async function createRedirect(input: {
  source: string;
  target: string;
  type?: 301 | 302;
  always?: boolean;
}): Promise<{ success: boolean; redirect: Redirect; note: string }> {
  return wpFetch(`/wp-json/tww-agent/v1/redirects`, {
    method: "POST",
    body: JSON.stringify({
      source: input.source,
      target: input.target,
      type: input.type ?? 301,
      always: input.always ?? false,
    }),
  });
}

export async function deleteRedirect(
  redirectId: string
): Promise<{ success: boolean; removed: Redirect; remaining: number }> {
  return wpFetch(
    `/wp-json/tww-agent/v1/redirects/${encodeURIComponent(redirectId)}`,
    { method: "DELETE" }
  );
}

export interface SearchMatch {
  post_id: number;
  title: string;
  type: string;
  link: string;
  matched_in: string[];
}

export async function searchContent(
  query: string
): Promise<{ query: string; matches: SearchMatch[] }> {
  return wpFetch(
    `/wp-json/tww-agent/v1/search?q=${encodeURIComponent(query)}`
  );
}
