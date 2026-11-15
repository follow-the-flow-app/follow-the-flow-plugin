import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Agent Skills: lowercase letters, digits and single hyphens, neither first nor last (Atlassian's agent-skills.mjs). */
const SKILL_NAME = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

const KEY_VALUE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;
const DOUBLE_QUOTED = /^"(?:[^"\\]|\\.)*"$/;
const SINGLE_QUOTED = /^'(?:[^']|'')*'$/;
/**
 * A character YAML 1.2.2 does not allow in a line (§5.1, §5.2): anything outside c-printable, a
 * lone carriage return (a line break to YAML), and a byte order mark past the start of the stream.
 */
const NOT_YAML_CHARACTER = /[^\t\x20-\x7E\x85\xA0-\uD7FF\uE000-\uFEFE\uFF00-\uFFFD\u{10000}-\u{10FFFF}]/u;
/** A plain scalar YAML reads as null, a boolean or a number, not as a string (YAML 1.2 core schema). */
const NOT_A_STRING =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

/**
 * A plain (unquoted) value as YAML reads it, or undefined when YAML would read it as something this
 * validator does not: null (nothing), another type, a flow collection, a block scalar, a comment,
 * an alias, or an error.
 */
function plain(value) {
  if (value === "") return undefined;
  if (/^[[\]{}#&*!|>'"%@`,]/.test(value) || /^[-?:](?:\s|$)/.test(value)) return undefined;
  if (/:[ \t]/.test(value) || /[ \t]#/.test(value) || value.endsWith(":")) return undefined;
  return NOT_A_STRING.test(value) ? undefined : value;
}

/**
 * One value: double-quoted (JSON's escapes, a subset of YAML's), single-quoted, or plain. YAML's
 * white space is space and tab only; String#trim would also drop a no-break space YAML keeps.
 */
function scalar(raw) {
  const value = raw.replace(/^[ \t]+|[ \t]+$/g, "");
  if (DOUBLE_QUOTED.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (SINGLE_QUOTED.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  return plain(value);
}

/**
 * SKILL.md's frontmatter as { fields } or { error }. It reads one `key: value` per line and nothing
 * else of YAML: whatever it cannot read is an error, never skipped, so a line YAML would read
 * differently cannot pass unnoticed.
 */
export function parseFrontmatter(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") return { error: "is missing YAML frontmatter" };
  const end = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line));
  if (end < 0) return { error: "has unterminated YAML frontmatter" };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const character = NOT_YAML_CHARACTER.exec(line)?.[0];
    if (character !== undefined) {
      const code = character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      return { error: `has a character YAML does not allow (U+${code}) in its frontmatter: ${JSON.stringify(line)}` };
    }
    if (/^[ \t]*(?:#.*)?$/.test(line)) continue;
    const match = KEY_VALUE.exec(line);
    const value = match?.[2] === undefined ? undefined : scalar(match[2]);
    if (value === undefined) {
      return {
        error: `has a frontmatter line this validator cannot read as a key: value string: ${JSON.stringify(line)}`,
      };
    }
    if (Object.hasOwn(fields, match[1])) return { error: `sets ${match[1]} twice in its frontmatter` };
    fields[match[1]] = value;
  }
  return { fields };
}

const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");

/** I spec I-6 (RD-168): each immediate subdirectory of skills/ is one skill, in the Agent Skills format. */
export async function validateSkills(root) {
  const dir = path.join(root, "skills");
  try {
    if (!(await lstat(dir)).isDirectory()) return ["skills must be a directory"];
  } catch (error) {
    return error.code === "ENOENT" ? [] : [`cannot check skills: ${error.message}`];
  }
  const errors = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return [`cannot read skills: ${error.message}`];
  }
  // Any symlink: a client that follows one ships what was never checked here; one that does not
  // loses it.
  for (const entry of entries.filter((e) => e.isSymbolicLink()))
    errors.push(`skills/${entry.name} must not be a symlink`);
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const file = path.join(dir, entry.name, "SKILL.md");
    const label = relative(root, file);
    try {
      if (!(await lstat(file)).isFile()) {
        errors.push(`${label} must be a regular file`);
        continue;
      }
    } catch (error) {
      // A client skips a skill directory without SKILL.md silently, so the skill would just be gone.
      errors.push(error.code === "ENOENT" ? `missing ${label}` : `cannot check ${label}: ${error.message}`);
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      errors.push(`cannot read ${label}: ${error.message}`);
      continue;
    }
    let text;
    try {
      // Fatal: a lenient read turns a byte that is not UTF-8 into U+FFFD, and the file would pass.
      // ignoreBOM keeps a leading byte order mark, so it is still reported as missing frontmatter.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      errors.push(`${label} is not valid UTF-8`);
      continue;
    }
    const { fields, error } = parseFrontmatter(text);
    if (error) {
      errors.push(`${label} ${error}`);
      continue;
    }
    const { name, description } = fields;
    if (name === undefined) errors.push(`${label} needs name`);
    else if (name.length > NAME_MAX || !SKILL_NAME.test(name))
      errors.push(`${label} name ${JSON.stringify(name)} must be lowercase letters, digits and single hyphens, at most ${NAME_MAX}`);
    else if (name !== entry.name)
      errors.push(`${label} name ${JSON.stringify(name)} must match its directory ${JSON.stringify(entry.name)}`);
    if (description === undefined) errors.push(`${label} needs description`);
    else if (description.length === 0 || description.length > DESCRIPTION_MAX)
      errors.push(`${label} description must be 1-${DESCRIPTION_MAX} characters, found ${description.length}`);
  }
  return errors;
}
