import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import * as ts from "typescript/unstable/ast";

import { moduleFiles, workspaceModules } from "./module-files.ts";
import { loadBoundaryPolicy } from "./stdlib-boundary.ts";

export interface WorkspaceModule {
	id: string;
	directory: string;
	version: string;
	compat: string[];
	ranges: Map<string, string>;
	dependencies: Set<string>;
	optionalStdlib: boolean;
}

interface ModuleImport {
	module: string;
	dependency: string;
	file: string;
	line: number;
	specifier: string;
	public: boolean;
	runtime: boolean;
	deferred: boolean;
}

export interface ModuleGraph {
	root: string;
	modules: Map<string, WorkspaceModule>;
	imports: ModuleImport[];
}

export interface ModuleImportFinding {
	module: string;
	file: string;
	line: number;
	rule: "private-module-import" | "missing-module-dependency";
	detail: string;
}

const posix = (file: string) => file.split(path.sep).join("/");
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /(?:\.test\.[cm]?[jt]sx?$|(?:^|\/)test-setup\.[cm]?[jt]sx?$|\.d\.[cm]?ts$)/;

function readModule(directory: string): WorkspaceModule {
	const file = path.join(directory, "metadata.json");
	const meta: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!meta || typeof meta !== "object" || !("name" in meta) || typeof meta.name !== "string") {
		throw new Error(`${file}: metadata needs a module name`);
	}
	const ranges = new Map<string, string>();
	if ("dependencies" in meta && meta.dependencies !== undefined) {
		const dependencies = meta.dependencies;
		if (Array.isArray(dependencies)) {
			for (const dependency of dependencies) {
				if (typeof dependency !== "string") throw new Error(`${file}: invalid dependency`);
				ranges.set(dependency, "*");
			}
		} else if (dependencies && typeof dependencies === "object") {
			for (const [id, range] of Object.entries(dependencies)) {
				if (typeof range !== "string") throw new Error(`${file}: invalid dependency range for ${id}`);
				ranges.set(id, range);
			}
		} else throw new Error(`${file}: invalid dependencies`);
	}
	const compat: string[] = [];
	if ("compat" in meta) {
		if (!Array.isArray(meta.compat)) throw new Error(`${file}: invalid compat list`);
		for (const version of meta.compat) {
			if (typeof version !== "string") throw new Error(`${file}: invalid compat version`);
			compat.push(version);
		}
	}
	return {
		id: meta.name,
		directory,
		version: "version" in meta && typeof meta.version === "string" ? meta.version : "",
		compat,
		ranges,
		dependencies: new Set(ranges.keys()),
		optionalStdlib: false,
	};
}

function importTarget(specifier: string, file: string, graph: ModuleGraph) {
	const clean = specifier.split(/[?#]/)[0];
	let target: string;
	let entry: string;
	if (clean.startsWith("/modules/")) {
		const parts = path.posix.normalize(clean).split("/");
		if (parts[1] !== "modules" || !parts[2]) return;
		target = parts[2];
		entry = parts.slice(3).join("/");
	} else if (clean.startsWith(".")) {
		const resolved = path.resolve(path.dirname(file), clean);
		const owner = [...graph.modules.values()].find(
			(module) => resolved === module.directory || resolved.startsWith(`${module.directory}${path.sep}`),
		);
		if (owner) {
			target = owner.id;
			entry = posix(path.relative(owner.directory, resolved));
		} else {
			const relative = posix(path.relative(graph.root, resolved));
			const parts = relative.split("/");
			if (!/^(modules|themes|snippets)$/.test(parts[0]) || !parts[1]) return;
			target = parts[1];
			entry = parts.slice(2).join("/");
		}
	} else return;
	const publicEntry =
		/^(?:mod\.[cm]?[jt]sx?)$/.test(entry) ||
		(target === "stdlib" &&
			(/^(?:query\.[jt]s|lib\/primitives(?:-classes|-vanilla)?\.[jt]sx?)$/.test(entry) ||
				(TEST.test(posix(file)) && entry === "lib/test-setup.mts")));
	return { target, publicEntry };
}

/** Parse all source files once. Type-only and test edges still affect change selection. */
export function buildModuleGraph(root: string): ModuleGraph {
	root = path.resolve(root);
	const graph: ModuleGraph = { root, modules: new Map(), imports: [] };
	const files: Record<string, string> = {};
	const owners = new Map<string, WorkspaceModule>();
	const policy = existsSync(path.join(root, "stdlib-boundary-exceptions.json"))
		? loadBoundaryPolicy(root)
		: undefined;
	for (const directory of workspaceModules(root)) {
		const module = readModule(directory);
		module.optionalStdlib =
			policy?.exceptions?.some(
				(exception) =>
					exception.module === module.id &&
					exception.file === `${posix(path.relative(root, directory))}/metadata.json` &&
					exception.rules.includes("missing-stdlib-dependency") &&
					exception.reason.trim().length > 0,
			) ?? false;
		if (graph.modules.has(module.id)) throw new Error(`Duplicate workspace module: ${module.id}`);
		graph.modules.set(module.id, module);
		for (const file of moduleFiles(directory).filter((file) => SOURCE.test(file))) {
			files[file] = readFileSync(file, "utf8");
			owners.set(file, module);
		}
	}
	if (!owners.size) return graph;
	const config = path.join(root, ".module-graph.tsconfig.json");
	files[config] = JSON.stringify({
		compilerOptions: { noLib: true, noResolve: true, allowJs: true },
		files: [...owners.keys()],
	});
	const api = new API({ cwd: root, fs: createVirtualFileSystem(files) });
	try {
		using snapshot = api.updateSnapshot({ openProjects: [config] });
		const project = snapshot.getProject(config);
		if (!project) throw new Error("Cannot parse module sources");
		for (const [file, owner] of owners) {
			const source = project.program.getSourceFile(file);
			if (!source) throw new Error(`Cannot parse ${file}`);
			const add = (node: ts.Node, literal: ts.Node | undefined, runtime: boolean, deferred = false) => {
				if (!literal || (!ts.isStringLiteral(literal) && !ts.isNoSubstitutionTemplateLiteral(literal))) return;
				const target = importTarget(literal.text, file, graph);
				if (!target || target.target === owner.id) return;
				owner.dependencies.add(target.target);
				graph.imports.push({
					module: owner.id,
					dependency: target.target,
					file: posix(path.relative(root, file)),
					line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
					specifier: literal.text,
					public: target.publicEntry,
					runtime: runtime && !TEST.test(posix(file)),
					deferred,
				});
			};
			const visit = (node: ts.Node): void => {
				if (ts.isImportDeclaration(node)) {
					const clause = node.importClause;
					const bindings = clause?.namedBindings;
					const onlyTypes =
						clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
						(!clause?.name &&
							bindings &&
							ts.isNamedImports(bindings) &&
							bindings.elements.length > 0 &&
							bindings.elements.every((item) => item.isTypeOnly));
					add(node, node.moduleSpecifier, !onlyTypes);
				} else if (ts.isExportDeclaration(node)) {
					const clause = node.exportClause;
					const onlyTypes =
						node.isTypeOnly ||
						(clause &&
							ts.isNamedExports(clause) &&
							clause.elements.length > 0 &&
							clause.elements.every((item) => item.isTypeOnly));
					add(node, node.moduleSpecifier, !onlyTypes);
				} else if (
					ts.isCallExpression(node) &&
					(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
						(ts.isIdentifier(node.expression) && node.expression.text === "require"))
				) {
					add(node, node.arguments[0], true, node.expression.kind === ts.SyntaxKind.ImportKeyword);
				} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
					add(node, node.argument.literal, false);
				} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
					add(node, node.moduleReference.expression, !node.isTypeOnly);
				}
				node.forEachChild(visit);
			};
			visit(source);
		}
	} finally {
		api.close();
	}
	return graph;
}

