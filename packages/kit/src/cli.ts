/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const USAGE = `spicetify-kit - developer kit for spicetify v3 modules

usage: spicetify-kit <command> [args]

  create <name>      scaffold a new module project (--bare for monorepo layout)
  check [module]     audit a module against the module standard (advisory)
  from-theme <dir>   migrate a classic theme (user.css + color.ini) to a module
  build [module...]  bundle modules (rolldown + scss) into dist/
  dev <module>       watch, rebuild, and hot-push into a running client
  pack <dist-dir>    zip a built module and print its sha256
  vault add <dir>    record a built module into a vault file (--artifact <url>)
  install <zip|dir>  sideload a packed module into a running client

run a command with --help for its flags`;

export async function main(argv: string[]): Promise<void> {
	const [command, ...rest] = argv;
	try {
		switch (command) {
			case "create":
				return await (await import("./create.ts")).runCreate(rest);
			case "check":
				return await (await import("./check.ts")).runCheck(rest);
			case "from-theme":
				return await (await import("./from-theme.ts")).runFromTheme(rest);
			case "build":
				return await (await import("./build.ts")).runBuild(rest);
			case "dev":
				return await (await import("./dev.ts")).runDev(rest);
			case "pack":
				return await (await import("./pack.ts")).runPack(rest);
			case "vault":
				return await (await import("./vault.ts")).runVault(rest);
			case "install":
				return await (await import("./install.ts")).runInstall(rest);
			case undefined:
			case "--help":
			case "-h":
			case "help":
				console.log(USAGE);
				return;
			default:
				throw new Error(`unknown command: ${command}\n\n${USAGE}`);
		}
	} catch (e) {
		console.error((e as Error).message ?? e);
		process.exit(1);
	}
}
