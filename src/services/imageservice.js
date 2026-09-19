import { UNO_BASE_URL, unoImageModel, OPENROUTER_BASE_URL, openrouterImageModel, UNO_KEY, OPENROUTER_KEY } from "../config/image.js";

async function generateImageWithUno(prompt, signal) {
    const response = await fetch(`${UNO_BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${UNO_KEY}`,
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

async function generateImageWithOpenRouter(prompt, signal, model = openrouterImageModel) {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENROUTER_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model,
            modalities: ["image", "text"],
            messages: [{ role: "user", content: prompt }],
            safety_settings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
            ],
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
            ]
        }),
        signal
    });

    if (!response.ok) {
        throw new Error(`OpenRouter image generation failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    if (data.choices?.[0]?.finish_reason === "content_filter") throw new Error("CONTENT_FILTERED");

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
            return await generateImageWithUno(prompt, controller.signal);
        } catch (err) {
            console.log("UnoRouter image generation failed, falling back to OpenRouter (paid):", err.message);
            try {
                return await generateImageWithOpenRouter(prompt, controller.signal, openrouterImageModel);
            } catch (openErr) {
                if (openErr.message === "CONTENT_FILTERED") {
                    const softFallback = "black-forest-labs/flux.1-schnell:free";
                    console.log(`OpenRouter ${openrouterImageModel} content_filter, retrying with softer model ${softFallback}`);
                    try {
                        return await generateImageWithOpenRouter(prompt, controller.signal, softFallback);
                    } catch (softErr) {
                        console.log(`Soft fallback ${softFallback} also failed:`, softErr.message.slice(0, 800));
                        throw softErr;
                    }
                }
                throw openErr;
            }
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function editImageWithOpenRouter(imageUrl, prompt, signal, model) {
    const res = await fetch(imageUrl, { signal, redirect: "error" });
    if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status} ${await res.text().catch(() => "")}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("Source image too large (>8MB)");
    let ct = res.headers.get("content-type") || "";
    if (!ct || ct === "application/octet-stream" || !ct.startsWith("image/")) {
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) ct = "image/png";
        else if (buf[0] === 0xFF && buf[1] === 0xD8) ct = "image/jpeg";
        else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ct = "image/gif";
        else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) ct = "image/webp";
        else {
            const lower = imageUrl.toLowerCase().split("?")[0];
            if (lower.endsWith(".png")) ct = "image/png";
            else if (lower.endsWith(".webp")) ct = "image/webp";
            else if (lower.endsWith(".gif")) ct = "image/gif";
            else ct = "image/jpeg";
        }
    }
    ct = ct.split(";")[0].trim();
    const imageDataUrl = `data:${ct};base64,${buf.toString("base64")}`;

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENROUTER_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model,
            modalities: ["image", "text"],
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: imageDataUrl } }
                ]
            }],
            safety_settings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
            ],
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
            ]
        }),
        signal
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter image edit failed (${model}): ${response.status} ${text}`);
    }

    const data = await response.json();
    if (data.choices?.[0]?.finish_reason === "content_filter") throw new Error("CONTENT_FILTERED");

    const image = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!image) {
        console.log("OpenRouter edit no image, full response:", JSON.stringify(data).slice(0, 4000));
        throw new Error("OpenRouter returned no edited image data");
    }

    return image.startsWith("data:")
        ? Buffer.from(image.split(",")[1], "base64")
        : image;
}

export async function editImage(imageUrl, prompt, { timeoutMs = 60000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        try {
            return await editImageWithOpenRouter(imageUrl, prompt, controller.signal, openrouterImageModel);
        } catch (err) {
            console.log(`Primary edit model ${openrouterImageModel} failed:`, err.message.slice(0, 800));
            const isFiltered = err.message === "CONTENT_FILTERED";
            const fallback = isFiltered ? "black-forest-labs/flux.1-schnell:free" : "google/gemini-2.5-flash-image";
            console.log(`Trying fallback edit model ${fallback} ${isFiltered ? "(soft filter retry)" : ""}`);
            try {
                return await editImageWithOpenRouter(imageUrl, prompt, controller.signal, fallback);
            } catch (fallbackErr) {
                if (isFiltered && fallbackErr.message !== "CONTENT_FILTERED") throw fallbackErr;
                if (isFiltered) {
                    const secondFallback = "google/gemini-2.5-flash-image";
                    console.log(`Soft fallback also filtered, trying ${secondFallback}`);
                    return await editImageWithOpenRouter(imageUrl, prompt, controller.signal, secondFallback);
                }
                throw fallbackErr;
            }
        }
    } finally {
        clearTimeout(timeout);
    }
}
