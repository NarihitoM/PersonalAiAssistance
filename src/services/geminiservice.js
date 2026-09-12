import { GoogleGenerativeAI } from "@google/generative-ai";
import { configDotenv } from "dotenv";

configDotenv();

const gemini = new GoogleGenerativeAI(process.env.GEMINI);
const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export async function analyzeImage(systemPrompt, imageUrl, captionText = "", knownMimeType = "") {
    const imageResponse = await fetch(imageUrl);
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
