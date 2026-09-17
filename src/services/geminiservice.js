import { GoogleGenerativeAI } from "@google/generative-ai";
import { configDotenv } from "dotenv";
import dns from "dns/promises";
import net from "net";
import OpenAI from "openai";

configDotenv();

const gemini = new GoogleGenerativeAI(process.env.GEMINI);
const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export const geminiChatModel = "gemini-2.5-flash";

const geminiOpenAI = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI
});

export async function geminiChatCompletion(params) {
    return geminiOpenAI.chat.completions.create({
        ...params,
        model: geminiChatModel,
        extra_body: {
            google: {
                thinking_config: { thinking_budget: 0 }
            }
        }
    });
}


function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
    }
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower === "::";
}

export async function assertPublicHttpsUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error("Only https URLs are allowed");

    const addresses = await dns.lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some(a => isPrivateIp(a.address))) {
        throw new Error("URL resolves to a disallowed address");
    }
}

export async function analyzeImage(systemPrompt, imageUrl, captionText = "", knownMimeType = "") {
    await assertPublicHttpsUrl(imageUrl);
    const imageResponse = await fetch(imageUrl, { redirect: "error" });
    const arrayBuffer = await imageResponse.arrayBuffer();
    const headerMimeType = imageResponse.headers.get("content-type");
    const mimeType = knownMimeType
        || (headerMimeType && headerMimeType !== "application/octet-stream" ? headerMimeType : "image/jpeg");

    return analyzeImageBuffer(systemPrompt, Buffer.from(arrayBuffer), captionText, mimeType);
}

export async function analyzeImageBuffer(systemPrompt, buffer, captionText = "", mimeType = "image/jpeg") {
    const result = await visionmodel.generateContent([
        systemPrompt,
        captionText,
        { inlineData: { data: buffer.toString("base64"), mimeType } }
    ]);

    return result.response.text();
}
