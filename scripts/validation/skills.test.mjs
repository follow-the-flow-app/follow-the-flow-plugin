import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseFrontmatter, validateSkills } from "./skills.mjs";

/** A temporary root holding `files` ({ "<path relative to the root>": "<content>" }), checked by validateSkills; a path ending in "/" is a directory. */
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

test("a skill directory that is a symlink is an error", async () => {
  // A client that follows it ships a skill never checked; one that does not loses the skill.
  const root = await mkdtemp(path.join(tmpdir(), "ftf-skills-"));
  try {
    await mkdir(path.join(root, "shared", "run-x"), { recursive: true });
    await writeFile(path.join(root, "shared", "run-x", "SKILL.md"), VALID);
    await mkdir(path.join(root, "skills"));
    await symlink(path.join(root, "shared", "run-x"), path.join(root, "skills", "run-x"));
    const errors = await validateSkills(root);
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], /skills\/run-x/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skills that is not a directory is an error", async () => {
  assert.deepEqual(await errorsOf({ skills: "not a directory" }), ["skills must be a directory"]);
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
    // Each one YAML reads as something other than this text, or refuses.
    "name: run-x\ndescription: >",
    "name: run-x\ndescription: |",
    "name: run-x\ndescription: # TODO",
    "name: run-x\ndescription: Use it for:",
    "name: run-x\ndescription: - Runs workflows",
    "name: run-x\ndescription: -",
    "name: run-x\ndescription: *ref",
    "name: run-x\ndescription: &a text",
    "name: run-x\ndescription: !!int 5",
    "name: run-x\ndescription: {x}",
    "name: run-x\ndescription: 'abc",
    "name: run-x\ndescription: @x",
    "name: run-x\ndescription: %x",
    "name: run-x\ndescription: `x",
    "name: run-x\ndescription: ,foo",
    "name: run-x\ndescription: x\t# c",
    "name: run-x\ndescription: a:\tb",
    'name: run-x\ndescription: "a\\x41"',
    "name: run-x\ndescription: 'a' b",
    "name: run-x\ndescription:   ",
    "name:run-x\ndescription: x",
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
  for (const description of [
    "true", "False", "FALSE", "null", "NULL", "~", "1e3", "-1", "+5", ".5",
    ".inf", "-.inf", ".nan", "0x1f", "0o17",
  ]) {
    const found = await errorsOf({ "skills/run-x/SKILL.md": skill(`name: run-x\ndescription: ${description}`) });
    assert.equal(found.length, 1, `${description}\n${found.join("\n")}`);
  }
  assert.deepEqual(await errorsOf({ "skills/123/SKILL.md": skill('name: "123"\ndescription: "x"') }), []);
});

test("a name YAML reads as a boolean or number is an error even when it matches its directory", async () => {
  for (const name of ["false", "0x1f", "0o17"]) {
    const errors = await errorsOf({ [`skills/${name}/SKILL.md`]: skill(`name: ${name}\ndescription: "x"`) });
    assert.equal(errors.length, 1, `${name}\n${errors.join("\n")}`);
  }
});

test("plain values YAML reads as text are accepted", async () => {
  assert.deepEqual(
    await errorsOf({ "skills/3d-render/SKILL.md": skill("name: 3d-render\ndescription: true to the preview") }),
    [],
  );
  assert.deepEqual(await errorsOf({ "skills/run-x/SKILL.md": skill("name: run-x\ndescription: Runs step 2") }), []);
  assert.deepEqual(
    await errorsOf({ "skills/run-x/SKILL.md": skill('name: run-x \ndescription: "x" ') }),
    [],
    "trailing whitespace",
  );
  assert.deepEqual(
    await errorsOf({ "skills/run-x/SKILL.md": skill('# comment\nname: run-x\n\n   \ndescription: "x"') }),
    [],
    "blank and comment lines",
  );
});

test("a SKILL.md that is a symlink, or a skills that is a symlink, is an error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ftf-skills-"));
  try {
    await mkdir(path.join(root, "skills", "run-x"), { recursive: true });
    await writeFile(path.join(root, "real.md"), VALID);
    await symlink(path.join(root, "real.md"), path.join(root, "skills", "run-x", "SKILL.md"));
    let errors = await validateSkills(root);
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], /skills\/run-x\/SKILL\.md must be a regular file/);
    await rm(path.join(root, "skills"), { recursive: true });
    await mkdir(path.join(root, "elsewhere", "run-x"), { recursive: true });
    await writeFile(path.join(root, "elsewhere", "run-x", "SKILL.md"), VALID);
    await symlink(path.join(root, "elsewhere"), path.join(root, "skills"));
    errors = await validateSkills(root);
    assert.deepEqual(errors, ["skills must be a directory"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
