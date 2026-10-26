import { designBlocksJsonSchema } from "./design-blocks";
import { parseFormDescriptors } from "./forms/descriptor";
import { designThemeSchema } from "./design-theme";
import { z } from "zod";
import type * as Types from "./content-types";
import type { ContentConfig, ExtensionNode } from "./server";
import type {
  WordPressImage,
  WordPressPost,
  WordPressMenuItem,
  HomeContent,
  EntryContent,
  PublishedEntry,
  SiteChrome,
  CmsFailure,
  Found,
  Missing,
  Unavailable,
  Delivery,
  DesignPresets,
} from "./content-types";
import { languageSubject, type SiteLanguage } from "./site-language";
import { cmsTime, uriPath, menuItemHref } from "./formatting";
import {
  hasDesignCarousel,
  hasVideoHero,
  parseWordPressBlocks,
  renderWordPressBlocks,
} from "./wp-block-renderer";
import { parseDesignBlocks, type DesignPattern } from "./design-patterns";
import { parseLegalLanguage } from "./consent/legal";

export interface WordPressClient<X = unknown> {
  getHomeContent(
    this: void,
    language?: SiteLanguage,
  ): Promise<Types.Delivery<Types.HomeContent<X>>>;
  getEntryByUri(this: void, uri: string): Promise<Types.Delivery<Types.EntryContent<X>>>;
  getDesignPresets(this: void): Promise<Types.Found<Types.DesignPresets> | Types.Unavailable>;
  getPublishedEntries(
    this: void,
  ): Promise<
    Types.Found<{ entries: Types.PublishedEntry[]; requests: number }> | Types.Unavailable
  >;
  getPublishedRoutes(this: void): Promise<Types.Found<string[]> | Types.Unavailable>;
  getArchives(this: void): Promise<Types.Found<Types.Archives> | Types.Unavailable>;
  getSiteChrome(
    this: void,
    siteOrigin?: string,
    options?: { location?: string; language?: SiteLanguage },
  ): Promise<Types.Found<Types.SiteChrome> | Types.Unavailable>;
}
/** The origins a link into this Site may use: WordPress's, and the Frontend's when given. */
/** The first GQ Design whose `designPattern` serves the default `page` route. */
const DESIGN_PATTERN_VERSION = "0.4.1";

export function internalOrigins(
  config: Pick<ContentConfig<unknown>, "graphqlEndpoint">,
  siteOrigin?: string,
) {
  return [new URL(config.graphqlEndpoint).origin, ...(siteOrigin ? [siteOrigin] : [])];
}

