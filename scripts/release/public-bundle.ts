/** Remove only generated private dependency path markers. License/legal notices
 * and all executable code remain byte-for-byte unchanged. */
export function publicBundleComments(code: string) {
  return code.replace(
    /^\/\/#region node_modules\/[^\r\n]*@quick-release\/[^\r\n]*(?:\r?\n|$)/gm,
    "",
  );
}
