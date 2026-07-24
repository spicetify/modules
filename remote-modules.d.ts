// Remote and data-URL imports carry no local type information; stitch
// leaves the URLs untouched at build time and the editor treats them
// as any.
declare module "https://*";
declare module "npm:*";
declare module "data:*";
