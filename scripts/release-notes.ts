#!/usr/bin/env node
/**
 * release-notes - compose the GitHub release body for a module tag.
 *
 * usage:
 *   node scripts/release-notes.ts <name>@<version>
 *
 * Reads the stitched artifact from dist/<name>@<version>{,.zip} and
 * prints markdown: what the module is, what shipped, and the artifact
 * checksum in sha256sum format for offline verification.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const tag = process.argv[2];
if (!tag?.includes("@")) throw new Error("usage: release-notes.ts <name>@<version>");
const name = tag.slice(0, tag.lastIndexOf("@"));
const version = tag.slice(tag.lastIndexOf("@") + 1);

const meta = JSON.parse(readFileSync(path.join("dist", tag, "metadata.json"), "utf8"));
const zip = readFileSync(path.join("dist", `${tag}.zip`));
const sha = createHash("sha256").update(zip).digest("hex");

const authors: string[] = (meta.authors ?? []).map((a: string | { name: string }) =>
	typeof a === "string" ? a : a.name,
);

const lines = [
	`**${meta.name}** ${version}${meta.description ? ` — ${meta.description}` : ""}`,
	"",
	...(authors.length ? [`by ${authors.join(", ")}`, ""] : []),
	"Install from the store inside Spotify, or:",
	"",
	"```shell",
	`spicetify pkg install ${name}`,
	"```",
	"",
	"```",
	`${sha}  ${tag}.zip`,
	"```",
	"",
	"The catalog (`vault.json` on `main`) is the source of truth; this",
	"release page hosts the artifact.",
];
console.log(lines.join("\n"));
