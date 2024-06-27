import { Builder, readJSON, Transpiler } from "jsr:@delu/tailor";

import { ensureDir } from "jsr:@std/fs/ensure-dir";

import path from "node:path";

import { classmapInfos } from "./build-shared.ts";

for (const inputDir of Deno.args) {
	const metadata = await readJSON<any>(path.join(inputDir, "metadata.json"));

	for (const { classmap, version: spVersion, timestamp: cmTimestamp } of classmapInfos) {
		const m = { ...metadata };
		m.version = `${metadata.version}+sp-${spVersion}-cm-${cmTimestamp}`;

		const identifier = `/${m.authors[0]}/${m.name}`;
		const fingerprint = `${m.authors[0]}.${m.name}@v${m.version}`;
		const outputDir = path.join("dist", fingerprint);
		const copyUnknown = true;

		await ensureDir(outputDir);

		const transpiler = new Transpiler(classmap);
		const builder = new Builder(transpiler, { metadata, identifier, inputDir, outputDir, copyUnknown });

		try {
			await builder.build();
			await Deno.writeTextFile(path.join(outputDir, "metadata.json"), JSON.stringify(m));
		} catch (err) {
			await Deno.remove(outputDir, { recursive: true });
			console.warn(`Build for ${fingerprint} failed with error: ${err}`);
		}
	}
}
