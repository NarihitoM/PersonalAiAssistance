import { config } from "dotenv";
config();

export const UNO_BASE_URL = "https://api.unorouter.com/v1";
export const unoImageModel = "flux-2-klein-4b:free";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const openrouterImageModel = "google/gemini-3.1-flash-lite-image";
export const UNO_KEY = process.env.UNO;
export const OPENROUTER_KEY = process.env.OPENROUTER;
