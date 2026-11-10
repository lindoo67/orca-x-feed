// X Feed worker.
//
// Reality this code is written against:
//   * fxtwitter resolves one tweet (`/{user}/status/{id}`) or one profile (`/{user}`).
//     There is no timeline, search or trends endpoint there, and free RSS/Nitter bridges
//     are dead, so this plugin looks things up instead of scrolling a feed.
//   * A panel frame has no network and a CSP of `img-src 'self' data:`, so every remote
//     image is fetched here and handed to the panel as a `data:` URL.

const DEFAULT_API_BASE = "https://api.fxtwitter.com"
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const UA = "orca-x-feed/0.2 (+https://github.com/lindoo67/orca-x-feed)"

export default function activate(orca) {
  // method names are flat and dotted; the first handler argument is the `input` object.
  orca.panels.handle("feed.lookup", async ({ query }) => lookup(orca, query))
  orca.panels.handle("feed.save", async ({ item }) => save(orca, item))
  orca.panels.handle("feed.unsave", async ({ id }) => unsave(orca, id))
  orca.panels.handle("feed.list", async () => listSaved(orca))
}

// ---------------------------------------------------------------- lookups

async function lookup(orca, query) {
  const raw = String(query ?? "").trim()
  if (!raw) return { kind: "error", message: "输入一条推文链接或 @用户名。" }

  const base = await apiBase(orca)
  const target = parseQuery(raw)
  if (!target) return { kind: "error", message: `看不懂这个输入：${raw}` }

  const endpoint =
    target.kind === "tweet"
      ? `${base}/${target.user ?? "i"}/status/${target.id}`
      : `${base}/${target.user}`

  const res = await fetch(endpoint, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  }).catch((error) => {
    return { networkError: error?.name === "TimeoutError" ? "请求超时" : String(error?.message ?? error) }
  })

  if (res?.networkError) return { kind: "error", message: `抓取失败：${res.networkError}` }
  if (!res.ok) {
    return { kind: "error", message: `X 没有返回内容（HTTP ${res.status}）。私有号、已删除的推文或限流都会这样。` }
  }

  const body = await res.json().catch(() => null)
  if (!body) return { kind: "error", message: "返回的不是 JSON，可能被上游挡住了。" }

  // fxtwitter nests under `tweet`, and a profile call under `user`.
  const tweet = body.tweet
  const user = body.user

  // Resolve each image on its own; index maths over a spread would shift the profile
  // avatar into a media slot when the response carries no tweet.
  const media = tweet ? await Promise.all(mediaUrls(tweet).map((u) => inlineImage(u))) : []
  const avatar = tweet
    ? await inlineImage(tweet.author?.avatar_url)
    : user
      ? await inlineImage(user.avatar_url)
      : null

  if (tweet) {
    return {
      kind: "tweet",
      tweet: {
        id: String(tweet.id ?? ""),
        url: tweet.url ?? `https://x.com/${tweet.author?.screen_name}/status/${tweet.id}`,
        text: tweet.text ?? "",
        createdTimestamp: tweet.created_timestamp ?? null,
        lang: tweet.lang ?? null,
        stats: {
          replies: tweet.replies ?? 0,
          retweets: tweet.retweets ?? 0,
          likes: tweet.likes ?? 0,
          views: tweet.views ?? null,
        },
        replyingTo: tweet.replying_to ?? null,
        communityNote: tweet.community_note ?? null,
        author: shapeAuthor(tweet.author, avatar),
        media: media.filter(Boolean),
        quote: tweet.quote ? { text: tweet.quote.text ?? "", author: shapeAuthor(tweet.quote.author, null) } : null,
      },
    }
  }

  if (user) {
    return {
      kind: "profile",
      profile: {
        name: user.name ?? user.screen_name,
        handle: `@${user.screen_name}`,
        url: user.url ?? `https://x.com/${user.screen_name}`,
        description: user.description ?? "",
        location: user.location ?? "",
        website: user.website?.url ?? (typeof user.website === "string" ? user.website : null),
        joined: user.joined ?? "",
        followers: user.followers ?? 0,
        following: user.following ?? 0,
        tweets: user.tweets ?? 0,
        avatar,
        banner: null,
        verified: !!user.verification?.verified,
        protected: !!user.protected,
      },
    }
  }

  return { kind: "error", message: "返回了 JSON，但里面既没有 tweet 也没有 user。" }
}