export function configuredWordPress<X>(
  config: ContentConfig<X>,
  languages: readonly SiteLanguage[],
): WordPressClient<X> {
  const defaultLanguage = languages[0]!;
  const multilingual = languages.length > 1;
  const extension = config.extension;
  const collections = Object.entries(config.collections ?? {});
  /** The collection whose items are of a WPGraphQL type, if one is. */
  const collectionOf = (typename: string) =>
    collections.find(([, collection]) => collection.graphqlType === typename);
  /** The Site's extension fields on a kind of node (an item's, its collection's). */
  const extensionSelection = (kind: ExtensionNode["kind"], collection?: string) =>
    (kind === "item"
      ? extension?.fields.collections?.[collection ?? ""]
      : extension?.fields[kind]
    )?.trim();
  /**
   * The Site's extension fields on a kind of node, read with the blocks (left
   * out with them when WordPress fails on them).
   */
  const extensionFields = (kind: ExtensionNode["kind"], collection?: string) => {
    const fields = extensionSelection(kind, collection);
    return fields ? `\n... @include(if: $withBlocks) {\n${fields}\n}` : "";
  };
  /**
   * The public descriptors of the Gravity Forms forms an entry references
   * (gq-content's CMS forms module), read with the blocks on a Site that
   * opts in to forms. Without the option the queries are unchanged.
   */
  const formsField = config.forms ? "\n          getquickForms @include(if: $withBlocks)" : "";
  const formsJson = z
    .string()
    .nullish()
    .transform((value) => (value == null ? undefined : parseFormDescriptors(value)));
  // The GETQUICK schema the Frontend requires. A field WordPress leaves out, or
  // returns with another type, fails the read: only the fields declared nullable
  // here may be null, and only those fall back to a default.
  const image = z.object({ sourceUrl: z.string(), altText: z.string().nullable() });
  const imageEdge = z.object({ node: image.nullable() }).nullable();

  const designTokens = z.object({
    theme: designThemeSchema.optional(),
    spacingSizes: z.array(z.object({ slug: z.string(), size: z.string() })),
    colors: z.array(z.object({ slug: z.string(), color: z.string() })),
  });

  const homeData = z.object({
    generalSettings: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
    nodeByUri: z
      .union([
        z
          .object({
            __typename: z.literal("Page"),
            id: z.string().nullable().optional(),
            databaseId: z.number().int().positive().optional(),
            getquickBlocksJson: designBlocksJsonSchema,
            getquickForms: formsJson.optional(),
            isFrontPage: z.boolean(),
            title: z.string().nullable(),
            content: z.string().nullable(),
            // Left out when read without blocks.
            blocks: z.unknown().optional(),
          })
          // The Site's extension fields, which it validates itself.
          .passthrough(),
        z.object({ __typename: z.string().refine((typename) => typename !== "Page") }),
      ])
      .nullable(),
    designTokens,
  });

  const pageEntry = z
    .object({
      id: z.string(),
      databaseId: z.number().int().positive().optional(),
      getquickBlocksJson: designBlocksJsonSchema,
      getquickForms: formsJson.optional(),
      title: z.string().nullable(),
      content: z.string().nullable(),
      uri: z.string(),
      // Only `publish` and unrestricted is public. A password-protected entry is
      // restricted: WordPress lists it to anonymous readers, without its content.
      status: z.string().nullable(),
      isRestricted: z.boolean().nullable(),
      // When it was last modified (GMT, without a zone). Only reconciliation
      // uses it, so a WordPress that leaves it out is still served.
      modifiedGmt: z.string().nullable().optional(),
      featuredImage: imageEdge,
      // Left out when read without blocks.
      blocks: z.unknown().optional(),
    })
    // The Site's extension fields, which it validates itself.
    .passthrough();
  const postEntry = pageEntry.extend({
    excerpt: z.string().nullable(),
    date: z.string().nullable(),
  });

  // On a multilingual Site, an entry's language and its translations (GQ
  // Polylang for WPGraphQL), which only include what anonymous readers may see.
  const languageRef = z.object({ slug: z.string() });
  const translated = {
    language: languageRef.nullable(),
    translations: z
      .array(z.object({ uri: z.string().nullable(), language: languageRef.nullable() }))
      .nullable(),
  };

  const entryData = z.object({
    postBy: postEntry.nullable(),
    pageBy: pageEntry.nullable(),
    designTokens,
  });

  // On a Site with collections, any entry is read as the node at its URI: the
  // fields a type may lack (its title, content, excerpt or featured image,
  // per what it supports) are left out for it.
  const termNode = z.object({
    slug: z.string(),
    name: z.string().nullable(),
    taxonomyName: z.string().nullable(),
  });
  const nodeEntry = z
    .object({
      __typename: z.string(),
      databaseId: z.number().int().positive().optional(),
      getquickBlocksJson: designBlocksJsonSchema,
      getquickForms: formsJson.optional(),
      id: z.string(),
      uri: z.string().nullable(),
      status: z.string().nullable(),
      isRestricted: z.boolean().nullable(),
      modifiedGmt: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      excerpt: z.string().nullable().optional(),
      featuredImage: imageEdge.optional(),
      // Left out when read without blocks.
      blocks: z.unknown().optional(),
      // A collection's taxonomies' terms, when it has any.
      terms: z
        .object({ nodes: z.array(termNode) })
        .nullable()
        .optional(),
      language: languageRef.nullable().optional(),
      translations: translated.translations.optional(),
    })
    // The Site's extension fields, which it validates itself.
    .passthrough();
  const nodeEntryData = z.object({
    node: z
      .union([
        nodeEntry,
        z.object({
          __typename: z
            .string()
            .refine((name) => name !== "Post" && name !== "Page" && !collectionOf(name)),
        }),
      ])
      .nullable(),
    designTokens,
  });

  const translatedEntryData = z.object({
    postBy: postEntry.extend(translated).nullable(),
    pageBy: pageEntry.extend(translated).nullable(),
    designTokens,
  });

  // Another language's front page, title and tagline (GQ Polylang for WPGraphQL).
  const languageHomeData = homeData.omit({ generalSettings: true }).extend({
    language: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  });

  const designData = z.object({ designTokens });

  const menuItem = z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    label: z.string().nullable(),
    url: z.string().nullable(),
    target: z.string().nullable(),
  });

  const publishedRoutesData = z.object({
    contentNodes: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(
        z.object({
          uri: z.string().nullable(),
          id: z.string().nullable().optional(),
          modifiedGmt: z.string().nullable().optional(),
        }),
      ),
    }),
  });

  // GQ Design's Header & Footer selection; null when the region uses a
  // template part. `blocksJson` is the block tree as JSON text.
  const designPattern = z.object({ title: z.string(), blocksJson: z.string() }).nullable();

  const chromeWithoutPatternsData = z.object({
    generalSettings: z.object({ siteIcon: imageEdge, siteLogo: imageEdge }),
    menuItems: z.object({ nodes: z.array(menuItem) }),
  });
  const siteChromeData = chromeWithoutPatternsData.extend({
    header: designPattern,
    footer: designPattern,
  });

  // gq-config's consent settings (LEGAL-1's Contract in one language, and the
  // GA4 toggle), read with the chrome only when a Site opts in to consent.
  const consentSettingsData = z.object({
    getquickLegal: z.unknown(),
    googleAnalytics: z
      .object({ enabled: z.boolean(), measurementId: z.string().nullable() })
      .nullable(),
  });
  const consentSettingsQuery = /* GraphQL */ `
    query ConsentSettings($language: String) {
      getquickLegal(language: $language) {
        schemaVersion
        controller {
          name
          privacyEmail
          dpoContact
        }
        roles {
          role
          url
          title
          revision
          isFallback
        }
        missingRequired
      }
      googleAnalytics {
        enabled
        measurementId
      }
    }
  `;

  type RawEntry = z.infer<typeof pageEntry> &
    Partial<z.infer<typeof postEntry>> &
    Partial<z.infer<z.ZodObject<typeof translated>>>;
  type RawMenuItem = z.infer<typeof menuItem>;

  // Blocks are left out (withBlocks: false) when WordPress fails to return them.
  const homeQuery = /* GraphQL */ `
    query HomePage($withBlocks: Boolean = true) {
      generalSettings {
        title
        description
      }
      nodeByUri(uri: "/") {
        __typename
        ... on Page {
          id
          databaseId
          getquickBlocksJson @include(if: $withBlocks)
          title
          content
          blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
            @include(if: $withBlocks)
          isFrontPage${formsField}${extensionFields("page")}
        }
      }
      designTokens {
        theme
        spacingSizes {
          slug
          size
        }
        colors {
          slug
          color
        }
      }
    }
  `;

  // Another language's front page (/en/), with its translated title and tagline.
  const languageHomeQuery = /* GraphQL */ `
    query HomePage($uri: String!, $language: LanguageCodeEnum!, $withBlocks: Boolean = true) {
      language(code: $language) {
        title
        description
      }
      nodeByUri(uri: $uri) {
        __typename
        ... on Page {
          id
          databaseId
          getquickBlocksJson @include(if: $withBlocks)
          title
          content
          blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
            @include(if: $withBlocks)
          isFrontPage${formsField}${extensionFields("page")}
        }
      }
      designTokens {
        theme
        spacingSizes {
          slug
          size
        }
        colors {
          slug
          color
        }
      }
    }
  `;

  // WPGraphQL only exposes menus assigned to a theme location to anonymous callers.
  // `inLanguage`: the menu at the location in a language (GQ Polylang for
  // WPGraphQL); without, the default language's. The header and footer are the
  // patterns GQ Design's Header & Footer selects for the design route
  // `$template`; `designPattern` takes no language, so every language is
  // served the same selection. `withPatterns: false` is the read for a GQ
  // Design older than `designPattern` (see `chromeData`).
  function siteChromeQueryText(inLanguage: boolean, withPatterns = true) {
    const variables = [
      "$location: MenuLocationEnum!",
      ...(withPatterns ? ["$template: String!"] : []),
      ...(inLanguage ? ["$language: LanguageCodeEnum!"] : []),
    ].join(", ");
    return /* GraphQL */ `
  query SiteChrome(${variables}) {
    generalSettings {
      siteIcon {
        node {
          sourceUrl
          altText
        }
      }
      siteLogo {
        node {
          sourceUrl
          altText
        }
      }
    }
    menuItems(where: { location: $location${inLanguage ? ", language: $language" : ""} }, first: 100) {
      nodes {
        id
        parentId
        label
        url
        target
      }
    }
    ${
      withPatterns
        ? `header: designPattern(template: $template, slot: "header") {
      title
      blocksJson
    }
    footer: designPattern(template: $template, slot: "footer") {
      title
      blocksJson
    }`
        : ""
    }
  }
`;
  }
  const siteChromeQuery = siteChromeQueryText(false);
  const languageChromeQuery = siteChromeQueryText(true);

  // Blocks are left out (withBlocks: false) when WordPress fails to return them.
  // On a multilingual Site (`translated`), each entry comes with its language
  // and translations (GQ Polylang for WPGraphQL).
  function entryQueryText(translated: boolean) {
    const languageFields = translated
      ? `
      language {
        slug
      }
      translations {
        uri
        language {
          slug
        }
      }`
      : "";
    return /* GraphQL */ `
  query EntryByUri($uri: String!, $withBlocks: Boolean = true) {
    designTokens {
        theme
      colors {
        slug
        color
      }
      spacingSizes {
        slug
        size
      }
    }
    postBy(uri: $uri) {
      id
      databaseId
      getquickBlocksJson @include(if: $withBlocks)
      title
      excerpt
      content
      blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
        @include(if: $withBlocks)
      uri${languageFields}
      date
      status
      isRestricted
      modifiedGmt
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }${formsField}${extensionFields("post")}
    }
    pageBy(uri: $uri) {
      id
      databaseId
      getquickBlocksJson @include(if: $withBlocks)
      title
      content
      blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
        @include(if: $withBlocks)
      uri${languageFields}
      status
      isRestricted
      modifiedGmt
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }${formsField}${extensionFields("page")}
    }
  }
`;
  }
  const entryQuery = entryQueryText(false);
  const translatedEntryQuery = entryQueryText(true);

  // On a Site with collections: the node at the URI, a page, a post or an
  // item of a collection. What any of them may have is asked of the
  // interfaces that have it, so a type that lacks it isn't an error; what is
  // a type's own (the Site's extension fields, an item's terms, a
  // multilingual Site's language and translations) of that type.
  function nodeQueryText(translated: boolean) {
    const languageFields = translated
      ? `
      language {
        slug
      }
      translations {
        uri
        language {
          slug
        }
      }`
      : "";
    const typeFields = (typename: string, fields: string) =>
      fields.trim() ? `\n      ... on ${typename} {${fields}\n      }` : "";
    const itemFields = collections
      .map(([name, collection]) =>
        typeFields(
          collection.graphqlType,
          `${
            collection.taxonomies?.length
              ? `
        terms(first: 100) {
          nodes {
            slug
            name
            taxonomyName
          }
        }`
              : ""
          }${languageFields}${extensionFields("item", name)}`,
        ),
      )
      .join("");
    return /* GraphQL */ `
  query EntryByUri($uri: String!, $withBlocks: Boolean = true) {
    designTokens {
        theme
      colors {
        slug
        color
      }
      spacingSizes {
        slug
        size
      }
    }
    node: nodeByUri(uri: $uri) {
      __typename
      ... on ContentNode {
        id
        uri
        date
        status
        isRestricted
        modifiedGmt
        blocks(attributes: true, htmlContent: true, dynamicContent: true, postTemplate: false)
          @include(if: $withBlocks)${formsField}
      }
      ... on NodeWithTitle {
        title
      }
      ... on NodeWithContentEditor {
        content
      }
      ... on NodeWithExcerpt {
        excerpt
      }
      ... on NodeWithFeaturedImage {
        featuredImage {
          node {
            sourceUrl
            altText
          }
        }
      }${typeFields(
        "Post",
        `
        databaseId
        getquickBlocksJson @include(if: $withBlocks)${languageFields}${extensionFields("post")}`,
      )}${typeFields(
        "Page",
        `
        databaseId
        getquickBlocksJson @include(if: $withBlocks)${languageFields}${extensionFields("page")}`,
      )}${itemFields}
    }
  }
`;
  }
  const nodeQuery = nodeQueryText(false);
  const translatedNodeQuery = nodeQueryText(true);

  // The design presets alone, for a change to them that reaches every page.
  const designQuery = /* GraphQL */ `
    query DesignPresets {
      designTokens {
        theme
        spacingSizes {
          slug
          size
        }
        colors {
          slug
          color
        }
      }
    }
  `;

  // Anonymous readers only get what is published: no drafts, private entries or
  // revisions. The id and the modification time let reconciliation tell which
  // entries changed without reading each one. On a multilingual Site
  // (`everyLanguage`), the entries of every language (GQ Polylang for WPGraphQL).
  /** WPGraphQL's ContentTypeEnum: pages, posts and each collection's post type. */
  const contentTypes = [
    "PAGE",
    "POST",
    ...collections.map(([, { postType }]) => {
      const name = postType.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
      return /^[A-Z_]/.test(name) ? name : `_${name}`;
    }),
  ];
  function publishedRoutesQueryText(everyLanguage: boolean) {
    return /* GraphQL */ `
  query PublishedRoutes($after: String) {
    contentNodes(first: 100, after: $after, where: { contentTypes: [${contentTypes.join(", ")}]${everyLanguage ? ", language: ALL" : ""} }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        uri
        id
        modifiedGmt
      }
    }
  }
`;
  }
  const publishedRoutesQuery = publishedRoutesQueryText(multilingual);

  function normalizeImage(edge: z.infer<typeof imageEdge>): WordPressImage | null {
    const node = edge?.node;
    return node ? { sourceUrl: node.sourceUrl, altText: node.altText ?? "" } : null;
  }

  function normalizePost(post: RawEntry): WordPressPost {
    return {
      id: post.id,
      ...(post.databaseId !== undefined ? { databaseId: post.databaseId } : {}),
      ...(post.getquickBlocksJson !== undefined ? { designBlocks: post.getquickBlocksJson } : {}),
      ...(config.forms && post.getquickForms !== undefined ? { forms: post.getquickForms } : {}),
      title: post.title ?? "",
      excerpt: post.excerpt ?? "",
      content: post.content ?? "",
      uri: uriPath(post.uri),
      date: post.date ?? "",
      featuredImage: normalizeImage(post.featuredImage),
      hasVideoHero: hasVideoHero(parseWordPressBlocks(post.blocks)),
    };
  }

  /** A read WordPress didn't complete; becomes an Unavailable delivery. */
  class CmsFailureError extends Error {
    constructor(
      readonly failure: CmsFailure,
      options?: { cause?: unknown },
      readonly graphqlErrors?: string[],
    ) {
      super(failure.message, options);
    }
  }

  function describeIssues(error: z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`)
      .join("; ");
  }

  /**
   * `{ extension }` with the Site's value for a node WordPress returned, or
   * nothing: without an extension, fields for its kind, or a value, and when
   * the blocks (and with them the fields) were left out.
   */
  function extended(
    kind: ExtensionNode["kind"],
    node: Record<string, unknown>,
    blocksOmitted: boolean,
    collection?: string,
  ): { extension?: X } {
    if (!extension || !extensionSelection(kind, collection) || blocksOmitted) return {};
    let value: X | undefined;
    try {
      value = extension.read(
        collection === undefined ? { kind, fields: node } : { kind, collection, fields: node },
      );
    } catch (error) {
      throw new CmsFailureError(
        {
          reason: "schema",
          message: `WordPress's ${collection === undefined ? kind : `${collection} item`} doesn't match the Site's extension: ${error instanceof Error ? error.message : String(error)}`,
        },
        { cause: error },
      );
    }
    return value === undefined ? {} : { extension: value };
  }

  async function query<S extends z.ZodType>(
    schema: S,
    queryText: string,
    variables?: Record<string, string | boolean | null>,
  ): Promise<z.infer<S>> {
    let response: Response;
    let credentials: string[] = [];
    const safeMessage = (message: string) =>
      credentials.reduce((text, value) => text.replaceAll(value, "[redacted]"), message);
    try {
      if (!config.isServer()) throw new Error("CMS reads are server-only");
      const url = new URL(config.graphqlEndpoint);
      const bindings = await config.bindings();
      const id = bindings.GQ_AUTH_GRAPHQL_CLIENT_ID?.trim();
      const secret = bindings.GQ_AUTH_GRAPHQL_CLIENT_SECRET?.trim();
      credentials = [id, secret].filter((value): value is string => Boolean(value));
      if (Boolean(id) !== Boolean(secret)) {
        throw new CmsFailureError({
          reason: "network",
          message:
            "GQ_AUTH_GRAPHQL_CLIENT_ID and GQ_AUTH_GRAPHQL_CLIENT_SECRET must be set together",
        });
      }
      if (
        id &&
        secret &&
        (url.origin !== new URL(config.cmsOrigin).origin ||
          !["/graphql", "/wp/graphql"].includes(url.pathname) ||
          url.protocol !== "https:" ||
          url.username ||
          url.password)
      ) {
        throw new CmsFailureError({
          reason: "network",
          message:
            "Cloudflare Access credentials require the configured CMS HTTPS GraphQL endpoint",
        });
      }
      // This is the only destination: the configured CMS endpoint, never an
      // asset or a link returned by WordPress. Redirects must not forward it.
      response = await (config.fetch ?? globalThis.fetch)(url.href, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(id && secret ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {}),
        },
        redirect: "manual",
        body: JSON.stringify({ query: queryText, variables }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (error instanceof CmsFailureError) throw error;
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      // A transport/invalid-header error may contain credential values. Neither
      // the public Unavailable delivery nor its log retains that raw error.
      throw new CmsFailureError(
        timedOut
          ? { reason: "timeout", message: "WordPress didn't answer within 8 seconds" }
          : { reason: "network", message: "WordPress couldn't be reached" },
      );
    }

    if (!response.ok) {
      throw new CmsFailureError({
        reason: "http",
        httpStatus: response.status,
        message: `WordPress responded with HTTP ${response.status}`,
      });
    }

    let rawResult: unknown;
    try {
      rawResult = await response.json();
    } catch (error) {
      throw new CmsFailureError(
        { reason: "schema", message: "WordPress answered with something other than JSON" },
        { cause: error },
      );
    }

    const envelope = z
      .object({
        data: z.unknown().optional(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
      .safeParse(rawResult);
    if (!envelope.success) {
      throw new CmsFailureError({
        reason: "schema",
        message: "WordPress's answer doesn't match the required GraphQL envelope",
      });
    }
    const result = envelope.data;

    // Any GraphQL error fails the read, even next to partial data: a field it
    // nulled out isn't evidence that the content is gone.
    if (result?.errors?.length) {
      throw new CmsFailureError(
        {
          reason: "graphql",
          message: safeMessage(result.errors.map((error) => error.message).join(", ")),
        },
        undefined,
        result.errors.map((error) => error.message),
      );
    }

    const parsed = schema.safeParse(result?.data);
    if (!parsed.success) {
      throw new CmsFailureError({
        reason: "schema",
        message: safeMessage(
          `WordPress's answer doesn't match the required schema: ${describeIssues(parsed.error)}`,
        ),
      });
    }
    return parsed.data;
  }

  function isServerError(error: unknown) {
    return (
      error instanceof CmsFailureError &&
      error.failure.reason === "http" &&
      (error.failure.httpStatus ?? 0) >= 500
    );
  }

  const OPTIONAL_FIELD_ERROR =
    /^Cannot query field "(getquickBlocksJson|getquickForms)" on type "(?:Post|Page|ContentNode)"\.(?: Did you mean [^\n]+)?$/;

  /**
   * The CMS can fail on one page's blocks (a 502 for a block's attributes) while
   * the rest of it is fine: read it again without them rather than fail it. Only
   * Video Hero pages need blocks. A timeout isn't retried, and a retry that fails
   * too is a failure, never absence.
   */
  async function queryWithBlockRecovery<S extends z.ZodType>(
    schema: S,
    queryText: string,
    variables: Record<string, string | boolean> = {},
  ): Promise<{ data: z.infer<S>; blocksOmitted: boolean }> {
    // Retain the compatible document if the subsequent read needs HTTP recovery.
    const read = async (readVariables: Record<string, string | boolean>): Promise<z.infer<S>> => {
      try {
        return await query(schema, queryText, readVariables);
      } catch (error) {
        if (
          !(error instanceof CmsFailureError) ||
          error.failure.reason !== "graphql" ||
          !error.graphqlErrors?.length ||
          !error.graphqlErrors.every((message) => OPTIONAL_FIELD_ERROR.test(message))
        )
          throw error;
        // A CMS without GQ Design's canonical blocks, or without Gravity Forms
        // (gq-content's forms module is dormant then): read without them.
        for (const message of error.graphqlErrors) {
          const field = OPTIONAL_FIELD_ERROR.exec(message)![1]!;
          queryText = queryText.replaceAll(`${field} @include(if: $withBlocks)`, "");
        }
        return query(schema, queryText, readVariables);
      }
    };
    try {
      return { data: await read(variables), blocksOmitted: false };
    } catch (error) {
      if (!isServerError(error)) throw error;
      try {
        const data = await read({ ...variables, withBlocks: false });
        return { data, blocksOmitted: true };
      } catch (retryError) {
        if (!(retryError instanceof CmsFailureError)) throw retryError;
        const first = (error as CmsFailureError).failure;
        throw new CmsFailureError(
          {
            ...retryError.failure,
            message: `${first.message}; without blocks: ${retryError.failure.message}`,
          },
          { cause: retryError },
        );
      }
    }
  }

  /** Turns a CMS failure into an Unavailable delivery, and logs why. Other errors are bugs. */
  async function deliver<R>(subject: string, read: () => Promise<R>): Promise<R | Unavailable> {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof CmsFailureError)) throw error;
      console.error(
        `WordPress: ${subject} is unavailable (${error.failure.reason}): ${error.message}`,
      );
      return { kind: "unavailable", failure: error.failure };
    }
  }

  /**
   * The page WordPress marks as a language's front page, with the site's title
   * and tagline in that language. Missing when no page is.
   */
  async function getHomeContent(
    language: SiteLanguage = defaultLanguage,
  ): Promise<Delivery<HomeContent<X>>> {
    return deliver(
      languageSubject(language, "front page"),
      async (): Promise<Found<HomeContent<X>> | Missing> => {
        const { data, blocksOmitted } = language.isDefault
          ? await queryWithBlockRecovery(homeData, homeQuery)
          : await queryWithBlockRecovery(languageHomeData, languageHomeQuery, {
              uri: language.home,
              language: language.code,
            }).then(({ data, blocksOmitted }) => ({
              data: { ...data, generalSettings: data.language },
              blocksOmitted,
            }));
        const node = data.nodeByUri;
        if (!node || !("isFrontPage" in node) || !node.isFrontPage) return { kind: "missing" };

        const blocks = parseWordPressBlocks(node.blocks);
        const containsVideoHero = hasVideoHero(blocks);
        return {
          kind: "found",
          content: {
            nodeId: node.id ?? null,
            settings: {
              title: data.generalSettings.title ?? "",
              description: data.generalSettings.description ?? "",
            },
            page: {
              ...(node.databaseId !== undefined ? { databaseId: node.databaseId } : {}),
              ...(node.getquickBlocksJson !== undefined
                ? { designBlocks: node.getquickBlocksJson }
                : {}),
              ...(config.forms && node.getquickForms !== undefined
                ? { forms: node.getquickForms }
                : {}),
              title: node.title ?? "",
              content:
                containsVideoHero || hasDesignCarousel(blocks)
                  ? renderWordPressBlocks(blocks)
                  : (node.content ?? ""),
              hasVideoHero: containsVideoHero,
              ...extended("page", node, blocksOmitted),
            },
            blocksOmitted,
            spacingSizes: data.designTokens.spacingSizes,
            colors: data.designTokens.colors,
            ...(data.designTokens.theme ? { theme: data.designTokens.theme } : {}),
          },
        };
      },
    );
  }

  /**
   * The published post or page at a URI. Missing when WordPress has neither, or
   * only one that isn't public (password-protected): the Frontend serves only
   * what any visitor may read.
   */
  async function getEntryByUri(uri: string): Promise<Delivery<EntryContent<X>>> {
    if (collections.length > 0) return getNodeByUri(uri);
    return deliver(`the entry ${uri}`, async (): Promise<Found<EntryContent<X>> | Missing> => {
      const { data, blocksOmitted } = multilingual
        ? await queryWithBlockRecovery(translatedEntryData, translatedEntryQuery, { uri })
        : await queryWithBlockRecovery(entryData, entryQuery, { uri });
      const post: RawEntry | null = data.postBy ?? data.pageBy;
      if (!post || post.isRestricted || post.status !== "publish") return { kind: "missing" };

      const normalized = normalizePost(post);
      const blocks = parseWordPressBlocks(post.blocks);
      const containsVideoHero = hasVideoHero(blocks);
      return {
        kind: "found",
        content: {
          ...normalized,
          content:
            containsVideoHero || hasDesignCarousel(blocks)
              ? renderWordPressBlocks(blocks)
              : normalized.content,
          hasVideoHero: containsVideoHero,
          blocksOmitted,
          modifiedAt: cmsTime(post.modifiedGmt),
          spacingSizes: data.designTokens.spacingSizes,
          colors: data.designTokens.colors,
          ...(data.designTokens.theme ? { theme: data.designTokens.theme } : {}),
          ...(multilingual ? languageOf(post) : {}),
          ...extended(data.postBy ? "post" : "page", post, blocksOmitted),
        },
      };
    });
  }

  /**
   * On a Site with collections, the published page, post or collection item
   * at a URI. Missing when the node there is none of them (an archive, a
   * term, an item of a type the Site doesn't store), or isn't public.
   */
  async function getNodeByUri(uri: string): Promise<Delivery<EntryContent<X>>> {
    return deliver(`the entry ${uri}`, async (): Promise<Found<EntryContent<X>> | Missing> => {
      const { data, blocksOmitted } = await queryWithBlockRecovery(
        nodeEntryData,
        multilingual ? translatedNodeQuery : nodeQuery,
        { uri },
      );
      const node = data.node;
      if (!node || !("id" in node)) return { kind: "missing" };
      const item = collectionOf(node.__typename);
      const kind = node.__typename === "Page" ? "page" : node.__typename === "Post" ? "post" : null;
      if (!item && !kind) return { kind: "missing" };
      if (!node.uri || node.isRestricted || node.status !== "publish") return { kind: "missing" };

      const entry: RawEntry = {
        ...node,
        uri: node.uri,
        title: node.title ?? null,
        content: node.content ?? null,
        excerpt: node.excerpt ?? null,
        date: node.date ?? null,
        featuredImage: node.featuredImage ?? null,
      };
      const normalized = normalizePost(entry);
      const blocks = parseWordPressBlocks(node.blocks);
      const containsVideoHero = hasVideoHero(blocks);
      return {
        kind: "found",
        content: {
          ...normalized,
          content:
            containsVideoHero || hasDesignCarousel(blocks)
              ? renderWordPressBlocks(blocks)
              : normalized.content,
          hasVideoHero: containsVideoHero,
          blocksOmitted,
          modifiedAt: cmsTime(node.modifiedGmt),
          spacingSizes: data.designTokens.spacingSizes,
          colors: data.designTokens.colors,
          ...(data.designTokens.theme ? { theme: data.designTokens.theme } : {}),
          ...(multilingual ? languageOf(entry) : {}),
          ...(item
            ? {
                collection: {
                  name: item[0],
                  terms: termsOf(item[1].taxonomies ?? [], node.terms?.nodes ?? []),
                },
              }
            : {}),
          ...(item
            ? extended("item", node, blocksOmitted, item[0])
            : extended(kind!, node, blocksOmitted)),
        },
      };
    });
  }

  /** An item's terms in each of its collection's taxonomies (every one, if it has none). */
  function termsOf(
    taxonomies: readonly string[],
    nodes: Array<z.infer<typeof termNode>>,
  ): Record<string, Array<{ slug: string; name: string }>> {
    return Object.fromEntries(
      taxonomies.map((taxonomy) => [
        taxonomy,
        nodes
          .filter((term) => term.taxonomyName === taxonomy)
          .map((term) => ({ slug: term.slug, name: term.name ?? term.slug })),
      ]),
    );
  }

  /** An entry's language and published translations, as a multilingual Site stores them. */
  function languageOf(post: RawEntry): Pick<EntryContent, "language" | "translations"> {
    return {
      ...(post.language ? { language: post.language.slug } : {}),
      translations: (post.translations ?? []).flatMap((translation) =>
        translation.uri && translation.language
          ? [{ uri: uriPath(translation.uri), language: translation.language.slug }]
          : [],
      ),
    };
  }

  /** The design presets every page shares (GQ Design's spacing sizes and colors). */
  async function getDesignPresets(): Promise<Found<DesignPresets> | Unavailable> {
    return deliver("the design presets", async (): Promise<Found<DesignPresets>> => {
      const { designTokens } = await query(designData, designQuery);
      return {
        kind: "found",
        content: {
          spacingSizes: designTokens.spacingSizes,
          colors: designTokens.colors,
          ...(designTokens.theme ? { theme: designTokens.theme } : {}),
        },
      };
    });
  }

  /**
   * Every published page and post (its id, URI and last modification), read
   * page by page, and how many requests that took. Any failed page fails the
   * list: an incomplete list says nothing about what isn't in it.
   */
  async function getPublishedEntries(): Promise<
    Found<{ entries: PublishedEntry[]; requests: number }> | Unavailable
  > {
    return deliver("the published routes", async () => {
      const entries: PublishedEntry[] = [];
      let after: string | null = null;
      for (let page = 0; page < 1000; page += 1) {
        const { contentNodes }: z.infer<typeof publishedRoutesData> = await query(
          publishedRoutesData,
          publishedRoutesQuery,
          { after },
        );
        for (const node of contentNodes.nodes) {
          if (!node.uri) continue;
          entries.push({
            id: node.id ?? null,
            uri: uriPath(node.uri),
            modifiedAt: cmsTime(node.modifiedGmt),
          });
        }
        if (!contentNodes.pageInfo.hasNextPage) {
          return { kind: "found" as const, content: { entries, requests: page + 1 } };
        }
        if (!contentNodes.pageInfo.endCursor) {
          throw new CmsFailureError({
            reason: "schema",
            message: "WordPress said there are more published routes without a cursor to them",
          });
        }
        after = contentNodes.pageInfo.endCursor;
      }
      throw new CmsFailureError({
        reason: "schema",
        message: "WordPress listed more than 100,000 published routes",
      });
    });
  }

  // GETQUICK Content's Archives (cms/modules/archives.php): where each public
  // post type's archive is, the Page assigned to it or its own. With them,
  // the post types and taxonomies WPGraphQL shows, each type's GraphQL name
  // and the taxonomies connected to it, so a collection declared with a type
  // or taxonomy it doesn't show, or a GraphQL type or taxonomy that isn't
  // that post type's, fails here, by name, rather than failing every entry
  // read (one query on a Site with collections) or storing items without
  // their terms.
  const names = z.object({ nodes: z.array(z.object({ name: z.string() })) }).nullable();
  const archivesData = z.object({
    getquickArchives: z
      .array(z.object({ postType: z.string(), uri: z.string().nullable() }))
      .nullable()
      .optional(),
    contentTypes: z
      .object({
        nodes: z.array(
          z.object({
            name: z.string(),
            graphqlSingleName: z.string().nullable().optional(),
            connectedTaxonomies: names.optional(),
          }),
        ),
      })
      .nullable(),
    taxonomies: names,
  });
  const archivesQueryText = (archives: boolean) => /* GraphQL */ `
    query ContentArchives {${
      archives
        ? `
      getquickArchives {
        postType
        uri
      }`
        : ""
    }
      contentTypes(first: 100) {
        nodes {
          name
          graphqlSingleName
          connectedTaxonomies(first: 100) {
            nodes {
              name
            }
          }
        }
      }
      taxonomies(first: 100) {
        nodes {
          name
        }
      }
    }
  `;

  /**
   * Where each collection's archive is, by post type: the Page assigned to it
   * in GETQUICK → Archives, else the type's own archive. A CMS whose GETQUICK
   * Content doesn't have Archives yet gives none. A collection whose post
   * type or taxonomy WPGraphQL doesn't show fails the read (`schema`).
   */
  async function getArchives(): Promise<Found<Types.Archives> | Unavailable> {
    return deliver("the archives", async (): Promise<Found<Types.Archives>> => {
      let data: z.infer<typeof archivesData>;
      try {
        data = await query(archivesData, archivesQueryText(true));
      } catch (error) {
        if (
          !(error instanceof CmsFailureError) ||
          error.failure.reason !== "graphql" ||
          !/Cannot query field "getquickArchives"/.test(error.failure.message)
        )
          throw error;
        console.warn(
          `WordPress: GETQUICK Content provides no archives (${error.failure.message}); collections have none`,
        );
        data = await query(archivesData, archivesQueryText(false));
      }
      const shown = (list: z.infer<typeof names> | undefined) =>
        new Set((list?.nodes ?? []).map(({ name }) => name));
      const postTypes = new Map((data.contentTypes?.nodes ?? []).map((type) => [type.name, type]));
      const taxonomies = shown(data.taxonomies);
      const hidden = collections.flatMap(([name, collection]) => [
        ...(postTypes.has(collection.postType)
          ? []
          : [`${name}'s post type ${collection.postType}`]),
        ...(collection.taxonomies ?? [])
          .filter((taxonomy) => !taxonomies.has(taxonomy))
          .map((taxonomy) => `${name}'s taxonomy ${taxonomy}`),
      ]);
      if (hidden.length > 0) {
        throw new CmsFailureError({
          reason: "schema",
          message: `WPGraphQL doesn't show ${hidden.join(", ")} (show_in_graphql)`,
        });
      }
      const mismatched = collections.flatMap(([name, collection]) => {
        const type = postTypes.get(collection.postType)!;
        const typeName = type.graphqlSingleName ? graphqlTypeName(type.graphqlSingleName) : null;
        const connected = shown(type.connectedTaxonomies);
        return [
          ...(typeName === null || typeName === collection.graphqlType
            ? []
            : [
                `${name}'s graphqlType ${collection.graphqlType} isn't post type ${collection.postType}'s GraphQL type, ${typeName}`,
              ]),
          ...(type.connectedTaxonomies === undefined
            ? []
            : (collection.taxonomies ?? [])
                .filter((taxonomy) => !connected.has(taxonomy))
                .map(
                  (taxonomy) =>
                    `${name}'s taxonomy ${taxonomy} isn't connected to post type ${collection.postType}`,
                )),
        ];
      });
      if (mismatched.length > 0) {
        throw new CmsFailureError({ reason: "schema", message: mismatched.join("; ") });
      }
      const stored = new Set(collections.map(([, { postType }]) => postType));
      return {
        kind: "found",
        content: Object.fromEntries(
          (data.getquickArchives ?? []).flatMap(({ postType, uri }) =>
            uri && stored.has(postType) ? [[postType, uriPath(uri)]] : [],
          ),
        ),
      };
    });
  }

  /**
   * The GraphQL type WPGraphQL names after a post type's graphql_single_name
   * (WPGraphQL's Utils::format_type_name): each word, split at `_`, `-` or a
   * space, capitalised and joined.
   */
  function graphqlTypeName(singleName: string) {
    const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    return singleName
      .replace(/[^a-zA-Z0-9 -]/g, "_")
      .split(/[_ -]/)
      .map(capital)
      .join("");
  }

  /** The URI of every published page and post. */
  async function getPublishedRoutes(): Promise<Found<string[]> | Unavailable> {
    const listed = await getPublishedEntries();
    if (listed.kind !== "found") return listed;
    return { kind: "found", content: listed.content.entries.map((entry) => entry.uri) };
  }

  /**
   * Links into this site (the WordPress origin, or the frontend origin WordPress
   * uses as its home URL) become frontend paths; other origins stay absolute.
   */

  function buildMenuTree(items: RawMenuItem[], internalOrigins: string[]) {
    const byId = new Map<string, WordPressMenuItem>();
    for (const item of items) {
      byId.set(item.id, {
        id: item.id,
        label: item.label ?? "",
        href: item.url ? menuItemHref(item.url, internalOrigins) : "#",
        target: item.target || null,
        children: [],
      });
    }

    const roots: WordPressMenuItem[] = [];
    for (const item of items) {
      const node = byId.get(item.id)!;
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }

  /**
   * gq-config's consent settings in a language. A gq-config without them (its
   * schema has no such field) provides none: the chrome is still read, with no
   * Legal Contract and GA4 off. Any other failure fails the chrome read, so
   * the stored chrome, legal links included, stays served.
   */
  async function consentSettings(
    language: SiteLanguage,
  ): Promise<z.infer<typeof consentSettingsData>> {
    try {
      return await query(consentSettingsData, consentSettingsQuery, {
        language: multilingual ? language.slug : null,
      });
    } catch (error) {
      if (
        error instanceof CmsFailureError &&
        error.failure.reason === "graphql" &&
        /Cannot query field "(?:getquickLegal|googleAnalytics)"/.test(error.failure.message)
      ) {
        console.warn(
          `WordPress: gq-config provides no consent settings (${error.failure.message}); the chrome has no Legal Contract and GA4 is off`,
        );
        return { getquickLegal: null, googleAnalytics: null };
      }
      throw error;
    }
  }

  /**
   * The chrome's data in a language. A CMS whose GQ Design predates
   * `designPattern` (before 0.2.17) has no header or footer patterns to
   * select: its schema rejects the field, and the chrome is read again without
   * them, with both null (the Site's own header and footer), as when nothing
   * is selected. The warning names the cause and the version the default
   * `page` route needs; menus, logos and icons keep refreshing, and new Sites
   * and languages are served. Any other failure fails the read, so what is
   * stored is kept.
   */
  async function chromeData(
    language: SiteLanguage,
    location: string,
  ): Promise<z.infer<typeof siteChromeData>> {
    const template = config.designTemplate ?? "page";
    const variables: Record<string, string> = language.isDefault
      ? { location }
      : { location, language: language.code };
    try {
      return await query(
        siteChromeData,
        language.isDefault ? siteChromeQuery : languageChromeQuery,
        { ...variables, template },
      );
    } catch (error) {
      if (
        !(error instanceof CmsFailureError) ||
        error.failure.reason !== "graphql" ||
        !/Cannot query field "designPattern"/.test(error.failure.message)
      ) {
        throw error;
      }
      console.warn(
        `WordPress: GQ Design has no designPattern field (${error.failure.message}); header and footer patterns need GQ Design ${DESIGN_PATTERN_VERSION} or newer, so the chrome is read without them and the Site's own header and footer are served`,
      );
      const data = await query(
        chromeWithoutPatternsData,
        siteChromeQueryText(!language.isDefault, false),
        variables,
      );
      return { ...data, header: null, footer: null };
    }
  }

  /**
   * A selected pattern's block tree. GQ Design answers a selected pattern it
   * couldn't resolve (invalid attributes, a cycle, too many blocks) with an
   * empty tree, not an error; that is a failed read, so the stored chrome is
   * kept rather than replaced by an empty region.
   */
  function designPatternOf(
    region: "header" | "footer",
    pattern: z.infer<typeof designPattern>,
  ): DesignPattern | null {
    if (!pattern) return null;
    const blocks = parseDesignBlocks(pattern.blocksJson);
    if (!blocks) {
      throw new CmsFailureError({
        reason: "schema",
        message: `The ${region} pattern's blocksJson isn't a JSON list of blocks`,
      });
    }
    if (blocks.length === 0) {
      throw new CmsFailureError({
        reason: "schema",
        message: `The ${region} pattern "${pattern.title}" has no blocks GQ Design could resolve`,
      });
    }
    return { title: pattern.title, blocks };
  }

  /**
   * The menu, logo, icon, header and footer every page in a language shares:
   * the logo and icon are the site's, the menu the one at the location in that
   * language, the header and footer the patterns selected for the configured
   * design route. A site without them is found with an empty menu, no images
   * and no patterns; a failed read is Unavailable, not that.
   */
  async function getSiteChrome(
    siteOrigin?: string,
    {
      location = "PRIMARY",
      language = defaultLanguage,
    }: { location?: string; language?: SiteLanguage } = {},
  ): Promise<Found<SiteChrome> | Unavailable> {
    return deliver(
      languageSubject(language, "site chrome"),
      async (): Promise<Found<SiteChrome>> => {
        const [data, consent] = await Promise.all([
          chromeData(language, location),
          config.consent?.cmsSettings ? consentSettings(language) : null,
        ]);
        const origins = internalOrigins(config, siteOrigin);

        return {
          kind: "found",
          content: {
            menuItems: buildMenuTree(data.menuItems.nodes, origins),
            siteIcon: normalizeImage(data.generalSettings.siteIcon),
            siteLogo: normalizeImage(data.generalSettings.siteLogo),
            header: designPatternOf("header", data.header),
            footer: designPatternOf("footer", data.footer),
            ...(consent
              ? {
                  legal: parseLegalLanguage(consent.getquickLegal),
                  analytics: consent.googleAnalytics ?? { enabled: false, measurementId: null },
                }
              : {}),
          },
        };
      },
    );
  }

  return {
    getHomeContent,
    getEntryByUri,
    getDesignPresets,
    getPublishedEntries,
    getPublishedRoutes,
    getArchives,
    getSiteChrome,
  };
}
