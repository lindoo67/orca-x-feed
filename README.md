# X Feed — Orca Plugin

Browse X (Twitter) trends, search results, and user profiles right in your Orca sidebar.

## Features

- **Trending** — See what's trending on X
- **Search** — Search by keyword or hashtag
- **Profile** — View any user's recent tweets
- **Auto-refresh** — Configurable refresh interval
- **Dark/Light theme** — Follows your Orca theme
- **Open in X** — Click any tweet to open it in the browser

## Installation

1. Download the plugin package
2. In Orca, go to **Settings → Plugins**
3. Install from the downloaded package

## Configuration

Click the ⚙️ gear icon in the panel or go to plugin settings:

| Setting | Description | Default |
|---------|-------------|---------|
| Default view | What to show when you open X Feed | Trending |
| API URL | Backend for fetching tweets | `https://api.vxtwitter.com` |
| Bearer Token | (Optional) X Developer token for authenticated access | — |
| Auto-refresh | Interval in seconds (0 = off) | 0 |

## API Backend

By default, this plugin uses **[vxtwitter](https://github.com/n6hi/vxtwitter)** — a free, open-source X/Twitter API proxy that requires no authentication.

For authenticated access (timed tweets, protected content), you can provide a Bearer token from an [X Developer Portal](https://developer.x.com/) app.

## License

MIT
