import Groq from "groq-sdk";
import { configDotenv } from "dotenv";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });
