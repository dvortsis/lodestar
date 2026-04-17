import { resolveServerApiUrl } from "@/utils/resolveServerApiUrl";

export { resolveServerApiUrl };

async function apiFetch(endpoint: string, options?: RequestInit): Promise<any> {
  try {
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url =
      typeof window !== "undefined" ? path : resolveServerApiUrl(path);
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error(`Failed to fetch: ${error.message}`);
    throw error;
  }
}

export default apiFetch;
