#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { contentRoots, resolveModuleDir, runBuild } from "../packages/kit/src/build.ts";
import { auditStdlibBoundary, loadBoundaryPolicy } from "./stdlib-boundary.ts";
import { moduleFiles } from "./module-files.ts";

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
}

function defaultSteps(root: string): VerificationSteps {
	return {
		build: (directory) => runBuild([directory], root),
		types: async (directory) => {
			const { typecheckModules } = await import("./module-typecheck.ts");
			return typecheckModules({ root, modules: [directory] });
		},
		boundary: (directory) => {
			const prefix = `${path.relative(root, directory).split(path.sep).join("/")}/`;
			const findings = auditStdlibBoundary(root, loadBoundaryPolicy(root)).filter((finding) =>
				finding.file.startsWith(prefix),
			);
			if (findings.length)
				throw new Error(findings.map((finding) => `${finding.file}: ${finding.detail}`).join("\n"));
		},
		run: (args) => {
			execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
		},
		log: console.log,
	};
}

export async function verifyModule(
	target: string,
	root = process.cwd(),
	providedSteps?: VerificationSteps,
): Promise<void> {
	root = realpathSync(root);
	const steps = providedSteps ?? defaultSteps(root);
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
	steps.run([path.join(root, "scripts/check-deps.ts")]);
	const tests = moduleTests(directory);
	if (tests.length) steps.run(["--test", ...tests]);
	else steps.log("No module tests found. Verify this module's behavior in Spotify before shipping.");
	steps.log(
		`${relative}: automated verification passed. Shared-tooling checks and live Spotify verification remain separate.`,
	);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
		console.log(
			"Usage: pnpm verify <module ID | modules/name | themes/name>\nRuns module checks and the repository dependency-range gate. Does not change the running Spotify client.",
		);
		return;
	}
	if (args.length !== 1) throw new Error("Specify exactly one module: pnpm verify <module>");
	await verifyModule(args[0]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
