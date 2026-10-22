// Ticket 03 (#20): every published page and entry body passes through one
// delivery step. Without a configured transform it is the identity: stored and
// cold-looked-up bodies reach the Frontend byte for byte as published.
import { expect, test, vi } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";
import { openTestD1 } from "./support/sqlite-d1";

// Arbitrary WordPress HTML, including the markup later steps rewrite.
const html =
  '<figure class="wp-block-embed is-provider-youtube"><div class="wp-block-embed__wrapper">' +
  '<iframe title="Clip" width="500" height="281" src="https://www.youtube.com/embed/abcdefghijk?feature=oembed" allowfullscreen></iframe>' +
  '</div></figure>\n<p>Ação &amp; <em>texto</em></p><script src="https://ads.example/x.js"></script>  ';

async function seed(db: ReturnType<typeof openTestD1>, rows: Array<[string, unknown]>) {
  for (const [key, body] of rows) {
    await db
      .prepare(
        "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES (?, 'published', 1, ?, 1, 1)",
      )
      .bind(key, JSON.stringify(body))
      .run();
  }
}

const chrome = { menuItems: [], siteIcon: null, siteLogo: null };
const home = {
  settings: { title: "Acme", description: "" },
  page: { title: "Home", content: html, hasVideoHero: false },
  colors: [],
  spacingSizes: [],
};
const entry = {
  id: "e1",
  title: "About",
  excerpt: "",
  content: html,
  uri: "/about/",
  date: "",
  featuredImage: null,
  hasVideoHero: false,
  colors: [],
  spacingSizes: [],
};

test("without a transform, stored home and entry HTML is byte-identical", async () => {
  const db = openTestD1();
  try {
    await seed(db, [
      ["home", home],
      ["chrome", chrome],
      ["entry:/about/", entry],
    ]);
    const runtime = createContentRuntime({
      site: "Acme",
      graphqlEndpoint: "https://cms.test/graphql",
      cmsOrigin: "https://cms.test",
      isServer: () => true,
      bindings: () => ({ PUBLICATION_DB: db }),
      fetch: vi.fn(),
    });
    const servedHome = await runtime.publishedHome();
    const servedEntry = await runtime.publishedEntry("/about/");
    expect(servedHome.kind === "found" && servedHome.content.home.page.content).toBe(html);
    expect(servedEntry.kind === "found" && servedEntry.content.entry.content).toBe(html);
    // The store is untouched by delivery.
    const stored = await db.prepare("SELECT body FROM publications WHERE key = 'home'").first();
    expect(JSON.parse(String(stored?.body)).page.content).toBe(html);
  } finally {
    db.close();
  }
});
