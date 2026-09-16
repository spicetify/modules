#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { contentRoots, resolveModuleDir, runBuild } from "../packages/kit/src/build.ts";
import { auditStdlibBoundary, loadBoundaryPolicy } from "./stdlib-boundary.ts";
import { moduleFiles } from "./module-files.ts";
import { buildModuleGraph, changedModuleSelection, gitChangedFiles } from "./module-graph.ts";

export function verificationTarget(target: string, root: string): string {
	if (!target || target.startsWith("-")) throw new Error("Specify one module ID or path: pnpm verify <module>");
	const modulesDir = path.join(root, "modules");
	const directory = realpathSync(resolveModuleDir(target, modulesDir, root));
	if (!contentRoots(modulesDir).some((collection) => path.dirname(directory) === realpathSync(collection))) {
		throw new Error("The target must be a module directly inside a repository content root.");
	}
	return directory;
}

export function moduleTests(directory: string): string[] {
	return moduleFiles(directory)
		.filter((file) => file.endsWith(".test.mts"))
		.sort();
}

interface VerificationSteps {
	build: (directory: string) => Promise<void>;
	types: (directory: string) => Promise<{ ok: boolean; output: string }>;
	boundary: (directory: string) => void;
	run: (args: string[]) => void;
	log: (message: string) => void;
	full?: () => Promise<void>;
}

function defaultSteps(root: string): VerificationSteps {
	let boundaryFindings: ReturnType<typeof auditStdlibBoundary> | undefined;
	return {
		build: (directory) => runBuild([directory], root),
		types: async (directory) => {
			const { typecheckModules } = await import("./module-typecheck.ts");
			return typecheckModules({ root, modules: [directory] });
		},
		boundary: (directory) => {
			const prefix = `${path.relative(root, directory).split(path.sep).join("/")}/`;
			boundaryFindings ??= auditStdlibBoundary(root, loadBoundaryPolicy(root));
			const findings = boundaryFindings.filter((finding) => finding.file.startsWith(prefix));
			if (findings.length)
				throw new Error(findings.map((finding) => `${finding.file}: ${finding.detail}`).join("\n"));
		},
		run: (args) => {
			execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
		},
		log: console.log,
		full: async () => {
			for (const command of ["check", "fmt:check", "test"]) {
				execFileSync("pnpm", [command], { cwd: root, stdio: "inherit" });
			}
		},
	};
}

export async function verifyModule(
	target: string,
	root = process.cwd(),
	providedSteps?: VerificationSteps,
): Promise<void> {
	root = realpathSync(root);
	const steps = providedSteps ?? defaultSteps(root);
	await verifyTargets([target], root, steps);
}

async function verifyTargets(targets: string[], root: string, steps: VerificationSteps): Promise<void> {
	let dependenciesChecked = false;
	for (const target of targets) {
		const directory = verificationTarget(target, root);
		const relative = path.relative(root, directory);
		steps.log(`Verifying ${relative}: build, types, lint, format, boundaries, dependency ranges, and tests.`);
		await steps.build(directory);
		const types = await steps.types(directory);
		if (!types.ok) throw new Error(types.output || `${relative}: typecheck failed`);
		if (types.output) steps.log(types.output);
		steps.run([path.join(root, "node_modules/oxlint/bin/oxlint"), relative]);
		steps.run([path.join(root, "node_modules/oxfmt/bin/oxfmt"), "--check", relative]);
		steps.boundary(directory);
		if (!dependenciesChecked) {
			steps.run([path.join(root, "scripts/check-deps.ts")]);
			dependenciesChecked = true;
		}
		const tests = moduleTests(directory);
		if (tests.length) steps.run(["--test", ...tests]);
		else steps.log("No module tests found. Verify this module's behavior in Spotify before shipping.");
		steps.log(
			`${relative}: automated verification passed. Shared-tooling checks and live Spotify verification remain separate.`,
		);
	}
}

export async function verifyChanged({
	root = process.cwd(),
	base = "origin/main",
	files,
	steps,
}: {
	root?: string;
	base?: string;
	files?: string[];
	steps?: VerificationSteps;
} = {}): Promise<void> {
	root = realpathSync(root);
	const checks = steps ?? defaultSteps(root);
	const changed = files ?? gitChangedFiles(root, base);
	const graph = buildModuleGraph(root);
	const selection = changedModuleSelection(graph, changed);
	if (!selection.modules.length && !selection.full) {
		checks.log("No affected modules. Live Spotify verification remains separate.");
		return;
	}
	checks.log(
		`Changed verification${files ? "" : ` since the merge base with ${base}`}: ${selection.modules.join(", ") || "no modules"}.`,
	);
	if (selection.full) {
		checks.log(
			"Shared files changed: building all modules and running the full repository check, format, and test gates.",
		);
		if (!checks.full) throw new Error("Full repository verification is required for shared changes.");
		for (const id of selection.modules) {
			const module = graph.modules.get(id);
			if (module) await checks.build(module.directory);
		}
		await checks.full();
		checks.log("Full automated verification passed. Live Spotify verification remains separate.");
	} else {
		const targets = selection.modules.flatMap((id) => {
			const module = graph.modules.get(id);
			return module ? [module.directory] : [];
		});
		await verifyTargets(targets, root, checks);
	}
}

const USAGE =
	"Usage: pnpm verify <module ID | modules/name | themes/name>\n       pnpm verify --changed [--base <git ref>]";

export function parseVerificationArgs(
	args: string[],
): { kind: "module"; target: string } | { kind: "changed"; base: string } | { kind: "help" } {
	if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { kind: "help" };
	if (args.length === 1 && !args[0].startsWith("-")) return { kind: "module", target: args[0] };
	if (args[0] === "--changed") {
		if (args.length === 1) return { kind: "changed", base: "origin/main" };
		if (args.length === 3 && args[1] === "--base" && args[2] && !args[2].startsWith("-"))
			return { kind: "changed", base: args[2] };
	}
	throw new Error(USAGE);
}

async function main() {
	const args = parseVerificationArgs(process.argv.slice(2));
	if (args.kind === "help")
		console.log(
			`${USAGE}\nChanged mode includes committed, staged, unstaged, and untracked files plus reverse dependents. Shared-tooling changes run all gates. Does not change the running Spotify client.`,
		);
	else if (args.kind === "changed") await verifyChanged({ base: args.base });
	else await verifyModule(args.target);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
