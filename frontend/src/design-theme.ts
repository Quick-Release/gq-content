import { z } from "zod";
import { resolveDesignTheme } from "@quick-release/design-renderer";

/** Both CMS reads and stored publications use the owning theme validator. */
export const designThemeSchema = z.unknown().transform((value, context) => {
  try {
    return resolveDesignTheme(value);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid resolved Design theme" });
    return z.NEVER;
  }
});
