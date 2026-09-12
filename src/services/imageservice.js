import { configDotenv } from "dotenv";

configDotenv();

const UNO_BASE_URL = "https://api.unorouter.com/v1";
const unoImageModel = "flux-2-klein-4b:free";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const openrouterImageModel = "sourceful/riverflow-v2.5-fast";

async function generateImageWithUno(prompt, signal) {
    const response = await fetch(`${UNO_BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.UNO}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: unoImageModel, prompt }),
        signal
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
}

async function generateImageWithOpenRouter(prompt, signal) {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: openrouterImageModel,
            modalities: ["image", "text"],
            messages: [{ role: "user", content: prompt }]
        }),
        signal
    });

    if (!response.ok) {
        throw new Error(`OpenRouter image generation failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const image = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!image) throw new Error("OpenRouter returned no image data");

    return image.startsWith("data:")
        ? Buffer.from(image.split(",")[1], "base64")
        : image;
}


export async function generateImage(prompt, { timeoutMs = 60000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        try {
            return await generateImageWithOpenRouter(prompt, controller.signal);
        } catch (err) {
            console.log("UnoRouter image generation failed, falling back to OpenRouter:", err.message);
            return await generateImageWithUno(prompt, controller.signal);
        }
    } finally {
        clearTimeout(timeout);
    }
}