export function auditModuleImports(graph: ModuleGraph): ModuleImportFinding[] {
	return graph.imports.flatMap((imported) => {
		const findings: ModuleImportFinding[] = [];
		const location = { module: imported.module, file: imported.file, line: imported.line };
		if (!imported.public)
			findings.push({
				...location,
				rule: "private-module-import",
				detail: `${imported.specifier} is private; import the module's public mod.js entry${imported.dependency === "stdlib" ? " or its public query/primitives entries" : ""}`,
			});
		const owner = graph.modules.get(imported.module);
		const recoveryImport = imported.deferred && imported.dependency === "stdlib" && owner?.optionalStdlib;
		if (imported.runtime && !owner?.ranges.has(imported.dependency) && !recoveryImport) {
			findings.push({
				...location,
				rule: "missing-module-dependency",
				detail: `runtime import ${imported.specifier} requires ${imported.dependency} in metadata.json dependencies`,
			});
		}
		return findings;
	});
}

export function changedModuleSelection(graph: ModuleGraph, files: string[]): { modules: string[]; full: boolean } {
	const affected = new Set<string>();
	let full = false;
	for (const file of files) {
		const normalized = posix(file);
		const owner = [...graph.modules.values()].find((module) =>
			normalized.startsWith(`${posix(path.relative(graph.root, module.directory))}/`),
		);
		if (owner) affected.add(owner.id);
		else if (/^(modules|themes|snippets)\/[^/]+\//.test(normalized)) affected.add(normalized.split("/")[1]);
		else if (!/^(?:docs\/|.*\.md$)/.test(normalized)) full = true;
	}
	if (full) return { modules: [...graph.modules.keys()].sort(), full };
	let grew = true;
	while (grew) {
		grew = false;
		for (const module of graph.modules.values()) {
			if (!affected.has(module.id) && [...module.dependencies].some((dependency) => affected.has(dependency))) {
				affected.add(module.id);
				grew = true;
			}
		}
	}
	return { modules: [...affected].filter((id) => graph.modules.has(id)).sort(), full };
}

export function gitChangedFiles(
	root: string,
	base = "origin/main",
	run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
): string[] {
	const ancestor = run(["merge-base", base, "HEAD"]).trim();
	const committed = run(["diff", "--name-only", "--no-renames", "-z", ancestor, "HEAD", "--"]);
	const staged = run(["diff", "--name-only", "--no-renames", "-z", "--cached", "HEAD", "--"]);
	const worktree = run(["diff", "--name-only", "--no-renames", "-z", "--"]);
	const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"]);
	return [...new Set(`${committed}${staged}${worktree}${untracked}`.split("\0").filter(Boolean))].sort();
}
