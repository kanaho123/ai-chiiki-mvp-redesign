import { inventoryVersion } from "../server/db.js";
import { handle, json } from "../server/http.js";

export const GET = handle(async () => json({ version: await inventoryVersion() }));
