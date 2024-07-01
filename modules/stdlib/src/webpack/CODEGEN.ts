/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/// <reference lib="deno.ns" />

import swc from "npm:@swc/core";

async function* getFileExports(path: string) {
   const module = await swc.parseFile(path, {
      syntax: "typescript",
      tsx: false,
      decorators: true,
      comments: false,
      script: false,
      target: "esnext",
   });

   for (const node of module.body) {
      switch (node.type) {
         case "ExportDeclaration": {
            switch (node.declaration.type) {
               case "VariableDeclaration": {
                  for (const decl of node.declaration.declarations) {
                     switch (decl.id.type) {
                        case "Identifier":
                           yield decl.id.value;
                           break;
                     }
                  }
               }
            }
         }
      }
   }
}

const header = `/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

`;

async function generateBarrelContent(filenames: string[]) {
   const content = await Promise.all(filenames.map(async (file) => {
      const toImport = `./${file}`;
      const importAs = file.replaceAll(".", "_");
      const exports = await Array.fromAsync(getFileExports(file));
      const importType = `import type * as ${importAs} from "${toImport}";\n`;
      const exportLets = exports.map((exp) => `export let ${exp}: typeof ${importAs}.${exp};\n`).join("");
      const initializer = `import("${toImport}").then(m => {\n` +
         exports.map((exp) => `	${exp} = m.${exp};\n`).join("") +
         `});\n`;

      return importType + exportLets + initializer;
   }));
   return header + content.join("\n");
}

async function main() {
   const nameToFilenames: Record<string, string[]> = {};

   for await (const sibling of Deno.readDir(".")) {
      if (!sibling.isFile) {
         continue;
      }

      const [name, type, ext] = sibling.name.split(".");
      if (ext !== "ts" || type === "gen") {
         continue;
      }

      nameToFilenames[name] ??= [];
      nameToFilenames[name].push(sibling.name);
   }

   for (const [name, filenames] of Object.entries(nameToFilenames)) {
      const content = await generateBarrelContent(filenames);
      await Deno.writeTextFile(`${name}.gen.ts`, content);
   }
}

await main();
