// X Feed worker: fetches from vxtwitter/fxtwitter APIs and serves the panel.

export default function activate(orca) {
  // Panel protocol handlers
  orca.panels.handle("x-feed", {
    async fetchTrending(params) {
      const { apiBase, bearerToken } = await orca.settings.get(["apiBase", "bearerToken"])
      const isAuthed = !!(bearerToken?.trim())
      const base = (apiBase?.trim() || "https://api.vxtwitter.com").replace(/\/+$/, "")

      if (isAuthed) {
        // Authenticated endpoint: get trends
        const res = await orca.host.fetch(`${base}/i/api/2/trends.json`, {
          headers: { Authorization: `Bearer ${bearerToken.trim()}` }
        })
        const data = await res.json()
        return { tweets: (data.trends || []).map(t => ({
          id: t.name,
          title: t.name,
          description: t.tweet_volume ? `${t.tweet_volume} tweets` : "",
          link: `https://x.com/search?q=${encodeURIComponent(t.name.replace('#', ''))}`,
          isTrend: true
        }))}
      }

      // Use vxtwitter search with # hashtag as a proxy for trending
      const res = await orca.host.fetch(`${base}/search?q=lang%3Aen&tweet_mode=extended&result_type=recent`, {
        headers: { "X-Requested-With": "XMLHttpRequest" }
      })
      const text = await res.text()
      const tweets = parseScriptTag(text)
      return { tweets: tweets.slice(0, 30).map(formatTweet) }
    },

    async fetchSearch(params) {
      const { apiBase, bearerToken } = await orca.settings.get(["apiBase", "bearerToken"])
      const query = (params?.query || "").trim()
      if (!query) return { tweets: [] }

      const base = (apiBase?.trim() || "https://api.vxtwitter.com").replace(/\/+$/, "")
      const isAuthed = !!(bearerToken?.trim())

      const url = `${base}/search?q=${encodeURIComponent(query)}&tweet_mode=extended&result_type=recent`

      const headers = { "X-Requested-With": "XMLHttpRequest" }
      if (isAuthed) {
        headers.Authorization = `Bearer ${bearerToken.trim()}`
      }

      const res = await orca.host.fetch(url, { headers })
      if (!res.ok) return { tweets: [], error: `Request failed: ${res.status}` }

      const text = await res.text()
      const tweets = parseScriptTag(text)
      return { tweets: tweets.map(formatTweet) }
    },

    async fetchProfile(params) {
      const { apiBase, bearerToken } = await orca.settings.get(["apiBase", "bearerToken"])
      const username = (params?.username || "").trim().replace(/^@/, "")
      if (!username) return { tweets: [], error: "No username provided" }

      const base = (apiBase?.trim() || "https://api.vxtwitter.com").replace(/\/+$/, "")
      const isAuthed = !!(bearerToken?.trim())

      // vxtwitter / fxtwitter endpoint for user profile
      const url = `${base}/${username}`
      const res = await orca.host.fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest" } })

      if (!res.ok) return { tweets: [], error: `Profile not found (${res.status})` }

      const text = await res.text()
      const tweets = parseScriptTag(text)
      return {
        user: extractUserProfile(text, username),
        tweets: tweets.slice(0, 30).map(formatTweet)
      }
    },

    async fetchTweet(params) {
      const { apiBase, bearerToken } = await orca.settings.get(["apiBase", "bearerToken"])
      const id = (params?.id || "").trim()
      if (!id) return { tweet: null }

      const base = (apiBase?.trim() || "https://api.vxtwitter.com").replace(/\/+$/, "")
      const isAuthed = !!(bearerToken?.trim())

      const url = `${base}/${id}`
      const res = await orca.host.fetch(url, {
        headers: { "X-Requested-With": "XMLHttpRequest" }
      })

      if (!res.ok) return { tweet: null }

      const text = await res.text()
      const tweets = parseScriptTag(text)
      return { tweet: tweets.length ? formatTweet(tweets[0]) : null }
    }
  })
}

/**
 * Parse the __PRERENDERED_STATE__ script tag from vxtwitter/fxtwitter responses.
 */
