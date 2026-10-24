import { assertDesignBlocks } from "@quick-release/design-renderer";
import { z } from "zod";
import type { DesignBlock } from "./design-patterns";

/** Validate publication trees with the producer/renderer contract, preserving every node. */
export const designBlocksSchema = z.unknown().transform((value, context): DesignBlock[] => {
  try {
    assertDesignBlocks(value);
    return value;
  } catch {
    context.addIssue({ code: "custom", message: "Invalid canonical Design block list" });
    return z.NEVER;
  }
});

/** The nullable GraphQL field is absent on older CMS releases and block recovery reads. */
export const designBlocksJsonSchema = z
  .string()
  .nullish()
  .transform((value, context) => {
    if (value == null) return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid canonical Design block JSON" });
      return z.NEVER;
    }
  })
  .pipe(designBlocksSchema.optional());
