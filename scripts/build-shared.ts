import path from "node:path";

import { ensureDir } from "jsr:@std/fs/ensure-dir";

import { Builder, readJSON, Transpiler } from "jsr:@delu/tailor@0.9.5";

export type ClassmapInfo = {
	classmap: any;
	version: string;
	timestamp: number;
};

export default async function (classmapInfos: ClassmapInfo[], inputDirs: string[]) {
	for (const inputDir of inputDirs) {
		const metadata = await readJSON<any>(path.join(inputDir, "metadata.json"));

		for (const { classmap, version: spVersion, timestamp } of classmapInfos) {
			const m = Object.assign({}, metadata);
			m.version += `+sp-${spVersion}-cm-${timestamp.toString(16)}`;

			const identifier = `/${m.authors[0]}/${m.name}`;
			const fingerprint = `${m.authors[0]}.${m.name}@v${m.version}`;
			const outputDir = path.join("dist", fingerprint);
			const copyUnknown = true;
			await ensureDir(outputDir);

			const transpiler = new Transpiler(classmap, false);
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
}
