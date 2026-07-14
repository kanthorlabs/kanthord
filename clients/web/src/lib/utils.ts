import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The shadcn className helper: merge conditional classes, de-dupe Tailwind
// conflicts. Every composite/primitive uses this — no ad-hoc concatenation.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
