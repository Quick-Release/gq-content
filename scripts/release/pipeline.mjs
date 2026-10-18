import assert from "node:assert/strict";

// Every read is live. Local state never authorizes skipping a remote stage.
export async function resume(candidate, service) {
  await service.gate(candidate);
  const { manifest, assets, npmIdentity, composerIdentity } = candidate;
  // Reject an already-published conflicting version before causing partial publication.
  const existingNpm = await service.npm();
  const existingComposer = await service.composer();
  if (existingNpm !== null)
    assert.equal(existingNpm, npmIdentity, "npm integrity/artifact mismatch");
  if (existingComposer !== null)
    assert.equal(existingComposer, composerIdentity, "Composer artifact mismatch");
  let tag = await service.tag();
  if (tag === null) {
    await service.createTag();
    tag = await service.tag();
  }
  assert.equal(tag, manifest.sourceCommit, "tag mismatch");
  for (const [name, bytes] of Object.entries(assets)) {
    let existing = await service.asset(name);
    if (existing == null) {
      await service.upload(name, bytes);
      existing = await service.asset(name);
    }
    assert.deepEqual(existing, bytes, `asset mismatch: ${name}`);
  }
  let npm = await service.npm();
  if (npm === null) {
    await service.publish();
    npm = await service.npm();
  }
  if (npm !== null) assert.equal(npm, npmIdentity, "npm integrity/artifact mismatch");
  let composer = await service.composer();
  if (composer === null) {
    await service.dispatch();
    composer = await service.composer();
  }
  if (composer !== null) assert.equal(composer, composerIdentity, "Composer artifact mismatch");
  assert.equal(await service.tag(), manifest.sourceCommit, "tag mismatch");
  for (const [name, bytes] of Object.entries(assets))
    assert.deepEqual(await service.asset(name), bytes, `asset mismatch: ${name}`);
  npm = await service.npm();
  composer = await service.composer();
  if (npm !== null) assert.equal(npm, npmIdentity, "npm integrity/artifact mismatch");
  if (composer !== null) assert.equal(composer, composerIdentity, "Composer artifact mismatch");
  return {
    status: npm === npmIdentity && composer === composerIdentity ? "complete" : "partial",
    npm: npm !== null,
    composer: composer !== null,
    handoff: npm === npmIdentity && composer === composerIdentity,
  };
}
