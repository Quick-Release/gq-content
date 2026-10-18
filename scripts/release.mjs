import { build, load } from "./release/candidate.mjs";
import { validate } from "./release/validate.mjs";
import { resume } from "./release/pipeline.mjs";
import { services } from "./release/services.mjs";
const [action, directory, ciRun] = process.argv.slice(2);
try {
  if (!directory)
    throw Error(
      "Usage: node scripts/release.mjs build|inspect|validate|publish BUNDLE [CI_RUN_ID]",
    );
  if (action === "build") console.log(JSON.stringify(build(directory).manifest, null, 2));
  else if (action === "inspect") console.log(JSON.stringify(load(directory).manifest, null, 2));
  else if (action === "validate") validate(directory);
  else if (action === "publish") {
    const candidate = load(directory);
    const result = await resume(candidate, services(candidate, ciRun));
    console.log(JSON.stringify(result));
    if (!result.handoff) process.exitCode = 2;
  } else throw Error("unknown release action");
} catch (error) {
  console.error(JSON.stringify({ status: "incomplete", handoff: false, error: error.message }));
  process.exitCode = 1;
}