function shapeAuthor(author, avatar) {
  if (!author) return null
  return {
    name: author.name ?? "",
    handle: `@${author.screen_name ?? ""}`,
    url: author.url ?? `https://x.com/${author.screen_name ?? ""}`,
    avatar,
    verified: !!author.verification?.verified,
    followers: author.followers ?? 0,
  }
}

function mediaUrls(tweet) {
  const all = tweet.media?.all ?? []
  return all.map((m) => m?.url).filter(Boolean).slice(0, 4)
}

// Accepts a bare id, an @handle, x.com/twitter.com URLs, and fxtwitter-style URLs.
function parseQuery(raw) {
  const idOnly = raw.match(/^\d{1,25}$/)
  if (idOnly) return { kind: "tweet", id: idOnly[0], user: null }

  const handle = raw.match(/^@?([A-Za-z0-9_]{1,15})$/)
  if (handle) return { kind: "profile", user: handle[1] }

  let url
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!/(^|\.)(x|twitter|fxtwitter|vxtwitter|fixupx)\.com$/.test(url.hostname)) return null

  const parts = url.pathname.split("/").filter(Boolean)
  const at = parts.lastIndexOf("status")
  if (at !== -1 && parts[at + 1] && /^\d+$/.test(parts[at + 1])) {
    return { kind: "tweet", id: parts[at + 1], user: parts[at - 1]?.replace(/^@/, "") ?? null }
  }
  const mention = parts[0]?.match(/^@?([A-Za-z0-9_]{1,15})$/)
  if (mention) return { kind: "profile", user: mention[1] }
  return null
}

// ---------------------------------------------------------------- saved list

async function save(orca, item) {
  if (!item?.id || !item?.url) return { ok: false, message: "缺少 id 或 url。" }
  const list = await readSaved(orca)
  if (list.some((row) => row.id === item.id)) return { ok: true, saved: await listSaved(orca) }

  const row = {
    id: String(item.id),
    url: String(item.url).slice(0, 2048),
    handle: String(item.handle ?? "").slice(0, 64),
    text: String(item.text ?? "").slice(0, 280),
    savedAt: new Date().toISOString(),
  }
  await orca.storage.set({ key: "saved", value: { items: [row, ...list].slice(0, 200) } })
  return { ok: true, saved: await listSaved(orca) }
}

async function unsave(orca, id) {
  const list = await readSaved(orca)
  const next = list.filter((row) => row.id !== String(id))
  await orca.storage.set({ key: "saved", value: { items: next } })
  return { ok: true, saved: await listSaved(orca) }
}

async function listSaved(orca) {
  return readSaved(orca)
}

// `orca.storage.get` hands back the value it was given, but a host-level `storage.get`
// wraps it in `{ value }`. Unwrap both so a shape change can never read as an empty list
// and quietly drop the saved set on the next write.
async function readSaved(orca) {
  let stored = await orca.storage.get("saved")
  if (stored && !Array.isArray(stored.items) && Array.isArray(stored.value?.items)) {
    stored = stored.value
  }
  return Array.isArray(stored?.items) ? stored.items : []
}

// ---------------------------------------------------------------- helpers

// Pull a remote image into a data: URL. Panels cannot load remote images (no network,
// CSP `img-src 'self' data:`), so this is the only way an avatar can appear.
async function inlineImage(url) {
  if (!url) return null
  try {
    const res = await fetch(String(url), {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const type = (res.headers.get("content-type") ?? "").split(";")[0]
    if (!/^image\//.test(type)) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null
    return `data:${type};base64,${buffer.toString("base64")}`
  } catch {
    return null
  }
}

// A setting the plugin owns, read in the worker rather than passed in from the panel,
// so a tampered panel cannot point this trusted worker at an arbitrary host.
async function apiBase(orca) {
  const configured = await orca.settings.get("apiBase")
  return typeof configured === "string" && configured.trim()
    ? configured.trim().replace(/\/+$/, "")
    : DEFAULT_API_BASE
}
