import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Firecrawl } from "firecrawl";
import { configDotenv } from "dotenv";

configDotenv();

const UNO_BASE_URL = "https://api.unorouter.com/v1";
const unoImageModel = "flux-2-klein-4b:free";
export const model = "openai/gpt-oss-120b";
export const modelaudio = "canopylabs/orpheus-v1-english";
export const transcriptmodel = "whisper-large-v3-turbo";

export const groq = new Groq({ apiKey: process.env.AI });

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


