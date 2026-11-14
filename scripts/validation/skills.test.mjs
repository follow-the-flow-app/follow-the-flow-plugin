import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseFrontmatter, validateSkills } from "./skills.mjs";

/** A temporary root whose skills/ holds `files` ({ "<relative path>": "<content>" }); a path ending in "/" is a directory. */
async function errorsOf(files) {
  const root = await mkdtemp(path.join(tmpdir(), "ftf-skills-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      if (file.endsWith("/")) {
        await mkdir(target, { recursive: true });
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
    }
    return await validateSkills(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const skill = (frontmatter) => `---\n${frontmatter}\n---\n# Skill\n`;
const VALID = skill('name: run-x\ndescription: "Does x."');

test("no skills directory is valid", async () => {
  assert.deepEqual(await errorsOf({}), []);
});

test("a valid skill is valid", async () => {
  assert.deepEqual(await errorsOf({ "skills/run-x/SKILL.md": VALID }), []);
});

test("a file directly under skills is ignored", async () => {
  assert.deepEqual(
    await errorsOf({ "skills/README.md": "# Skills\n", "skills/run-x/SKILL.md": VALID }),
    [],
  );
});

test("skills that is not a directory is an error", async () => {
  const errors = await errorsOf({ skills: "not a directory" });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /skills/);
});

test("a skill directory without SKILL.md is an error", async () => {
  const errors = await errorsOf({ "skills/run-x/": "", "skills/run-y/SKILL.md": skill('name: run-y\ndescription: "y"') });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /skills\/run-x\/SKILL\.md/);
});

test("SKILL.md that is not a regular file is an error", async () => {
  const errors = await errorsOf({ "skills/run-x/SKILL.md/": "" });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /skills\/run-x\/SKILL\.md/);
});

test("missing frontmatter is an error", async () => {
  const errors = await errorsOf({ "skills/run-x/SKILL.md": "# Skill\n" });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /frontmatter/);
});

test("unterminated frontmatter is an error", async () => {
  const errors = await errorsOf({ "skills/run-x/SKILL.md": "---\nname: run-x\ndescription: x\n# Skill\n" });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /frontmatter/);
});

test("an unsupported frontmatter line is an error", async () => {
  for (const frontmatter of [
    "name: run-x\ndescription: >\n  folded",
    "name: run-x\ndescription: one: two",
    "name: run-x\ndescription: x # comment",
    "name: run-x\ndescription: [a, b]",
    "name: run-x\ndescription: \"unterminated",
  ]) {
    const errors = await errorsOf({ "skills/run-x/SKILL.md": skill(frontmatter) });
    assert.equal(errors.length, 1, `${frontmatter}\n${errors.join("\n")}`);
    assert.match(errors[0], /key: value/);
  }
});

test("a plain value YAML reads as a number, boolean or null is an error", async () => {
  // A directory named 123 and `name: 123` would pass every name check if 123 were read as text.
  const errors = await errorsOf({ "skills/123/SKILL.md": skill('name: 123\ndescription: "x"') });
  assert.equal(errors.length, 1, errors.join("\n"));
  for (const description of ["true", "null", "~", "1e3"]) {
    const found = await errorsOf({ "skills/run-x/SKILL.md": skill(`name: run-x\ndescription: ${description}`) });
    assert.equal(found.length, 1, `${description}\n${found.join("\n")}`);
  }
  assert.deepEqual(await errorsOf({ "skills/123/SKILL.md": skill('name: "123"\ndescription: "x"') }), []);
});

test("a duplicate key is an error", async () => {
  const errors = await errorsOf({
    "skills/run-x/SKILL.md": skill('name: run-x\ndescription: "a"\ndescription: "b"'),
  });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /description/);
});

test("the name must match its directory", async () => {
  const errors = await errorsOf({ "skills/run-y/SKILL.md": VALID });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /run-y/);
});

test("an invalid name is an error", async () => {
  for (const name of ["Run-X", "run--x", "-run", "run-", "a".repeat(65)]) {
    const errors = await errorsOf({ [`skills/${name}/SKILL.md`]: skill(`name: ${name}\ndescription: "x"`) });
    assert.equal(errors.length, 1, `${name}\n${errors.join("\n")}`);
    assert.match(errors[0], /name/);
  }
  const longest = "a".repeat(64);
  assert.deepEqual(
    await errorsOf({ [`skills/${longest}/SKILL.md`]: skill(`name: ${longest}\ndescription: "x"`) }),
    [],
  );
});

test("a missing name or description is an error", async () => {
  assert.equal((await errorsOf({ "skills/run-x/SKILL.md": skill('description: "x"') })).length, 1);
  assert.equal((await errorsOf({ "skills/run-x/SKILL.md": skill("name: run-x") })).length, 1);
});

test("the description must be 1-1024 characters", async () => {
  const of = (description) =>
    errorsOf({ "skills/run-x/SKILL.md": skill(`name: run-x\ndescription: "${description}"`) });
  assert.equal((await of("")).length, 1);
  assert.equal((await of("x".repeat(1025))).length, 1);
  assert.deepEqual(await of("x".repeat(1024)), []);
});

test("quoted values are read as YAML reads them", () => {
  assert.deepEqual(parseFrontmatter(skill(`name: 'it''s'\ndescription: "a \\"b\\""`)), {
    fields: { name: "it's", description: 'a "b"' },
  });
  assert.deepEqual(parseFrontmatter(skill("name: run-x\ndescription: Plain text, with a comma.")), {
    fields: { name: "run-x", description: "Plain text, with a comma." },
  });
});

test("CRLF line endings are accepted", async () => {
  assert.deepEqual(await errorsOf({ "skills/run-x/SKILL.md": VALID.replaceAll("\n", "\r\n") }), []);
});
