import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { configDotenv } from "dotenv";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });

const gemini = new GoogleGenerativeAI(process.env.GEMINI);
const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const UNO_BASE_URL = "https://api.unorouter.com/v1";
const unoImageModel = "flux-2-dev:free";

export async function generateImage(prompt) {
    const response = await fetch(`${UNO_BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.UNO}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: unoImageModel,
            prompt
        })
    });

    if (!response.ok) {
        throw new Error(`UnoRouter image generation failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const image = data.data[0];

    return image.b64_json
        ? Buffer.from(image.b64_json, "base64")
        : image.url;
}

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


