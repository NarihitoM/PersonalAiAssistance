import Groq from "groq-sdk";
import { configDotenv } from "dotenv";

configDotenv();

export const modelaudio = "canopylabs/orpheus-v1-english";
export const transcriptmodel = "whisper-large-v3-turbo";

export const groq = new Groq({ apiKey: process.env.AI });
