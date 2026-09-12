import { configDotenv } from "dotenv";

configDotenv();

const UNO_BASE_URL = "https://api.unorouter.com/v1";
const unoImageModel = "flux-2-klein-4b:free";

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
