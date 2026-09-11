import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { configDotenv } from "dotenv";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });

const gemini = new GoogleGenerativeAI(process.env.GEMINI);
const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const UNO_BASE_URL = "https://api.unorouter.com/v1";
const unoImageModel = "grok-imagine-image-lite:free";

export async function generateImage(prompt) {
    const response = await fetch(`${UNO_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.UNO}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: unoImageModel,
            messages: [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) {
        throw new Error(`UnoRouter image generation failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const message = data.choices[0].message;

    const fromImagesField = message.images?.[0]?.image_url?.url;
    if (fromImagesField) return dataUrlOrUrlToOutput(fromImagesField);

    const markdownMatch = message.content?.match(/!\[[^\]]*\]\((\S+)\)/);
    if (markdownMatch) return dataUrlOrUrlToOutput(markdownMatch[1]);

    if (message.content?.startsWith("data:image") || message.content?.startsWith("http")) {
        return dataUrlOrUrlToOutput(message.content.trim());
    }

    throw new Error(`UnoRouter image generation: could not find image in response: ${JSON.stringify(message)}`);
}

function dataUrlOrUrlToOutput(value) {
    const dataUrlMatch = value.match(/^data:image\/\w+;base64,(.+)$/);
    return dataUrlMatch ? Buffer.from(dataUrlMatch[1], "base64") : value;
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


