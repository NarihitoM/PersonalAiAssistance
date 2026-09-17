import { firecrawl } from "../config/firecrawl.js";

export async function webSearch(query) {
    const result = await firecrawl.search(query, { limit: 5 });
    return (result.web || []).map(r => ({ title: r.title, url: r.url, description: r.description }));
}

export async function webScrape(url, { onlyMainContent = true, formats = ["markdown"] } = {}) {
    const doc = await firecrawl.scrape(url, {
        formats,
        onlyMainContent,
        timeout: 30000
    });
    const raw = doc.markdown || doc.html || doc.rawHtml || "";
    const truncated = raw.length > 15000 ? raw.slice(0, 15000) + "\n\n[truncated - content too long]" : raw;
    return {
        url: doc.metadata?.sourceURL || doc.metadata?.url || url,
        content: truncated,
        metadata: doc.metadata,
        truncated: raw.length > 15000
    };
}

export async function webCrawl(url, { limit = 10, maxDiscoveryDepth = 2 } = {}) {
    const result = await firecrawl.crawl(url, {
        limit,
        maxDiscoveryDepth,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true, timeout: 30000 }
    });
    return (result.data || []).slice(0, limit).map(d => {
        const raw = d.markdown || d.html || "";
        const truncated = raw.length > 8000 ? raw.slice(0, 8000) + "\n\n[truncated]" : raw;
        return { url: d.metadata?.sourceURL || d.metadata?.url, title: d.metadata?.title, content: truncated, truncated: raw.length > 8000 };
    });
}

export async function webMap(url, { limit = 20 } = {}) {
    const result = await firecrawl.map(url, { limit });
    return (result.links || []).map(l => ({ url: l.url, title: l.title, description: l.description }));
}

export async function youtubeSearch(query, { limit = 5 } = {}) {
    let result = await firecrawl.search(query, { limit, includeDomains: ["youtube.com"] });
    let web = result.web || [];
    if (web.length === 0) {
        result = await firecrawl.search(`${query} site:youtube.com`, { limit });
        web = result.web || [];
    }
    const filtered = web.filter(r => r.url?.includes("youtube.com") || r.url?.includes("youtu.be"));
    const final = filtered.length > 0 ? filtered : web;
    if (final.length === 0) return [{ title: "No results", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, description: `No direct results, try searching YouTube directly for "${query}"` }];
    return final.slice(0, limit).map(r => ({ title: r.title || r.url, url: r.url, description: r.description || "" }));
}

export async function youtubeTranscript(urlOrId) {
    const videoId = (() => {
        const m = String(urlOrId).match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
        return m ? m[1] : String(urlOrId).trim();
    })();
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
        const doc = await firecrawl.scrape(watchUrl, { formats: ["markdown"], onlyMainContent: true, timeout: 30000, waitFor: 3000 });
        const raw = doc.markdown || doc.html || "";
        if (raw && raw.length > 200) {
            const truncated = raw.length > 15000 ? raw.slice(0, 15000) + "\n\n[truncated]" : raw;
            return { videoId, url: watchUrl, transcript: truncated, metadata: doc.metadata, source: "firecrawl" };
        }
    } catch {}

    const html = await fetch(watchUrl, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text());
    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/s);
    if (captionMatch) {
        try {
            const tracks = JSON.parse(captionMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, ""));
            const track = tracks.find(t => t.languageCode === "en") || tracks[0];
            if (track?.baseUrl) {
                const xml = await fetch(track.baseUrl).then(r => r.text());
                const texts = [...xml.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<[^>]+>/g, ""));
                const transcript = texts.join(" ");
                if (transcript.length > 0) {
                    const truncated = transcript.length > 15000 ? transcript.slice(0, 15000) + "\n\n[truncated]" : transcript;
                    return { videoId, url: watchUrl, transcript: truncated, source: "captions" };
                }
            }
        } catch {}
    }
    throw new Error("Transcript not available for this video");
}
