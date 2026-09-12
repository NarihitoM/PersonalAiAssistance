import Groq from "groq-sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Firecrawl } from "firecrawl";
import { configDotenv } from "dotenv";

configDotenv();

const UNO_BASE_URL = "https://api.unorouter.com/v1";
const unoImageModel = "flux-2-klein-4b:free";
export const model = "qwen/qwen3-max:free";
export const modelaudio = "canopylabs/orpheus-v1-english";
export const transcriptmodel = "whisper-large-v3-turbo";

export const groq = new Groq({ apiKey: process.env.AI });
export const xkiro = new OpenAI({ baseURL: "https://api.xkiro.com/v1", apiKey: process.env.XKIRO });

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL });

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

export async function generateImage(prompt, { timeoutMs = 60000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${UNO_BASE_URL}/images/generations`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.UNO}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ model: unoImageModel, prompt }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`UnoRouter image generation failed: ${response.status} ${await response.text()}`);
        }

        const data = await response.json();
        const image = data.data?.[0];
        if (!image) throw new Error("UnoRouter returned no image data");

        return image.b64_json
            ? Buffer.from(image.b64_json, "base64")
            : image.url;
    } finally {
        clearTimeout(timeout);
    }
}

const gemini = new GoogleGenerativeAI(process.env.GEMINI);
const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export async function analyzeImage(systemPrompt, imageUrl, captionText = "", knownMimeType = "") {
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const headerMimeType = imageResponse.headers.get("content-type");
    const mimeType = knownMimeType
        || (headerMimeType && headerMimeType !== "application/octet-stream" ? headerMimeType : "image/jpeg");

    const result = await visionmodel.generateContent([
        systemPrompt,
        captionText,
        { inlineData: { data: base64, mimeType } }
    ]);

    return result.response.text();
}


