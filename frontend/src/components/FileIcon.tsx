import { BookOpen, FileText, FileSpreadsheet, FileType2, FileCode } from "lucide-react";

// Map a document extension (with leading dot) to an icon + accent color.
const MAP: Record<string, { icon: typeof FileText; cls: string }> = {
  ".txt": { icon: FileText, cls: "text-slate-500" },
  ".md": { icon: FileCode, cls: "text-sky-500" },
  ".pdf": { icon: FileType2, cls: "text-rose-500" },
  ".docx": { icon: FileText, cls: "text-blue-500" },
  ".epub": { icon: BookOpen, cls: "text-amber-500" },
  ".xls": { icon: FileSpreadsheet, cls: "text-emerald-500" },
  ".xlsx": { icon: FileSpreadsheet, cls: "text-emerald-500" },
};

export function FileIcon({ ext, size = 16 }: { ext: string; size?: number }) {
  const { icon: Icon, cls } = MAP[ext.toLowerCase()] ?? {
    icon: FileText,
    cls: "text-slate-400",
  };
  return <Icon size={size} className={`shrink-0 ${cls}`} />;
}
