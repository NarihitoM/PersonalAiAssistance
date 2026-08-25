import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { configDotenv } from "dotenv";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });

const gemini = new GoogleGenerativeAI(process.env.GEMINI);
const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export async function analyzeImage(systemPrompt, imageUrl, captionText = "") {
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    const result = await visionmodel.generateContent([
        systemPrompt,
        captionText,
        { inlineData: { data: base64, mimeType } }
    ]);

    return result.response.text();
}


