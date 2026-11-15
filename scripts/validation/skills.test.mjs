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
    assert.equal(errors[0], "skills/run-x must not be a symlink");
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
    "name: run-x\n\u00a0\ndescription: x",
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
  for (const description of ["See https://x.app", "At 10:30", "Runs C# builds", "a:\u00a0b", "a\u00a0#b"]) {
    assert.deepEqual(
      await errorsOf({ "skills/run-x/SKILL.md": skill(`name: run-x\ndescription: ${description}`) }),
      [],
      description,
    );
  }
  assert.deepEqual(
    await errorsOf({ "skills/run-x/SKILL.md": skill('name: run-x \ndescription: "x" ') }),
    [],
    "trailing whitespace",
  );
  assert.deepEqual(
    await errorsOf({ "skills/run-x/SKILL.md": skill('name: run-x\t\ndescription: "x"\t') }),
    [],
    "trailing tab",
  );
  assert.deepEqual(
    await errorsOf({ "skills/run-x/SKILL.md": skill('# comment\nname: run-x\n\n   \ndescription: "x"') }),
    [],
    "blank and comment lines",
  );
  assert.deepEqual(
    await errorsOf({ "skills/run-x/SKILL.md": skill('name: run-x\n\t\n\t# c\n  # d\ndescription: "x"') }),
    [],
    "a tab-only line and indented comments",
  );
});

test("a no-break space is part of the value, as YAML reads it", async () => {
  // String#trim would read "run-x" and pass, while a client reads a name unlike its directory.
  for (const name of ["\u00a0run-x", "run-x\u00a0"]) {
    const errors = await errorsOf({ "skills/run-x/SKILL.md": skill(`name: ${name}\ndescription: "x"`) });
    assert.equal(errors.length, 1, `${JSON.stringify(name)}\n${errors.join("\n")}`);
    assert.match(errors[0], /name/);
  }
});

test("a symlinked file directly under skills is an error too", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ftf-skills-"));
  try {
    await mkdir(path.join(root, "skills"));
    await writeFile(path.join(root, "notes.md"), "# Notes\n");
    await symlink(path.join(root, "notes.md"), path.join(root, "skills", "README.md"));
    assert.deepEqual(await validateSkills(root), ["skills/README.md must not be a symlink"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("a character this validator does not accept is an error, plain, quoted or in a comment", async () => {
  // Outside quotes YAML 1.2.2 refuses each of these but CR (a line break to it), NEL, U+2028 and
  // U+2029 (line breaks to YAML 1.1); inside quotes it refuses only the raw C0 controls but CR. The validator refuses all of them
  // everywhere (see REFUSED_CHARACTER). The error names the character and the line.
  for (const [value, code] of [
    ["a\u0000b", "0000"],
    ["a\u0007b", "0007"],
    ["a\u0008b", "0008"],
    ["a\u000bb", "000B"],
    ["a\u000cb", "000C"],
    ["a\u001fb", "001F"],
    ["a\rb", "000D"],
    ["a\u007fb", "007F"],
    ["a\u0080b", "0080"],
    ["a\u0085b", "0085"],
    ["a\u0086b", "0086"],
    ["a\u009fb", "009F"],
    ["a\u2028b", "2028"],
    ["a\u2029b", "2029"],
    ["a\ufeffb", "FEFF"],
    ["a\ufffeb", "FFFE"],
    ["a\uffffb", "FFFF"],
    ["'a\u0001b'", "0001"],
    ['"a\u007fb"', "007F"],
  ]) {
    const line = `description: ${value}`;
    const errors = await errorsOf({ "skills/run-x/SKILL.md": skill(`name: run-x\n${line}`) });
    assert.equal(errors.length, 1, `${JSON.stringify(value)}\n${errors.join("\n")}`);
    assert.ok(
      errors[0].endsWith(`has a character this validator does not accept (U+${code}) in its frontmatter: ${JSON.stringify(line)}`),
      errors[0],
    );
  }
  const errors = await errorsOf({ "skills/run-x/SKILL.md": skill("name: run-x\n# a\u0000b\ndescription: x") });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /character this validator does not accept \(U\+0000\)/);
});

test("a lone surrogate is a character this validator does not accept", () => {
  // A file cannot carry one past the strict UTF-8 read; parseFrontmatter is exported, so pin it here.
  assert.match(parseFrontmatter(skill("name: run-x\ndescription: a\ud800b")).error, /\(U\+D800\)/);
});

test("the character check holds across calls", () => {
  // A global regex would keep lastIndex from the first call and miss the character in the second.
  assert.match(parseFrontmatter(skill("name: run-x\ndescription: aaaaaaaaaaaaaaaaaaaa\u0001")).error, /U\+0001/);
  assert.match(parseFrontmatter(skill("x: \u0001")).error, /U\+0001/);
});

test("every character up to U+FFFF is refused exactly when the rule says so", () => {
  // The rule in skills.mjs's comment, written out apart from its regex, so a hole inside a range
  // shows up and not only at its ends. Line feed is left out: it splits the line.
  const refused = (code) =>
    (code < 0x20 && code !== 0x09) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfeff ||
    code === 0xfffe ||
    code === 0xffff;
  const wrong = [];
  for (let code = 0; code <= 0xffff; code++) {
    if (code === 0x0a) continue;
    const { error } = parseFrontmatter(skill(`name: run-x\ndescription: a${String.fromCharCode(code)}b`));
    if (refused(code) !== Boolean(error?.includes("this validator does not accept"))) wrong.push(code.toString(16));
  }
  assert.deepEqual(wrong, []);
});

test("printable characters and escapes are read as YAML reads them", () => {
  // The ends of each range the validator accepts, a tab inside a plain value, and a valid U+FFFD;
  // an escaped control is a written escape, not a raw character.
  const accepted = "a b~c\u00a0d\u2027e\u202af\ud7ffg\ue000h\ufefei\uff00j\ufffdk\u{10000}l\u{10ffff}m\tn";
  assert.deepEqual(parseFrontmatter(skill(`name: run-x\ndescription: ${accepted}`)), {
    fields: { name: "run-x", description: accepted },
  });
  assert.deepEqual(parseFrontmatter(skill('name: run-x\ndescription: "a\\u0000b"')), {
    fields: { name: "run-x", description: "a\u0000b" },
  });
});

test("SKILL.md that is not valid UTF-8 is an error", async () => {
  // Read leniently, the byte 0xFF would become U+FFFD and pass.
  const bytes = Buffer.concat([Buffer.from("---\nname: run-x\ndescription: a"), Buffer.from([0xff]), Buffer.from("b\n---\n")]);
  const errors = await errorsOf({ "skills/run-x/SKILL.md": bytes });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /is not valid UTF-8/);
});

test("a byte order mark at the start is an error that names it", async () => {
  for (const text of [`\ufeff${VALID}`, "\ufeff# Skill\n"]) {
    const errors = await errorsOf({ "skills/run-x/SKILL.md": text });
    assert.deepEqual(errors, [
      "skills/run-x/SKILL.md starts with a byte order mark (U+FEFF); save it as UTF-8 without one",
    ]);
  }
});

test("a closing fence without an opening one is missing frontmatter", async () => {
  // The fields below the first line are valid, so only the opening-fence check can refuse this.
  const errors = await errorsOf({ "skills/run-x/SKILL.md": "# Skill\nname: run-x\ndescription: x\n---\n" });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /is missing YAML frontmatter/);
});

test("CRLF line endings are accepted", async () => {
  assert.deepEqual(await errorsOf({ "skills/run-x/SKILL.md": VALID.replaceAll("\n", "\r\n") }), []);
});