function parseScriptTag(html) {
  const match = html.match(/<script id="__PRERENDERER_STATE"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return []

  try {
    const state = JSON.parse(match[1])
    // Navigate to the results
    const results = navigateTo(state, "results") || []
    return results
  } catch {
    return []
  }
}

/**
 * Navigate a nested JSON object to find a key.
 */
function navigateTo(obj, targetKey) {
  if (!obj || typeof obj !== "object") return null

  // Direct match
  if (obj[targetKey] !== undefined) return obj[targetKey]

  // Search one level deep
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (val && typeof val === "object") {
      // Check if it has the key directly
      if (val[targetKey] !== undefined) return val[targetKey]

      // Recurse into arrays
      if (Array.isArray(val)) {
        for (const item of val) {
          const found = navigateTo(item, targetKey)
          if (found) return found
        }
      }

      // Recurse into objects
      const found = navigateTo(val, targetKey)
      if (found) return found
    }
  }
  return null
}

/**
 * Extract user profile info from the HTML.
 */
function extractUserProfile(html, username) {
  // Try to extract from the __PRERENDERED_STATE__
  const match = html.match(/<script id="__PRERENDERER_STATE"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null

  try {
    const state = JSON.parse(match[1])
    const user = navigateTo(state, "user") || navigateTo(state, "profile")
    if (user) {
      return {
        name: user.name || user.screen_name || username,
        handle: `@${user.screen_name || user.rest_id || username}`,
        description: user.description || user.description_text || "",
        followers: user.followers_count || user.followers || "",
        following: user.friends_count || user.following || "",
        joined: user.created_at || "",
        avatar: user.profile_image_url_https || user.avatar || "",
        banner: user.profile_banner_url || user.banner || "",
        verified: user.verified || user.is_blue_verified || false
      }
    }
  } catch { /* ignore */ }

  // Fallback: try regex extraction from HTML
  const nameMatch = html.match(/<title>(.*?)<\/title>/)
  const name = nameMatch ? nameMatch[1].replace(/\s*-\s*X$/, "").trim() : username

  return {
    name,
    handle: `@${username}`,
    description: "",
    followers: "",
    following: "",
    avatar: "",
    banner: "",
    verified: false
  }
}

/**
 * Normalize a tweet object into a common format.
 */
function formatTweet(tweet) {
  // vxtwitter returns a flat-ish object
  const entity = tweet?.entity || tweet?.entities || {}
  const text = tweet?.full_text || tweet?.text || tweet?.content || ""
  const urls = entity?.urls || []
  const user = tweet?.user || tweet?.author || {}

  // Expand URLs
  let displayText = text
  for (const urlObj of (urls || [])) {
    const expanded = urlObj?.expanded_url || ""
    if (expanded && expanded !== "#") {
      displayText = displayText.replace(urlObj?.url || "", expanded)
    }
  }

  return {
    id: tweet?.id_str || tweet?.id || tweet?.tweet_id || "",
    text: displayText,
    user: {
      name: user?.name || "",
      handle: user?.screen_name || user?.username || "",
      avatar: user?.profile_image_url_https || user?.avatar_url || "",
      verified: user?.verified || user?.is_blue_verified || false
    },
    createdAt: tweet?.created_at || tweet?.timestamp || "",
    replies: tweet?.reply_count || tweet?.public_metrics?.reply_count || 0,
    reposts: tweet?.retweet_count || tweet?.public_metrics?.retweet_count || 0,
    likes: tweet?.favorite_count || tweet?.public_metrics?.favorite_count || 0,
    views: tweet?.views || tweet?.public_metrics?.view_count || 0,
    bookmarkCount: tweet?.bookmark_count || 0,
    images: extractImages(tweet),
    link: `https://x.com/${user?.screen_name || user?.username || "user"}/status/${tweet?.id_str || tweet?.id || tweet?.tweet_id || ""}`
  }
}

/**
 * Extract images from a tweet.
 */
function extractImages(tweet) {
  const media = tweet?.media || tweet?.entity?.media || []
  const images = []
  for (const m of media) {
    if (m?.type === "photo" || m?.media_type === "photo") {
      images.push(m?.media_url_https || m?.url || "")
    }
  }
  // Also check for card binding values (sometimes images are in cards)
  const card = tweet?.card?.binding_values
  if (card) {
    const photo = findCardImage(card)
    if (photo) images.push(photo)
  }
  return images.slice(0, 4)
}

/**
 * Find an image URL in a card's binding values.
 */
function findCardImage(card) {
  const keys = Object.keys(card)
  for (const key of keys) {
    if (key.includes("image") && key.includes("image")) {
      const val = card[key]?.value
      if (val?.image_value?.image_url) return val.image_value.image_url
      if (val?.string_value && val.string_value.startsWith("http")) return val.string_value
    }
  }
  return null
}
