import type { LucideIcon } from "lucide-react";
import {
  Archive,
  File,
  FileText,
  Film,
  Image as LucideImage,
  Music,
  Terminal,
} from "lucide-react";

import type { FileCategory } from "@/lib/fileUtils";

/** Row / bar order: Video → Audio → Image → Document → Archive → App → Other */
export const COMPOSITION_DISPLAY_ORDER: readonly FileCategory[] = [
  "video",
  "audio",
  "image",
  "document",
  "archive",
  "app",
  "other",
] as const;

/** Lucide icons shared by search composition rows and torrent card footer bar. */
export const COMPOSITION_CATEGORY_ICON: Record<FileCategory, LucideIcon> = {
  video: Film,
  audio: Music,
  image: LucideImage,
  document: FileText,
  archive: Archive,
  app: Terminal,
  other: File,
};
