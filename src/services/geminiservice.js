import dns from "dns/promises";
import net from "net";
import { gemini, visionmodel, geminiChatModel as cfgGeminiChatModel, geminiOpenAI } from "../config/gemini.js";

export const geminiChatModel = cfgGeminiChatModel;

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
    if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    let mimeType = knownMimeType || imageResponse.headers.get("content-type") || "";
    if (!mimeType || mimeType === "application/octet-stream" || !mimeType.startsWith("image/")) {
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) mimeType = "image/png";
        else if (buffer[0] === 0xFF && buffer[1] === 0xD8) mimeType = "image/jpeg";
        else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) mimeType = "image/gif";
        else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) mimeType = "image/webp";
        else {
            const lower = imageUrl.toLowerCase().split("?")[0];
            if (lower.endsWith(".png")) mimeType = "image/png";
            else if (lower.endsWith(".webp")) mimeType = "image/webp";
            else if (lower.endsWith(".gif")) mimeType = "image/gif";
            else mimeType = "image/jpeg";
        }
    }
    mimeType = mimeType.split(";")[0].trim();

    return analyzeImageBuffer(systemPrompt, buffer, captionText, mimeType);
}

export async function analyzeImageBuffer(systemPrompt, buffer, captionText = "", mimeType = "image/jpeg") {
    const result = await visionmodel.generateContent([
        systemPrompt,
        captionText,
        { inlineData: { data: buffer.toString("base64"), mimeType } }
    ]);

    return result.response.text();
}
